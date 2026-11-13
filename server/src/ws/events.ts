import type { GameBusEvent, UserBusEvent } from "../redis/events";
import {
  deliverRoundResolvedLocally,
  deliverToLocalPlayers,
} from "./fanout";
import {
  isTerminal,
  type GameSession,
  type GameSessionStore,
} from "./gameSessions";
import type { RoundCoordinator } from "./roundCoordinator";
import type { ReconnectService } from "../reconnect/service";
import type { AuthenticatedSocket, ServerMessage } from "./types";

export interface GameEventRouter {
  handleGameEvent(event: GameBusEvent): Promise<void>;
  handleUserEvent(userId: string, event: UserBusEvent): Promise<void>;
}

export interface GameEventRouterOptions {
  instanceId: string;
  sessions: GameSessionStore;
  getSocket: (userId: string) => AuthenticatedSocket | undefined;
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void;
  coordinator: RoundCoordinator;
  reconnect: ReconnectService;
}

/**
 * Apply a Redis game event on this instance: talk only to local sockets,
 * and keep local timers / grace watches aligned with shared Redis state.
 */
export function createGameEventRouter(
  options: GameEventRouterOptions,
): GameEventRouter {
  const { instanceId, sessions, getSocket, send, coordinator, reconnect } =
    options;

  async function load(gameId: string): Promise<GameSession | null> {
    return sessions.get(gameId);
  }

  return {
    async handleGameEvent(event) {
      // Origin already delivered locally and armed its own timers.
      if (event.originInstanceId === instanceId) return;

      const session = await load(event.gameId);
      if (!session) return;

      switch (event.kind) {
        case "round_started": {
          deliverToLocalPlayers(session, getSocket, send, {
            type: "game:roundStart",
            gameId: event.gameId,
            round: event.round,
            category: event.category,
            deadlineMs: event.deadlineMs,
          });
          await coordinator.beginRound(event.gameId);
          return;
        }
        case "round_resolved": {
          deliverRoundResolvedLocally(session, getSocket, send);
          if (!event.finished && !isTerminal(session)) {
            if (
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
            await coordinator.beginRound(session.id);
          } else {
            coordinator.pause(session.id);
          }
          return;
        }
        case "game_paused": {
          deliverToLocalPlayers(session, getSocket, send, {
            type: "game:paused",
            gracePeriodExpiresAt: event.gracePeriodExpiresAt,
          });
          coordinator.pause(session.id);
          reconnect.mirrorRemoteSession(session);
          return;
        }
        case "game_resumed": {
          deliverToLocalPlayers(session, getSocket, send, {
            type: "game:resumed",
            deadlineMs: event.deadlineMs,
          });
          reconnect.mirrorRemoteSession(session);
          if (
            !session.frozen &&
            !isTerminal(session) &&
            session.deadlineMs !== null
          ) {
            deliverToLocalPlayers(session, getSocket, send, {
              type: "game:roundStart",
              gameId: session.id,
              round: event.round,
              category: event.category,
              deadlineMs: session.deadlineMs,
            });
            coordinator.resume(session, { notify: false });
          }
          return;
        }
        case "game_ended": {
          deliverToLocalPlayers(session, getSocket, send, {
            type: "game:ended",
            reason: event.reason,
            winner: event.winner,
          });
          coordinator.pause(session.id);
          reconnect.mirrorRemoteSession(session);
          return;
        }
      }
    },

    async handleUserEvent(userId, event) {
      if (event.originInstanceId === instanceId) return;
      if (event.kind !== "deliver") return;
      const socket = getSocket(userId);
      if (socket) send(socket, event.message);
    },
  };
}
