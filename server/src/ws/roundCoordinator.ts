import { resolveCurrentRound } from "../game/resolveCurrentRound";
import { selectRandomCard } from "../game/selectRandomCard";
import { submitPick as applyPick } from "../game/submitPick";
import {
  nextCategory,
  seatFor,
  visiblePlayerState,
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
  onGameFinished?: (session: GameSession) => Promise<unknown>;
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
  const armed = new Map<string, ArmedTimer>();
  let nextToken = 1;

  function disarm(gameId: string): void {
    const current = armed.get(gameId);
    if (!current) return;
    current.handle.cancel();
    armed.delete(gameId);
  }

  function arm(session: GameSession): void {
    if (session.deadlineMs === null) return;
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

  async function finish(session: GameSession): Promise<void> {
    if (!deps.onGameFinished) return;
    try {
      await deps.onGameFinished(session);
    } catch (error) {
      reportError(error, { gameId: session.id, during: "match persistence" });
    }
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
    });
    if (!saved) return false;

    disarm(saved.id);
    publishResolved(saved);
    if (finished) {
      await finish(saved);
    } else {
      arm(saved);
      publishRoundStart(saved);
    }
    return true;
  }

  async function beginRound(
    gameId: string,
  ): Promise<{ session: GameSession; opened: boolean } | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const session = await deps.sessions.get(gameId);
      if (!session) return null;
      if (session.state.status !== "picking") {
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
      publishRoundStart(opened);
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
    if (session.state.status !== "picking" || session.deadlineMs === null) {
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

      if (session.state.status !== "picking") {
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

  function dispose(): void {
    for (const gameId of [...armed.keys()]) {
      disarm(gameId);
    }
  }

  return { beginRound, submitPick, roundStartMessage, dispose };
}
