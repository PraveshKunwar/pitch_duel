import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import { GameSocket } from "../services/websocket";
import type {
  Card,
  CompletedRound,
  ConnectionUiState,
  DraftState,
  GameMode,
  MatchView,
  MatchmakingUiStatus,
  PlayerSeat,
  PlayerState,
  ServerMessage,
  SessionPhase,
  StatCategory,
  Tactic,
} from "../types/game";

export type GameClientState = {
  connection: ConnectionUiState;
  matchmaking: MatchmakingUiStatus;
  matchmakingRating: number | null;
  matchmakingMode: GameMode | null;
  error: string | null;
  gameId: string | null;
  privateState: PlayerState | null;
  match: MatchView | null;
  round: number;
  category: StatCategory | null;
  deadlineMs: number | null;
  lastRoundResult: CompletedRound | null;
  history: CompletedRound[];
  pickPending: boolean;
  endedReason: "completed" | "forfeit" | "abandoned" | null;
  endedWinner: PlayerSeat | null;
  /** Your post-match Elo from game:ended (live update, no refresh). */
  yourNewRating: number | null;
  opponentUsername: string | null;
  opponentRating: number | null;
  phase: SessionPhase;
  draft: DraftState | null;
  yourDraftPicks: Card[];
  opponentDraftCount: number;
  yourTactic: Tactic | null;
  opponentTacticReady: boolean;
};

const initialState: GameClientState = {
  connection: "idle",
  matchmaking: "idle",
  matchmakingRating: null,
  matchmakingMode: null,
  error: null,
  gameId: null,
  privateState: null,
  match: null,
  round: 1,
  category: null,
  deadlineMs: null,
  lastRoundResult: null,
  history: [],
  pickPending: false,
  endedReason: null,
  endedWinner: null,
  yourNewRating: null,
  opponentUsername: null,
  opponentRating: null,
  phase: "playing",
  draft: null,
  yourDraftPicks: [],
  opponentDraftCount: 0,
  yourTactic: null,
  opponentTacticReady: false,
};

