import {
  createLocalGameFanout,
  type GameFanout,
} from "../ws/fanout";
import {
  isTerminal,
  seatFor,
  visiblePlayerState,
  type GameSession,
  type GameSessionStore,
  type PlayerSeat,
} from "../ws/gameSessions";
import {
  createDefaultScheduler,
  type TimerHandle,
  type TimerScheduler,
} from "../ws/timers";
import type { AuthenticatedSocket, ServerMessage } from "../ws/types";
import {
  applyDisconnect,
  applyGraceExpired,
  applyReconnect,
  bindConnection,
} from "./transitions";
import {
  DEFAULT_RECONNECT_CONFIG,
  type ReconnectConfig,
} from "./types";

const MAX_ATTEMPTS = 8;

export interface ReconnectService {
  attachConnection(
    socket: AuthenticatedSocket,
    gameId?: string,
  ): Promise<GameSession | null>;
  onDisconnect(
    userId: string,
    connectionId: string | null,
  ): Promise<GameSession | null>;
  /** Align local grace timers with Redis state observed via Pub/Sub. */
  mirrorRemoteSession(session: GameSession): void;
  dispose(): void;
}

export interface ReconnectServiceDependencies {
  sessions: GameSessionStore;
  getSocket: (userId: string) => AuthenticatedSocket | undefined;
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void;
  fanout?: GameFanout;
  onMatchEnded?: (session: GameSession) => Promise<unknown>;
  onResumed?: (session: GameSession) => void | Promise<unknown>;
  scheduler?: TimerScheduler;
  now?: () => number;
  config?: Partial<ReconnectConfig>;
  onError?: (
    error: unknown,
    context: { gameId: string; during: string },
  ) => void;
}

function timerKey(gameId: string, seat: PlayerSeat): string {
  return `${gameId}:${seat}`;
}

export function matchViewStatus(
  session: GameSession,
): "picking" | "finished" | "forfeited" | "abandoned" {
  if (session.outcome?.kind === "abandoned") return "abandoned";
  if (session.outcome?.kind === "forfeit") return "forfeited";
  if (
    session.state.status === "finished" ||
    session.outcome?.kind === "completed"
  ) {
    return "finished";
  }
  return "picking";
}

function playerView(
  session: GameSession,
  seat: PlayerSeat,
): {
  userId: string;
  username: string;
  rating: number | null;
  score: number;
} {
  const isP1 = seat === "player1";
  return {
    userId: isP1 ? session.player1UserId : session.player2UserId,
    username:
      (isP1 ? session.player1Username : session.player2Username) ??
      (isP1 ? "Player1" : "Player2"),
    rating: (isP1 ? session.player1Rating : session.player2Rating) ?? null,
    score: session.state[seat].score,
  };
}

export function buildStateSnapshot(
  session: GameSession,
  seat: PlayerSeat,
): Extract<ServerMessage, { type: "game:state" }> {
  const other = seat === "player1" ? "player2" : "player1";
  return {
    type: "game:state",
    state: visiblePlayerState(session.state, seat),
    match: {
      gameId: session.id,
      round: session.state.round,
      category: session.state.category,
      status: matchViewStatus(session),
      history: session.state.history.map((round) => ({
        ...round,
        card1: { ...round.card1 },
        card2: { ...round.card2 },
      })),
      deadlineMs: session.deadlineMs,
      frozen: session.frozen,
      opponentConnected: session.connections[other].connected,
      yourGracePeriodExpiresAt: session.connections[seat].gracePeriodExpiresAt,
      yourSeat: seat,
      you: playerView(session, seat),
      opponent: playerView(session, other),
    },
  };
}

