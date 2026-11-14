import type { GameBusEvent } from "../redis/events";
import type { EventPublisher } from "../redis/publisher";
import {
  isTerminal,
  seatFor,
  userIdForSeat,
  visiblePlayerState,
  type GameSession,
  type PlayerSeat,
} from "./gameSessions";
import type { AuthenticatedSocket, ServerMessage } from "./types";

/**
 * Fan-out of multiplayer notices.
 * Local mode talks to sockets on this process.
 * Redis mode delivers locally on the originating instance and publishes so
 * peer instances can reach their own sockets (subscribers ignore own origin).
 */
export interface GameFanout {
  roundStarted(session: GameSession): Promise<void>;
  roundResolved(session: GameSession): Promise<void>;
  gamePaused(
    session: GameSession,
    gracePeriodExpiresAt: number,
    disconnectedSeat: PlayerSeat,
  ): Promise<void>;
  gameResumed(session: GameSession): Promise<void>;
  gameEnded(
    session: GameSession,
    payload: {
      reason: "completed" | "forfeit" | "abandoned";
      winner: PlayerSeat | null;
      ratings?: { player1: number; player2: number };
      ratingDelta?: number | null;
    },
  ): Promise<void>;
  notifyUser(userId: string, message: ServerMessage): Promise<void>;
}

export function deliverToLocalPlayers(
  session: GameSession,
  getSocket: (userId: string) => AuthenticatedSocket | undefined,
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void,
  message: ServerMessage,
): void {
  for (const userId of [session.player1UserId, session.player2UserId]) {
    const socket = getSocket(userId);
    if (socket) send(socket, message);
  }
}

export function deliverRoundResolvedLocally(
  session: GameSession,
  getSocket: (userId: string) => AuthenticatedSocket | undefined,
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void,
): void {
  const completed = session.state.history[session.state.history.length - 1];
  if (!completed) return;
  for (const seat of ["player1", "player2"] as const) {
    const socket = getSocket(userIdForSeat(session, seat));
    if (!socket) continue;
    send(socket, { type: "game:roundResult", round: completed });
    send(socket, {
      type: "game:state",
      state: visiblePlayerState(session.state, seat),
    });
  }
}

export function createLocalGameFanout(
  getSocket: (userId: string) => AuthenticatedSocket | undefined,
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void,
): GameFanout {
  return {
    async roundStarted(session) {
      if (
        session.frozen ||
        session.state.status !== "picking" ||
        session.deadlineMs === null
      ) {
        return;
      }
      deliverToLocalPlayers(session, getSocket, send, {
        type: "game:roundStart",
        gameId: session.id,
        round: session.state.round,
        category: session.state.category,
        deadlineMs: session.deadlineMs,
      });
    },

    async roundResolved(session) {
      deliverRoundResolvedLocally(session, getSocket, send);
      if (
        !isTerminal(session) &&
        session.state.status === "picking" &&
        session.deadlineMs !== null
      ) {
        deliverToLocalPlayers(session, getSocket, send, {
          type: "game:roundStart",
          gameId: session.id,
          round: session.state.round,
          category: session.state.category,
          deadlineMs: session.deadlineMs,
        });
      }
    },

    async gamePaused(session, gracePeriodExpiresAt) {
      deliverToLocalPlayers(session, getSocket, send, {
        type: "game:paused",
        gracePeriodExpiresAt,
      });
    },

    async gameResumed(session) {
      deliverToLocalPlayers(session, getSocket, send, {
        type: "game:resumed",
        deadlineMs: session.deadlineMs,
      });
      if (
        !session.frozen &&
        !isTerminal(session) &&
        session.state.status === "picking" &&
        session.deadlineMs !== null
      ) {
        deliverToLocalPlayers(session, getSocket, send, {
          type: "game:roundStart",
          gameId: session.id,
          round: session.state.round,
          category: session.state.category,
          deadlineMs: session.deadlineMs,
        });
      }
    },

    async gameEnded(session, payload) {
      deliverToLocalPlayers(session, getSocket, send, {
        type: "game:ended",
        reason: payload.reason,
        winner: payload.winner,
        ...(payload.ratings ? { ratings: payload.ratings } : {}),
        ...(payload.ratingDelta !== undefined
          ? { ratingDelta: payload.ratingDelta }
          : {}),
      });
    },

    async notifyUser(userId, message) {
      const socket = getSocket(userId);
      if (socket) send(socket, message);
    },
  };
}

export function createRedisGameFanout(
  publisher: EventPublisher,
  instanceId: string,
  local: GameFanout,
): GameFanout {
  return {
    async roundStarted(session) {
      await local.roundStarted(session);
      if (session.deadlineMs === null) return;
      const event: GameBusEvent = {
        kind: "round_started",
        gameId: session.id,
        round: session.state.round,
        category: session.state.category,
        deadlineMs: session.deadlineMs,
        originInstanceId: instanceId,
      };
      await publisher.publishGame(event);
    },

    async roundResolved(session) {
      await local.roundResolved(session);
      const event: GameBusEvent = {
        kind: "round_resolved",
        gameId: session.id,
        finished: isTerminal(session),
        originInstanceId: instanceId,
      };
      await publisher.publishGame(event);
    },

    async gamePaused(session, gracePeriodExpiresAt, disconnectedSeat) {
      await local.gamePaused(session, gracePeriodExpiresAt, disconnectedSeat);
      const event: GameBusEvent = {
        kind: "game_paused",
        gameId: session.id,
        gracePeriodExpiresAt,
        disconnectedSeat,
        originInstanceId: instanceId,
      };
      await publisher.publishGame(event);
    },

    async gameResumed(session) {
      await local.gameResumed(session);
      const event: GameBusEvent = {
        kind: "game_resumed",
        gameId: session.id,
        deadlineMs: session.deadlineMs,
        round: session.state.round,
        category: session.state.category,
        originInstanceId: instanceId,
      };
      await publisher.publishGame(event);
    },

    async gameEnded(session, payload) {
      await local.gameEnded(session, payload);
      const event: GameBusEvent = {
        kind: "game_ended",
        gameId: session.id,
        reason: payload.reason,
        winner: payload.winner,
        ratings: payload.ratings,
        ratingDelta: payload.ratingDelta,
        originInstanceId: instanceId,
      };
      await publisher.publishGame(event);
    },

    async notifyUser(userId, message) {
      await local.notifyUser(userId, message);
      await publisher.publishUser(userId, {
        kind: "deliver",
        message,
        originInstanceId: instanceId,
      });
    },
  };
}

export function seatOfUser(
  session: GameSession,
  userId: string,
): PlayerSeat | null {
  return seatFor(session, userId);
}
