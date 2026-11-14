import { draftPick } from "../game/draft";
import { createGame, createGameFromHands } from "../game/createGame";
import type { MatchmakingService } from "../matchmaking/service";
import type { ReconnectService } from "../reconnect/service";
import { buildStateSnapshot } from "../reconnect/service";
import type { ParsedClientMessage } from "./schemas";
import {
  draftViewForSeat,
  seatFor,
  visiblePlayerState,
  type GameSession,
  type GameSessionStore,
  type PlayerSeat,
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
  matchmaking?: MatchmakingService;
  reconnect?: ReconnectService;
}

function sendError(
  deps: HandlerDependencies,
  socket: AuthenticatedSocket,
  message: string,
): void {
  deps.send(socket, { type: "error", message });
}

function notifySeat(
  deps: HandlerDependencies,
  session: GameSession,
  seat: PlayerSeat,
  message: ServerMessage,
): void {
  const userId =
    seat === "player1" ? session.player1UserId : session.player2UserId;
  const socket = deps.getSocket(userId);
  if (socket) deps.send(socket, message);
}

function sendDraftState(
  deps: HandlerDependencies,
  session: GameSession,
  seat: PlayerSeat,
): void {
  const view = draftViewForSeat(session, seat);
  if (!view) return;
  notifySeat(deps, session, seat, {
    type: "game:draftState",
    gameId: session.id,
    draft: view.draft,
    yourPicks: view.yourPicks,
    opponentPickCount: view.opponentPickCount,
  });
}

function sendTacticState(
  deps: HandlerDependencies,
  session: GameSession,
  seat: PlayerSeat,
): void {
  if (!session.pendingTactics) return;
  const other = seat === "player1" ? "player2" : "player1";
  notifySeat(deps, session, seat, {
    type: "game:tacticState",
    gameId: session.id,
    you: session.pendingTactics[seat],
    opponentReady: session.pendingTactics[other] !== null,
  });
}

async function startPlaying(
  deps: HandlerDependencies,
  coordinator: RoundCoordinator,
  session: GameSession,
): Promise<void> {
  for (const seat of ["player1", "player2"] as const) {
    notifySeat(deps, session, seat, buildStateSnapshot(session, seat));
  }
  const round = await coordinator.beginRound(session.id);
  if (!round || !round.opened) return;
  const open = coordinator.roundStartMessage(round.session);
  if (!open) return;
  for (const seat of ["player1", "player2"] as const) {
    notifySeat(deps, round.session, seat, open);
  }
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
      case "game:draftPick":
        await handleDraftPick(deps, coordinator, socket, message);
        return;
      case "game:chooseTactic":
        await handleChooseTactic(deps, coordinator, socket, message);
        return;
      case "matchmaking:join":
        await handleMatchmakingJoin(deps, socket, message.mode);
        return;
      case "matchmaking:cancel":
        await handleMatchmakingCancel(deps, socket);
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
  if (deps.reconnect) {
    const attached = await deps.reconnect.attachConnection(socket, gameId);
    if (!attached) return;
    const seat = seatFor(attached, socket.userId);
    if (!seat) return;

    if (attached.phase === "drafting") {
      sendDraftState(deps, attached, seat);
      return;
    }
    if (attached.phase === "choosing_tactic") {
      sendTacticState(deps, attached, seat);
      return;
    }

    if (attached.frozen || attached.outcome) return;
    const round = await coordinator.beginRound(attached.id);
    if (!round || round.opened) return;
    const open = coordinator.roundStartMessage(round.session);
    if (open) deps.send(socket, open);
    return;
  }

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
  deps.send(socket, buildStateSnapshot(session, seat));

  if (session.phase === "drafting") {
    sendDraftState(deps, session, seat);
    return;
  }
  if (session.phase === "choosing_tactic") {
    sendTacticState(deps, session, seat);
    return;
  }

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

async function handleDraftPick(
  deps: HandlerDependencies,
  coordinator: RoundCoordinator,
  socket: AuthenticatedSocket,
  message: Extract<ParsedClientMessage, { type: "game:draftPick" }>,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const session = await deps.sessions.get(message.gameId);
    if (!session) {
      sendError(deps, socket, "Game not found");
      return;
    }
    if (session.phase !== "drafting" || !session.draft) {
      sendError(deps, socket, "Draft is not active");
      return;
    }
    const seat = seatFor(session, socket.userId);
    if (!seat) {
      sendError(deps, socket, "Not a participant in this game");
      return;
    }
    if (message.sequence <= session.lastSequence[seat]) {
      sendError(deps, socket, "Duplicate or outdated move");
      return;
    }

    let nextDraft;
    let complete: boolean;
    try {
      const result = draftPick(
        session.draft.draft,
        session.draft.pool,
        seat,
        message.cardId,
      );
      nextDraft = result.draft;
      complete = result.complete;
    } catch (error) {
      sendError(
        deps,
        socket,
        error instanceof Error ? error.message : "Invalid draft pick",
      );
      return;
    }

    if (!complete) {
      const saved = await deps.sessions.update({
        ...session,
        draft: { draft: nextDraft, pool: session.draft.pool },
        lastSequence: {
          ...session.lastSequence,
          [seat]: message.sequence,
        },
      });
      if (!saved) continue;
      sendDraftState(deps, saved, "player1");
      sendDraftState(deps, saved, "player2");
      return;
    }

    const playing = createGameFromHands(
      nextDraft.player1Picks,
      nextDraft.player2Picks,
      { mode: "draft" },
    );
    const saved = await deps.sessions.update({
      ...session,
      phase: "playing",
      draft: null,
      state: playing,
      lastSequence: {
        ...session.lastSequence,
        [seat]: message.sequence,
      },
    });
    if (!saved) continue;
    await startPlaying(deps, coordinator, saved);
    return;
  }
  sendError(deps, socket, "Draft pick failed");
}

