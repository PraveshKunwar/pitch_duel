import { resolveCurrentRound } from "../game/resolveCurrentRound";
import { selectRandomCard } from "../game/selectRandomCard";
import { submitPick as applyPick } from "../game/submitPick";
import {
  createLocalGameFanout,
  type GameFanout,
} from "./fanout";
import {
  isTerminal,
  nextCategory,
  seatFor,
  type GameSession,
  type GameSessionStore,
  type PlayerSeat,
} from "./gameSessions";
import {
  createDefaultScheduler,
  ROUND_MS,
  type TimerScheduler,
} from "./timers";
import type { AuthenticatedSocket, ServerMessage } from "./types";

export type PickResult =
  | { status: "rejected"; message: string }
  | { status: "waiting"; session: GameSession; seat: PlayerSeat }
  | { status: "resolved" };

export interface PickInput {
  gameId: string;
  userId: string;
  round: number;
  sequence: number;
  cardId: string;
}

interface ArmedTimer {
  token: number;
  round: number;
  handle: { cancel(): void };
}

export interface RoundCoordinator {
  beginRound(
    gameId: string,
  ): Promise<{ session: GameSession; opened: boolean } | null>;
  submitPick(input: PickInput): Promise<PickResult>;
  roundStartMessage(
    session: GameSession,
  ): Extract<ServerMessage, { type: "game:roundStart" }> | null;
  pause(gameId: string): void;
  resume(session: GameSession, options?: { notify?: boolean }): void;
  dispose(): void;
}

export interface RoundCoordinatorDependencies {
  sessions: GameSessionStore;
  getSocket: (userId: string) => AuthenticatedSocket | undefined;
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void;
  fanout?: GameFanout;
  scheduler?: TimerScheduler;
  now?: () => number;
  random?: () => number;
  roundMs?: number;
  onGameFinished?: (session: GameSession) => Promise<{
    ratings?: { player1: number; player2: number };
    ratingDelta?: number | null;
  } | void>;
  onError?: (
    error: unknown,
    context: { gameId: string; during: string },
  ) => void;
}

const MAX_ATTEMPTS = 5;

