import type { ParsedClientMessage } from "./schemas";
import { visiblePlayerState, type GameSessionStore } from "./gameSessions";
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
  const session = deps.sessions.get(gameId);
  if (!session) {
    sendError(deps, socket, "Game not found");
    return;
  }

  const seat = deps.sessions.seatFor(session, socket.userId);
  if (!seat) {
    sendError(deps, socket, "Not a participant in this game");
    return;
  }

  deps.send(socket, { type: "game:joined", gameId: session.id });
  deps.send(socket, {
    type: "game:state",
    state: visiblePlayerState(session.state, seat),
  });
  const open = coordinator.roundStartMessage(session);
  if (open) deps.send(socket, open);
}

async function handlePick(
  deps: HandlerDependencies,
  coordinator: RoundCoordinator,
  socket: AuthenticatedSocket,
  message: Extract<ParsedClientMessage, { type: "game:pick" }>,
): Promise<void> {
  const session = deps.sessions.get(message.gameId);
  if (!session) {
    sendError(deps, socket, "Game not found");
    return;
  }

  const seat = deps.sessions.seatFor(session, socket.userId);
  if (!seat) {
    sendError(deps, socket, "Not a participant in this game");
    return;
  }

  if (session.state.status !== "picking") {
    sendError(deps, socket, "Game is not accepting picks");
    return;
  }

  if (message.round !== session.state.round) {
    sendError(deps, socket, "Incorrect round number");
    return;
  }

  if (message.sequence <= session.lastSequence[seat]) {
    sendError(deps, socket, "Duplicate or outdated move");
    return;
  }

  const result = coordinator.submitPick({
    session,
    seat,
    round: message.round,
    cardId: message.cardId,
  });

  if (result.status === "rejected") {
    sendError(deps, socket, result.message);
    return;
  }

  session.lastSequence[seat] = message.sequence;
  deps.sessions.save(session);

  if (result.status === "waiting") {
    deps.send(socket, {
      type: "game:state",
      state: visiblePlayerState(session.state, seat),
    });
  }
}

export type { HandlerDependencies as MessageHandlerDependencies };