async function handleChooseTactic(
  deps: HandlerDependencies,
  coordinator: RoundCoordinator,
  socket: AuthenticatedSocket,
  message: Extract<ParsedClientMessage, { type: "game:chooseTactic" }>,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const session = await deps.sessions.get(message.gameId);
    if (!session) {
      sendError(deps, socket, "Game not found");
      return;
    }
    if (session.phase !== "choosing_tactic" || !session.pendingTactics) {
      sendError(deps, socket, "Tactic selection is not active");
      return;
    }
    if (!session.pendingDecks) {
      sendError(deps, socket, "Missing decks for tactical match");
      return;
    }
    const seat = seatFor(session, socket.userId);
    if (!seat) {
      sendError(deps, socket, "Not a participant in this game");
      return;
    }
    if (message.sequence <= session.lastSequence[seat]) {
      sendError(deps, socket, "Duplicate or outdated move");
      return;
    }
    if (session.pendingTactics[seat] !== null) {
      sendError(deps, socket, "Tactic already locked");
      return;
    }

    const pendingTactics = {
      ...session.pendingTactics,
      [seat]: message.tactic,
    };
    const bothReady =
      pendingTactics.player1 !== null && pendingTactics.player2 !== null;

    if (!bothReady) {
      const saved = await deps.sessions.update({
        ...session,
        pendingTactics,
        lastSequence: {
          ...session.lastSequence,
          [seat]: message.sequence,
        },
      });
      if (!saved) continue;
      sendTacticState(deps, saved, "player1");
      sendTacticState(deps, saved, "player2");
      return;
    }

    const state = createGame(
      session.pendingDecks.player1Deck,
      session.pendingDecks.player2Deck,
      session.state.category,
      "tactical",
      {
        player1: pendingTactics.player1!,
        player2: pendingTactics.player2!,
      },
    );
    const saved = await deps.sessions.update({
      ...session,
      phase: "playing",
      pendingTactics: null,
      pendingDecks: null,
      state,
      lastSequence: {
        ...session.lastSequence,
        [seat]: message.sequence,
      },
    });
    if (!saved) continue;
    await startPlaying(deps, coordinator, saved);
    return;
  }
  sendError(deps, socket, "Tactic selection failed");
}

async function handleMatchmakingJoin(
  deps: HandlerDependencies,
  socket: AuthenticatedSocket,
  mode: Parameters<NonNullable<HandlerDependencies["matchmaking"]>["join"]>[1],
): Promise<void> {
  if (!deps.matchmaking) {
    sendError(deps, socket, "Matchmaking unavailable");
    return;
  }
  await deps.matchmaking.join(socket.userId, mode);
}

async function handleMatchmakingCancel(
  deps: HandlerDependencies,
  socket: AuthenticatedSocket,
): Promise<void> {
  if (!deps.matchmaking) {
    sendError(deps, socket, "Matchmaking unavailable");
    return;
  }
  await deps.matchmaking.cancel(socket.userId);
}

export type { HandlerDependencies as MessageHandlerDependencies };
