import { resolveCurrentRound } from "../game/resolveCurrentRound";
import { selectRandomCard } from "../game/selectRandomCard";
import { submitPick as applyPick } from "../game/submitPick";
import {
  nextCategory,
  visiblePlayerState,
  type GameSession,
  type GameSessionStore,
  type PlayerSeat,
} from "./gameSessions";
import { createDefaultScheduler, ROUND_MS, type TimerScheduler } from "./timers";
import type { AuthenticatedSocket, ServerMessage } from "./types";

export type PickResult =
  | { status: "rejected"; message: string }
  | { status: "waiting" }
  | { status: "resolved" };

interface ArmedTimer {
  token: number;
  handle: { cancel(): void };
}

export interface RoundCoordinator {
  beginRound(session: GameSession): void;
  submitPick(input: {
    session: GameSession;
    seat: PlayerSeat;
    round: number;
    cardId: string;
  }): PickResult;
  roundStartMessage(
    session: GameSession,
  ): Extract<ServerMessage, { type: "game:roundStart" }> | null;
  dispose(): void;
}

export interface RoundCoordinatorDependencies {
  sessions: GameSessionStore;
  getSocket: (userId: string) => AuthenticatedSocket | undefined;
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void;
  scheduler?: TimerScheduler;
  now?: () => number;
  random?: () => number;
  roundMs?: number;
}

/**
 * A round may leave `picking` only once. Synchronous in this process.
 * Day 8/11 should replace this with an atomic Redis claim (`SET NX`)
 * before any resolved state is published. Do not publish or arm the next
 * round until this returns true.
 */
export function tryClaimRound(session: GameSession, round: number): boolean {
  if (session.state.status !== "picking") return false;
  if (session.state.round !== round) return false;
  if (session.claimedRound === round) return false;
  session.claimedRound = round;
  return true;
}

export function createRoundCoordinator(
  deps: RoundCoordinatorDependencies,
): RoundCoordinator {
  const scheduler = deps.scheduler ?? createDefaultScheduler();
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const roundMs = deps.roundMs ?? ROUND_MS;
  const armed = new Map<string, ArmedTimer>();
  let nextToken = 1;

  function disarm(gameId: string): void {
    const current = armed.get(gameId);
    if (!current) return;
    current.handle.cancel();
    armed.delete(gameId);
  }

  function publish(session: GameSession, message: ServerMessage): void {
    for (const userId of [session.player1UserId, session.player2UserId]) {
      const socket = deps.getSocket(userId);
      if (socket) deps.send(socket, message);
    }
  }

  function publishRoundStart(session: GameSession): void {
    const message = roundStartMessage(session);
    if (message) publish(session, message);
  }

  function publishResolved(session: GameSession): void {
    const completed = session.state.history[session.state.history.length - 1];
    if (!completed) return;
    for (const seat of ["player1", "player2"] as const) {
      const userId =
        seat === "player1" ? session.player1UserId : session.player2UserId;
      const socket = deps.getSocket(userId);
      if (!socket) continue;
      deps.send(socket, { type: "game:roundResult", round: completed });
      deps.send(socket, {
        type: "game:state",
        state: visiblePlayerState(session.state, seat),
      });
    }
  }

  function commitResolved(
    session: GameSession,
    round: number,
    nextState: GameSession["state"],
  ): boolean {
    if (!tryClaimRound(session, round)) return false;
    disarm(session.id);
    session.state = nextState;
    session.deadlineMs = null;
    deps.sessions.save(session);
    publishResolved(session);
    beginRound(session);
    return true;
  }

  function resolveWithPicks(
    session: GameSession,
    round: number,
    picked: GameSession["state"],
  ): boolean {
    const resolved = resolveCurrentRound(
      picked,
      nextCategory(picked.category),
      random,
    );
    return commitResolved(session, round, resolved);
  }

  function beginRound(session: GameSession): void {
    if (session.state.status !== "picking") {
      disarm(session.id);
      session.deadlineMs = null;
      deps.sessions.save(session);
      return;
    }
    if (armed.has(session.id)) return;

    const round = session.state.round;
    session.deadlineMs = now() + roundMs;
    deps.sessions.save(session);

    const token = nextToken++;
    const handle = scheduler.schedule(roundMs, () => {
      const current = armed.get(session.id);
      if (!current || current.token !== token) return;
      armed.delete(session.id);
      resolveOnTimeout(session.id, round);
    });
    armed.set(session.id, { token, handle });
    publishRoundStart(session);
  }

  function resolveOnTimeout(gameId: string, round: number): void {
    const session = deps.sessions.get(gameId);
    if (!session) return;
    if (session.state.status !== "picking" || session.state.round !== round) {
      return;
    }
    if (session.claimedRound === round) return;

    let picked = session.state;
    for (const seat of ["player1", "player2"] as const) {
      if (picked[seat].selectedCardId !== null) continue;
      const card = selectRandomCard(picked[seat].hand, random);
      picked = applyPick(picked, seat, card.ID);
    }
    resolveWithPicks(session, round, picked);
  }

  function roundStartMessage(
    session: GameSession,
  ): Extract<ServerMessage, { type: "game:roundStart" }> | null {
    if (session.state.status !== "picking" || session.deadlineMs === null) {
      return null;
    }
    if (session.claimedRound === session.state.round) return null;
    return {
      type: "game:roundStart",
      gameId: session.id,
      round: session.state.round,
      category: session.state.category,
      deadlineMs: session.deadlineMs,
    };
  }

  function submitPick(input: {
    session: GameSession;
    seat: PlayerSeat;
    round: number;
    cardId: string;
  }): PickResult {
    const { session, seat, round, cardId } = input;
    if (session.state.status !== "picking") {
      return { status: "rejected", message: "Game is not accepting picks" };
    }
    if (round !== session.state.round) {
      return { status: "rejected", message: "Incorrect round number" };
    }
    if (session.claimedRound === round) {
      return { status: "rejected", message: "Round is no longer accepting picks" };
    }
    if (session.deadlineMs !== null && now() >= session.deadlineMs) {
      return { status: "rejected", message: "Round deadline has passed" };
    }

    let picked: GameSession["state"];
    try {
      picked = applyPick(session.state, seat, cardId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid pick";
      return { status: "rejected", message };
    }

    const bothPicked =
      picked.player1.selectedCardId !== null &&
      picked.player2.selectedCardId !== null;
    if (!bothPicked) {
      session.state = picked;
      deps.sessions.save(session);
      return { status: "waiting" };
    }

    if (!resolveWithPicks(session, round, picked)) {
      return { status: "rejected", message: "Round is no longer accepting picks" };
    }
    return { status: "resolved" };
  }

  function dispose(): void {
    for (const gameId of [...armed.keys()]) {
      disarm(gameId);
    }
  }

  return { beginRound, submitPick, roundStartMessage, dispose };
}
