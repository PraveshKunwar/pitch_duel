import type { ParsedClientMessage } from "./schemas";
import {
  seatFor,
  visiblePlayerState,
  type GameSessionStore,
} from "./gameSessions";
import {
  createRoundCoordinator,
  type RoundCoordinator,
} from "./roundCoordinator";
import type { AuthenticatedSocket, ServerMessage } from "./types";

export interface HandlerDependencies {
  sessions: GameSessionStore;
  getSocket: (userId: string) => AuthenticatedSocket | undefined;
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void;
  coordinator?: RoundCoordinator;
}

function sendError(
  deps: HandlerDependencies,
  socket: AuthenticatedSocket,
  message: string,
): void {
  deps.send(socket, { type: "error", message });
}

export function createMessageHandler(deps: HandlerDependencies) {
  const coordinator =
    deps.coordinator ??
    createRoundCoordinator({
      sessions: deps.sessions,
      getSocket: deps.getSocket,
      send: deps.send,
    });

  return async function handleMessage(
    socket: AuthenticatedSocket,
    message: ParsedClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case "game:join":
        await handleJoin(deps, coordinator, socket, message.gameId);
        return;
      case "game:pick":
        await handlePick(deps, coordinator, socket, message);
        return;
    }
  };
}

async function handleJoin(
  deps: HandlerDependencies,
  coordinator: RoundCoordinator,
  socket: AuthenticatedSocket,
  gameId: string,
): Promise<void> {
  const session = await deps.sessions.get(gameId);
  if (!session) {
    sendError(deps, socket, "Game not found");
    return;
  }

  const seat = seatFor(session, socket.userId);
  if (!seat) {
    sendError(deps, socket, "Not a participant in this game");
    return;
  }

  deps.send(socket, { type: "game:joined", gameId: session.id });
  deps.send(socket, {
    type: "game:state",
    state: visiblePlayerState(session.state, seat),
  });

  const round = await coordinator.beginRound(session.id);
  if (!round || round.opened) return;
  const open = coordinator.roundStartMessage(round.session);
  if (open) deps.send(socket, open);
}

async function handlePick(
  deps: HandlerDependencies,
  coordinator: RoundCoordinator,
  socket: AuthenticatedSocket,
  message: Extract<ParsedClientMessage, { type: "game:pick" }>,
): Promise<void> {
  const result = await coordinator.submitPick({
    gameId: message.gameId,
    userId: socket.userId,
    round: message.round,
    sequence: message.sequence,
    cardId: message.cardId,
  });

  if (result.status === "rejected") {
    sendError(deps, socket, result.message);
    return;
  }

  if (result.status === "waiting") {
    deps.send(socket, {
      type: "game:state",
      state: visiblePlayerState(result.session.state, result.seat),
    });
  }
}

export type { HandlerDependencies as MessageHandlerDependencies };