export function useGameSocket(enabled: boolean) {
  const socketRef = useRef<GameSocket | null>(null);
  const sequenceRef = useRef(1);
  const [state, setState] = useState<GameClientState>(initialState);

  const handleMessage = useCallback((message: ServerMessage) => {
    setState((prev) => {
      switch (message.type) {
        case "matchmaking:queued":
          return {
            ...prev,
            matchmaking: "queued",
            matchmakingRating: message.rating,
            matchmakingMode: message.mode,
            error: null,
          };
        case "matchmaking:found":
          return {
            ...prev,
            matchmaking: "found",
            gameId: message.gameId,
            matchmakingMode: message.mode,
            opponentUsername: message.opponentUsername,
            opponentRating: message.opponentRating,
            endedReason: null,
            endedWinner: null,
            yourNewRating: null,
            lastRoundResult: null,
            history: [],
            draft: null,
            yourDraftPicks: [],
            opponentDraftCount: 0,
            yourTactic: null,
            opponentTacticReady: false,
            phase:
              message.mode === "draft"
                ? "drafting"
                : message.mode === "tactical"
                  ? "choosing_tactic"
                  : "playing",
            error: null,
          };
        case "matchmaking:timeout":
          return { ...prev, matchmaking: "timeout" };
        case "matchmaking:cancelled":
          return {
            ...prev,
            matchmaking: "cancelled",
            matchmakingRating: null,
          };
        case "game:joined":
          return {
            ...prev,
            gameId: message.gameId,
            matchmaking: "idle",
            connection:
              prev.connection === "reconnecting"
                ? "match_resumed"
                : "connected",
            error: null,
          };
        case "game:state": {
          let match = message.match ?? prev.match;
          if (match && !message.match) {
            match = {
              ...match,
              you: { ...match.you, score: message.state.score },
            };
          }
          return {
            ...prev,
            privateState: message.state,
            match,
            gameId: match?.gameId ?? prev.gameId,
            round: match?.round ?? prev.round,
            category: match?.category ?? prev.category,
            deadlineMs: match?.deadlineMs ?? prev.deadlineMs,
            history: match?.history ?? prev.history,
            pickPending: Boolean(message.state.selectedCardId),
            phase: match?.phase ?? prev.phase,
            matchmakingMode: match?.mode ?? prev.matchmakingMode,
            opponentUsername:
              match?.opponent.username ?? prev.opponentUsername,
            opponentRating: match?.opponent.rating ?? prev.opponentRating,
            connection: match?.frozen
              ? "opponent_disconnected"
              : prev.connection === "reconnecting"
                ? "match_resumed"
                : "connected",
          };
        }
        case "game:draftState":
          return {
            ...prev,
            gameId: message.gameId,
            phase: "drafting",
            draft: message.draft,
            yourDraftPicks: message.yourPicks,
            opponentDraftCount: message.opponentPickCount,
            matchmaking: "idle",
            connection: "connected",
          };
        case "game:tacticState":
          return {
            ...prev,
            gameId: message.gameId,
            phase: "choosing_tactic",
            yourTactic: message.you,
            opponentTacticReady: message.opponentReady,
            matchmaking: "idle",
            connection: "connected",
          };
        case "game:roundStart":
          return {
            ...prev,
            gameId: message.gameId,
            round: message.round,
            category: message.category,
            deadlineMs: message.deadlineMs,
            pickPending: false,
            lastRoundResult: null,
            privateState: prev.privateState
              ? { ...prev.privateState, selectedCardId: null }
              : prev.privateState,
            connection: "connected",
          };
        case "game:roundResult": {
          const history = [
            ...prev.history.filter((r) => r.round !== message.round.round),
            message.round,
          ].sort((a, b) => a.round - b.round);
          const seat = prev.match?.yourSeat;
          let match = prev.match;
          if (match && seat) {
            const youScore = history.filter((r) => r.result.winner === seat)
              .length;
            const oppScore = history.filter((r) => r.result.winner !== seat)
              .length;
            match = {
              ...match,
              history,
              you: { ...match.you, score: youScore },
              opponent: { ...match.opponent, score: oppScore },
            };
          }
          return {
            ...prev,
            lastRoundResult: message.round,
            history,
            match,
            pickPending: false,
          };
        }
        case "game:paused":
          return {
            ...prev,
            connection: "opponent_disconnected",
            match: prev.match
              ? {
                  ...prev.match,
                  frozen: true,
                  yourGracePeriodExpiresAt: message.gracePeriodExpiresAt,
                }
              : prev.match,
          };
        case "game:resumed":
          return {
            ...prev,
            connection: "match_resumed",
            deadlineMs: message.deadlineMs,
            match: prev.match
              ? {
                  ...prev.match,
                  frozen: false,
                  deadlineMs: message.deadlineMs,
                  opponentConnected: true,
                }
              : prev.match,
          };
        case "game:ended": {
          let connection: ConnectionUiState = "match_completed";
          if (message.reason === "forfeit") connection = "opponent_forfeited";
          if (message.reason === "abandoned") connection = "match_abandoned";
          const seat = prev.match?.yourSeat;
          const ratings = message.ratings;
          let match = prev.match;
          let yourNewRating: number | null = null;
          if (match) {
            const status =
              message.reason === "abandoned"
                ? "abandoned"
                : message.reason === "forfeit"
                  ? "forfeited"
                  : "finished";
            match = { ...match, status };
            if (ratings && seat) {
              const youRating = ratings[seat];
              const oppSeat = seat === "player1" ? "player2" : "player1";
              yourNewRating = youRating;
              match = {
                ...match,
                you: { ...match.you, rating: youRating },
                opponent: {
                  ...match.opponent,
                  rating: ratings[oppSeat],
                },
              };
            }
          } else if (ratings && seat) {
            yourNewRating = ratings[seat];
          }
          return {
            ...prev,
            endedReason: message.reason,
            endedWinner: message.winner,
            yourNewRating,
            match,
            connection,
            pickPending: false,
            matchmaking: "idle",
          };
        }
        case "error":
          return { ...prev, error: message.message, pickPending: false };
        default:
          return prev;
      }
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      socketRef.current?.close();
      socketRef.current = null;
      setState(initialState);
      sequenceRef.current = 1;
      return;
    }

    const socket = new GameSocket();
    socketRef.current = socket;
    const offMessage = socket.onMessage(handleMessage);
    const offStatus = socket.onStatus((status) => {
      setState((prev) => {
        if (status === "connecting") {
          return { ...prev, connection: "connecting" };
        }
        if (status === "reconnecting") {
          return { ...prev, connection: "reconnecting" };
        }
        if (status === "open") {
          return {
            ...prev,
            connection:
              prev.connection === "reconnecting" ||
              prev.connection === "match_resumed"
                ? "match_resumed"
                : "connected",
          };
        }
        return prev;
      });
    });

    void socket
      .connect(() => api.wsTicket())
      .catch((error: unknown) => {
        setState((prev) => ({
          ...prev,
          error:
            error instanceof Error
              ? error.message
              : "Failed to connect WebSocket",
          connection: "idle",
        }));
      });

    return () => {
      offMessage();
      offStatus();
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [enabled, handleMessage]);

  // Auto-join when matchmaking finds a game
  useEffect(() => {
    if (state.matchmaking !== "found" || !state.gameId) return;
    try {
      socketRef.current?.send({ type: "game:join", gameId: state.gameId });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Join failed",
      }));
    }
  }, [state.matchmaking, state.gameId]);

  const findMatch = useCallback((mode: GameMode) => {
    setState((prev) => ({
      ...prev,
      error: null,
      endedReason: null,
      endedWinner: null,
      yourNewRating: null,
      lastRoundResult: null,
      matchmaking: "queued",
      matchmakingMode: mode,
    }));
    socketRef.current?.send({ type: "matchmaking:join", mode });
  }, []);

  const cancelMatchmaking = useCallback(() => {
    socketRef.current?.send({ type: "matchmaking:cancel" });
  }, []);

  const submitDraftPick = useCallback(
    (cardId: string) => {
      if (!state.gameId || state.phase !== "drafting") return;
      const sequence = sequenceRef.current;
      sequenceRef.current += 1;
      try {
        socketRef.current?.send({
          type: "game:draftPick",
          gameId: state.gameId,
          sequence,
          cardId,
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "Draft pick failed",
        }));
      }
    },
    [state.gameId, state.phase],
  );

  const submitTactic = useCallback(
    (tactic: Tactic) => {
      if (!state.gameId || state.phase !== "choosing_tactic") return;
      const sequence = sequenceRef.current;
      sequenceRef.current += 1;
      setState((prev) => ({ ...prev, yourTactic: tactic }));
      try {
        socketRef.current?.send({
          type: "game:chooseTactic",
          gameId: state.gameId,
          sequence,
          tactic,
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "Tactic lock failed",
        }));
      }
    },
    [state.gameId, state.phase],
  );

  const submitPick = useCallback(
    (cardId: string) => {
      if (
        !state.gameId ||
        state.pickPending ||
        state.match?.frozen ||
        state.privateState?.selectedCardId
      ) {
        return;
      }
      const sequence = sequenceRef.current;
      sequenceRef.current += 1;
      setState((prev) => ({ ...prev, pickPending: true, error: null }));
      try {
        socketRef.current?.send({
          type: "game:pick",
          gameId: state.gameId,
          round: state.round,
          sequence,
          cardId,
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          pickPending: false,
          error: error instanceof Error ? error.message : "Pick failed",
        }));
      }
    },
    [
      state.gameId,
      state.pickPending,
      state.match?.frozen,
      state.round,
      state.privateState?.selectedCardId,
    ],
  );

  const returnToLobby = useCallback(() => {
    sequenceRef.current = 1;
    setState((prev) => ({
      ...initialState,
      connection: prev.connection === "idle" ? "idle" : "connected",
    }));
  }, []);

  return {
    state,
    findMatch,
    cancelMatchmaking,
    submitPick,
    submitDraftPick,
    submitTactic,
    returnToLobby,
  };
}
