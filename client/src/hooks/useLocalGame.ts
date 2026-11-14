import { useCallback, useMemo, useState } from "react";
import cards from "../data/players.json";
import {
  buildDecks,
  cpuDraftPick,
  cpuPick,
  cpuTactic,
  createDraftWithPool,
  createGame,
  draftPick,
  finishDraft,
  matchWinner,
  resolveCurrentRound,
  submitPick,
  visiblePlayerState,
} from "../game/engine";
import type { GameClientState } from "./useGameSocket";
import type {
  Card,
  DraftState,
  GameMode,
  GameState,
  Tactic,
  User,
} from "../types/game";

const ALL_CARDS = cards as Card[];

type LocalMeta = {
  youName: string;
  youRating: number;
};

export type LocalPhase =
  | "idle"
  | "selecting_mode"
  | "drafting"
  | "choosing_tactic"
  | "playing";

type LocalSession = {
  phase: LocalPhase;
  mode: GameMode | null;
  game: GameState | null;
  draft: DraftState | null;
  draftPool: Card[] | null;
  yourTactic: Tactic | null;
  pickPending: boolean;
};

const EMPTY: LocalSession = {
  phase: "idle",
  mode: null,
  game: null,
  draft: null,
  draftPool: null,
  yourTactic: null,
  pickPending: false,
};

function toClientState(
  session: LocalSession,
  meta: LocalMeta,
): GameClientState {
  const game = session.game;
  if (!game) {
    return {
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
      opponentUsername: "Computer",
      opponentRating: null,
      phase: "playing",
      draft: null,
      yourDraftPicks: [],
      opponentDraftCount: 0,
      yourTactic: null,
      opponentTacticReady: false,
    };
  }

  const finished = game.status === "finished";
  const last = game.history[game.history.length - 1] ?? null;
  const winner = matchWinner(game);
  return {
    connection: finished ? "match_completed" : "connected",
    matchmaking: "idle",
    matchmakingRating: null,
    matchmakingMode: game.mode,
    error: null,
    gameId: `local-${game.mode}`,
    privateState: visiblePlayerState(game.player1),
    match: {
      gameId: `local-${game.mode}`,
      round: game.round,
      category: game.category,
      status: finished ? "finished" : "picking",
      mode: game.mode,
      phase: "playing",
      suddenDeath: game.suddenDeath,
      regulationRounds: game.regulationRounds,
      history: game.history,
      deadlineMs: null,
      frozen: false,
      opponentConnected: true,
      yourGracePeriodExpiresAt: null,
      yourSeat: "player1",
      you: {
        userId: "you",
        username: meta.youName,
        rating: meta.youRating,
        score: game.player1.score,
      },
      opponent: {
        userId: "cpu",
        username: "Computer",
        rating: null,
        score: game.player2.score,
      },
      tactics: game.tactics
        ? { you: game.tactics.player1, opponent: game.tactics.player2 }
        : null,
    },
    round: game.round,
    category: game.category,
    deadlineMs: null,
    lastRoundResult: last,
    history: game.history,
    pickPending: session.pickPending,
    endedReason: finished ? "completed" : null,
    endedWinner: winner,
    opponentUsername: "Computer",
    opponentRating: null,
    phase: "playing",
    draft: null,
    yourDraftPicks: [],
    opponentDraftCount: 0,
    yourTactic: game.tactics?.player1 ?? null,
    opponentTacticReady: Boolean(game.tactics),
  };
}

export function useLocalGame(user: User | null) {
  const [session, setSession] = useState<LocalSession>(EMPTY);
  const meta = useMemo<LocalMeta>(
    () => ({
      youName: user?.username ?? "You",
      youRating: user?.rating ?? 1000,
    }),
    [user?.username, user?.rating],
  );

  const state = useMemo(
    () => toClientState(session, meta),
    [session, meta],
  );

  const openModeSelect = useCallback(() => {
    setSession({
      ...EMPTY,
      phase: "selecting_mode",
    });
  }, []);

  const selectMode = useCallback((mode: GameMode) => {
    if (mode === "draft") {
      const { draft, pool } = createDraftWithPool(ALL_CARDS, 5);
      setSession({
        ...EMPTY,
        phase: "drafting",
        mode,
        draft,
        draftPool: pool,
      });
      return;
    }
    if (mode === "tactical") {
      setSession({
        ...EMPTY,
        phase: "choosing_tactic",
        mode,
      });
      return;
    }
    const decks = buildDecks(ALL_CARDS);
    setSession({
      ...EMPTY,
      phase: "playing",
      mode,
      game: createGame(decks.player1Deck, decks.player2Deck, mode),
    });
  }, []);

  const submitDraftPick = useCallback((cardId: string) => {
    setSession((prev) => {
      if (
        prev.phase !== "drafting" ||
        !prev.draft ||
        !prev.draftPool ||
        prev.draft.nextPicker !== "player1"
      ) {
        return prev;
      }

      let { draft, complete } = draftPick(
        prev.draft,
        prev.draftPool,
        "player1",
        cardId,
      );
      let pool = prev.draftPool;

      // CPU responds immediately when it's their turn.
      while (!complete && draft.nextPicker === "player2") {
        const cpuCard = cpuDraftPick(draft.currentPack);
        const next = draftPick(draft, pool, "player2", cpuCard);
        draft = next.draft;
        complete = next.complete;
      }

      if (complete) {
        return {
          ...EMPTY,
          phase: "playing",
          mode: "draft",
          game: finishDraft(draft),
        };
      }

      return { ...prev, draft, draftPool: pool };
    });
  }, []);

  const submitTactic = useCallback((tactic: Tactic) => {
    setSession((prev) => {
      if (prev.phase !== "choosing_tactic") return prev;
      const decks = buildDecks(ALL_CARDS);
      const cpu = cpuTactic();
      return {
        ...EMPTY,
        phase: "playing",
        mode: "tactical",
        yourTactic: tactic,
        game: createGame(decks.player1Deck, decks.player2Deck, "tactical", "attack", {
          player1: tactic,
          player2: cpu,
        }),
      };
    });
  }, []);

  const submitHumanPick = useCallback((cardId: string) => {
    setSession((prev) => {
      if (prev.phase !== "playing" || !prev.game) return prev;
      if (prev.game.status === "finished") return prev;
      if (prev.game.player1.selectedCardId) return prev;

      let next = submitPick(prev.game, "player1", cardId);
      const cpuCard = cpuPick(next.player2.hand, next.category);
      next = submitPick(next, "player2", cpuCard);
      next = resolveCurrentRound(next);
      return { ...prev, game: next, pickPending: false };
    });
  }, []);

  const returnToLobby = useCallback(() => {
    setSession(EMPTY);
  }, []);

  return {
    active: session.phase !== "idle",
    phase: session.phase,
    mode: session.mode ?? session.game?.mode ?? null,
    draft: session.draft,
    yourTactic: session.yourTactic,
    revealedCpuTactic:
      session.phase === "playing" ? session.game?.tactics?.player2 ?? null : null,
    game: session.game,
    state,
    openModeSelect,
    selectMode,
    submitDraftPick,
    submitTactic,
    submitPick: submitHumanPick,
    returnToLobby,
  };
}
