import { resolveCurrentRound } from "../game/resolveCurrentRound";
import { submitPick } from "../game/submitPick";
import type { ParsedClientMessage } from "./schemas";
import {
  nextCategory,
  visiblePlayerState,
  type GameSessionStore,
} from "./gameSessions";
import type { AuthenticatedSocket, ServerMessage } from "./types";

export interface HandlerDependencies {
  sessions: GameSessionStore;
  getSocket: (userId: string) => AuthenticatedSocket | undefined;
  send: (socket: AuthenticatedSocket, message: ServerMessage) => void;
}

function sendError(
  deps: HandlerDependencies,
  socket: AuthenticatedSocket,
  message: string,
): void {
  deps.send(socket, { type: "error", message });
}

export function createMessageHandler(deps: HandlerDependencies) {
  return async function handleMessage(
    socket: AuthenticatedSocket,
    message: ParsedClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case "game:join":
        await handleJoin(deps, socket, message.gameId);
        return;
      case "game:pick":
        await handlePick(deps, socket, message);
        return;
    }
  };
}

async function handleJoin(
  deps: HandlerDependencies,
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
}

async function handlePick(
  deps: HandlerDependencies,
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

  const before = session.state;
  let nextState;
  try {
    nextState = submitPick(before, seat, message.cardId);
  } catch (error) {
    const text = error instanceof Error ? error.message : "Invalid pick";
    sendError(deps, socket, text);
    return;
  }

  session.lastSequence[seat] = message.sequence;
  session.state = nextState;

  const bothPicked =
    session.state.player1.selectedCardId !== null &&
    session.state.player2.selectedCardId !== null;

  if (!bothPicked) {
    deps.sessions.save(session);
    deps.send(socket, {
      type: "game:state",
      state: visiblePlayerState(session.state, seat),
    });
    return;
  }

  const resolved = resolveCurrentRound(session.state, nextCategory(session.state.category));
  const completedRound = resolved.history[resolved.history.length - 1];
  session.state = resolved;
  deps.sessions.save(session);

  const player1Socket = deps.getSocket(session.player1UserId);
  const player2Socket = deps.getSocket(session.player2UserId);

  if (completedRound) {
    if (player1Socket) {
      deps.send(player1Socket, { type: "game:roundResult", round: completedRound });
      deps.send(player1Socket, {
        type: "game:state",
        state: visiblePlayerState(resolved, "player1"),
      });
    }
    if (player2Socket) {
      deps.send(player2Socket, { type: "game:roundResult", round: completedRound });
      deps.send(player2Socket, {
        type: "game:state",
        state: visiblePlayerState(resolved, "player2"),
      });
    }
  }
}

export type { HandlerDependencies as MessageHandlerDependencies };