export function createRoundCoordinator(
  deps: RoundCoordinatorDependencies,
): RoundCoordinator {
  const scheduler = deps.scheduler ?? createDefaultScheduler();
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const roundMs = deps.roundMs ?? ROUND_MS;
  const reportError =
    deps.onError ??
    ((error, context) => console.error("round coordinator", context, error));
  const fanout =
    deps.fanout ?? createLocalGameFanout(deps.getSocket, deps.send);
  const armed = new Map<string, ArmedTimer>();
  let nextToken = 1;

  function disarm(gameId: string): void {
    const current = armed.get(gameId);
    if (!current) return;
    current.handle.cancel();
    armed.delete(gameId);
  }

  function arm(session: GameSession): void {
    if (session.frozen || session.deadlineMs === null) return;
    const gameId = session.id;
    const round = session.state.round;
    if (armed.get(gameId)?.round === round) return;
    disarm(gameId);

    const token = nextToken++;
    const delayMs = Math.max(0, session.deadlineMs - now());
    const handle = scheduler.schedule(delayMs, () => {
      const current = armed.get(gameId);
      if (!current || current.token !== token) return;
      armed.delete(gameId);
      return resolveOnTimeout(gameId, round).catch((error: unknown) => {
        reportError(error, { gameId, during: "round timeout" });
      });
    });
    armed.set(gameId, { token, round, handle });
  }

  async function finish(session: GameSession): Promise<void> {
    const winner =
      session.state.player1.score > session.state.player2.score
        ? ("player1" as const)
        : session.state.player2.score > session.state.player1.score
          ? ("player2" as const)
          : null;
    let ratings: { player1: number; player2: number } | undefined;
    let ratingDelta: number | null | undefined;
    if (deps.onGameFinished) {
      try {
        const recorded = await deps.onGameFinished(session);
        if (recorded?.ratings) ratings = recorded.ratings;
        if (recorded && "ratingDelta" in recorded) {
          ratingDelta = recorded.ratingDelta ?? null;
        }
      } catch (error) {
        reportError(error, { gameId: session.id, during: "match persistence" });
      }
    }
    // Always notify clients — end UI must not depend on Postgres succeeding.
    await fanout.gameEnded(session, {
      reason: "completed",
      winner,
      ratings,
      ratingDelta,
    });
  }

  async function commitResolved(
    session: GameSession,
    picked: GameSession["state"],
    lastSequence: GameSession["lastSequence"] = session.lastSequence,
  ): Promise<boolean> {
    const state = resolveCurrentRound(
      picked,
      nextCategory(picked.category),
      random,
    );
    const finished = state.status === "finished";
    const at = now();
    const saved = await deps.sessions.update({
      ...session,
      state,
      lastSequence,
      deadlineMs: finished ? null : at + roundMs,
      endedAtMs: finished ? at : null,
      outcome: finished ? { kind: "completed" } : session.outcome,
    });
    if (!saved) return false;

    disarm(saved.id);
    if (finished) {
      await fanout.roundResolved(saved);
      await finish(saved);
    } else {
      arm(saved);
      await fanout.roundResolved(saved);
    }
    return true;
  }

  async function beginRound(
    gameId: string,
  ): Promise<{ session: GameSession; opened: boolean } | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const session = await deps.sessions.get(gameId);
      if (!session) return null;
      if ((session.phase ?? "playing") !== "playing") {
        disarm(gameId);
        return { session, opened: false };
      }
      if (isTerminal(session) || session.state.status !== "picking") {
        disarm(gameId);
        return { session, opened: false };
      }
      if (session.frozen) {
        disarm(gameId);
        return { session, opened: false };
      }
      if (session.deadlineMs !== null) {
        arm(session);
        return { session, opened: false };
      }

      const opened = await deps.sessions.update({
        ...session,
        deadlineMs: now() + roundMs,
      });
      if (!opened) continue;
      arm(opened);
      await fanout.roundStarted(opened);
      return { session: opened, opened: true };
    }
    throw new Error(`Could not open a round for game ${gameId}`);
  }

  async function resolveOnTimeout(
    gameId: string,
    round: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const session = await deps.sessions.get(gameId);
      if (!session) return;
      if (session.frozen || isTerminal(session)) return;
      if (session.state.status !== "picking" || session.state.round !== round) {
        return;
      }

      let picked = session.state;
      for (const seat of ["player1", "player2"] as const) {
        if (picked[seat].selectedCardId !== null) continue;
        const card = selectRandomCard(picked[seat].hand, random);
        picked = applyPick(picked, seat, card.ID);
      }
      if (await commitResolved(session, picked)) return;
    }
    throw new Error(`Could not resolve round ${round} of game ${gameId}`);
  }

  function roundStartMessage(
    session: GameSession,
  ): Extract<ServerMessage, { type: "game:roundStart" }> | null {
    if (
      session.frozen ||
      session.state.status !== "picking" ||
      session.deadlineMs === null
    ) {
      return null;
    }
    return {
      type: "game:roundStart",
      gameId: session.id,
      round: session.state.round,
      category: session.state.category,
      deadlineMs: session.deadlineMs,
    };
  }

  async function submitPick(input: PickInput): Promise<PickResult> {
    const { gameId, userId, round, sequence, cardId } = input;
    const rejected = (message: string): PickResult => ({
      status: "rejected",
      message,
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const session = await deps.sessions.get(gameId);
      if (!session) return rejected("Game not found");

      const seat = seatFor(session, userId);
      if (!seat) return rejected("Not a participant in this game");

      if (session.frozen) {
        return rejected("Game is paused while a player is disconnected");
      }
      if ((session.phase ?? "playing") !== "playing") {
        return rejected("Match is still in setup");
      }
      if (isTerminal(session) || session.state.status !== "picking") {
        return rejected("Game is not accepting picks");
      }
      if (round !== session.state.round) {
        return rejected("Incorrect round number");
      }
      if (sequence <= session.lastSequence[seat]) {
        return rejected("Duplicate or outdated move");
      }
      if (session.deadlineMs !== null && now() >= session.deadlineMs) {
        return rejected("Round deadline has passed");
      }

      let picked: GameSession["state"];
      try {
        picked = applyPick(session.state, seat, cardId);
      } catch (error) {
        return rejected(
          error instanceof Error ? error.message : "Invalid pick",
        );
      }

      const lastSequence = { ...session.lastSequence, [seat]: sequence };
      const bothPicked =
        picked.player1.selectedCardId !== null &&
        picked.player2.selectedCardId !== null;

      if (!bothPicked) {
        const saved = await deps.sessions.update({
          ...session,
          state: picked,
          lastSequence,
        });
        if (!saved) continue;
        arm(saved);
        return { status: "waiting", session: saved, seat };
      }

      if (await commitResolved(session, picked, lastSequence)) {
        return { status: "resolved" };
      }
    }
    return rejected("Round is no longer accepting picks");
  }

  function pause(gameId: string): void {
    disarm(gameId);
  }

  function resume(
    session: GameSession,
    options?: { notify?: boolean },
  ): void {
    if (session.frozen || isTerminal(session)) return;
    arm(session);
    if (options?.notify === false) return;
    void fanout.roundStarted(session).catch((error: unknown) => {
      reportError(error, { gameId: session.id, during: "resume notify" });
    });
  }

  function dispose(): void {
    for (const gameId of [...armed.keys()]) {
      disarm(gameId);
    }
  }

  return {
    beginRound,
    submitPick,
    roundStartMessage,
    pause,
    resume,
    dispose,
  };
}