export function createReconnectService(
  deps: ReconnectServiceDependencies,
): ReconnectService {
  const scheduler = deps.scheduler ?? createDefaultScheduler();
  const now = deps.now ?? (() => Date.now());
  const config: ReconnectConfig = {
    ...DEFAULT_RECONNECT_CONFIG,
    ...deps.config,
  };
  const reportError =
    deps.onError ??
    ((error, context) => console.error("reconnect", context, error));
  const fanout =
    deps.fanout ?? createLocalGameFanout(deps.getSocket, deps.send);
  const graceTimers = new Map<string, TimerHandle>();

  function cancelGrace(gameId: string, seat: PlayerSeat): void {
    const key = timerKey(gameId, seat);
    const handle = graceTimers.get(key);
    if (!handle) return;
    handle.cancel();
    graceTimers.delete(key);
  }

  function cancelAllGrace(gameId: string): void {
    cancelGrace(gameId, "player1");
    cancelGrace(gameId, "player2");
  }

  function armGrace(session: GameSession, seat: PlayerSeat): void {
    const expiresAt = session.connections[seat].gracePeriodExpiresAt;
    if (expiresAt === null) return;
    cancelGrace(session.id, seat);
    const delayMs = Math.max(0, expiresAt - now());
    const handle = scheduler.schedule(delayMs, () => {
      graceTimers.delete(timerKey(session.id, seat));
      void expireGrace(session.id, seat).catch((error: unknown) => {
        reportError(error, { gameId: session.id, during: "grace expiration" });
      });
    });
    graceTimers.set(timerKey(session.id, seat), handle);
  }

  function mirrorRemoteSession(session: GameSession): void {
    if (isTerminal(session)) {
      cancelAllGrace(session.id);
      return;
    }
    for (const seat of ["player1", "player2"] as const) {
      const connection = session.connections[seat];
      if (
        !connection.connected &&
        connection.gracePeriodExpiresAt !== null
      ) {
        armGrace(session, seat);
      } else {
        cancelGrace(session.id, seat);
      }
    }
  }

  async function finish(session: GameSession): Promise<void> {
    cancelAllGrace(session.id);
    let winner: "player1" | "player2" | null = null;
    if (session.outcome?.kind === "forfeit") {
      winner = session.outcome.winner;
    } else if (
      session.outcome?.kind === "completed" ||
      session.state.status === "finished"
    ) {
      winner =
        session.state.player1.score > session.state.player2.score
          ? "player1"
          : "player2";
    }
    const reason =
      session.outcome?.kind === "abandoned"
        ? "abandoned"
        : session.outcome?.kind === "forfeit"
          ? "forfeit"
          : "completed";
    await fanout.gameEnded(session, { reason, winner });
    if (!deps.onMatchEnded) return;
    try {
      await deps.onMatchEnded(session);
    } catch (error) {
      reportError(error, { gameId: session.id, during: "match persistence" });
    }
  }

  async function expireGrace(
    gameId: string,
    seat: PlayerSeat,
  ): Promise<GameSession | null> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const session = await deps.sessions.get(gameId);
      if (!session) return null;
      const result = applyGraceExpired(session, seat, now());
      if (result.kind === "ignored") return session;
      const saved = await deps.sessions.update(result.session);
      if (!saved) continue;
      await finish(saved);
      return saved;
    }
    throw new Error(`Could not expire grace for ${gameId}:${seat}`);
  }

  async function attachConnection(
    socket: AuthenticatedSocket,
    gameId?: string,
  ): Promise<GameSession | null> {
    const activeId =
      gameId ?? (await deps.sessions.activeGameFor(socket.userId));
    if (!activeId) return null;
    if (gameId && activeId !== gameId) {
      const named = await deps.sessions.get(gameId);
      if (!named || !seatFor(named, socket.userId)) {
        deps.send(socket, { type: "error", message: "Game not found" });
        return null;
      }
    }

    const targetId = gameId ?? activeId;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const session = await deps.sessions.get(targetId);
      if (!session) {
        deps.send(socket, { type: "error", message: "Game not found" });
        return null;
      }

      const seat = seatFor(session, socket.userId);
      if (!seat) {
        deps.send(socket, {
          type: "error",
          message: "Not a participant in this game",
        });
        return null;
      }

      if (isTerminal(session)) {
        deps.send(socket, { type: "error", message: "Game already ended" });
        return session;
      }

      const wasDisconnected = !session.connections[seat].connected;
      const hadGrace = session.connections[seat].gracePeriodExpiresAt !== null;
      const result =
        wasDisconnected || hadGrace
          ? applyReconnect(session, seat, socket.connectionId, now())
          : {
              kind: "reconnected" as const,
              session: bindConnection(session, seat, socket.connectionId),
            };

      if (result.kind === "rejected") {
        deps.send(socket, { type: "error", message: result.reason });
        return null;
      }

      if (result.kind === "alreadyConnected") {
        deps.send(socket, { type: "game:joined", gameId: result.session.id });
        deps.send(socket, buildStateSnapshot(result.session, seat));
        return result.session;
      }

      const saved = await deps.sessions.update(result.session);
      if (!saved) continue;

      cancelGrace(saved.id, seat);

      deps.send(socket, { type: "game:joined", gameId: saved.id });
      deps.send(socket, buildStateSnapshot(saved, seat));

      if (wasDisconnected && !saved.frozen) {
        await fanout.gameResumed(saved);
        if (deps.onResumed) {
          await deps.onResumed(saved);
        }
      } else if (saved.frozen) {
        const disconnectedSeat = saved.connections.player1.connected
          ? "player2"
          : "player1";
        const expires =
          saved.connections[disconnectedSeat].gracePeriodExpiresAt;
        if (expires !== null) {
          deps.send(socket, {
            type: "game:paused",
            gracePeriodExpiresAt: expires,
          });
        }
      }

      return saved;
    }
    throw new Error(`Could not attach connection for user ${socket.userId}`);
  }

  async function onDisconnect(
    userId: string,
    connectionId: string | null,
  ): Promise<GameSession | null> {
    const activeId = await deps.sessions.activeGameFor(userId);
    if (!activeId) return null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const session = await deps.sessions.get(activeId);
      if (!session) return null;
      const seat = seatFor(session, userId);
      if (!seat) return null;

      const result = applyDisconnect(
        session,
        seat,
        connectionId,
        now(),
        config.gracePeriodMs,
      );
      if (result.kind === "ignored") return session;

      const saved = await deps.sessions.update(result.session);
      if (!saved) continue;

      if (result.kind === "abandoned") {
        await finish(saved);
        return saved;
      }

      cancelGrace(saved.id, seat);
      armGrace(saved, seat);
      const expiresAt = saved.connections[seat].gracePeriodExpiresAt;
      if (expiresAt !== null) {
        await fanout.gamePaused(saved, expiresAt, seat);
      }
      return saved;
    }
    throw new Error(`Could not disconnect user ${userId}`);
  }

  function dispose(): void {
    for (const handle of graceTimers.values()) {
      handle.cancel();
    }
    graceTimers.clear();
  }

  return {
    attachConnection,
    onDisconnect,
    mirrorRemoteSession,
    dispose,
  };
}
