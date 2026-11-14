import type { CompletedRound, GameState, StatCategory } from "./types";
import { resolveRound } from "./resolveRound";

function dealSuddenDeathCards(state: GameState): {
  player1Hand: GameState["player1"]["hand"];
  player2Hand: GameState["player2"]["hand"];
  reserve: GameState["reserve"];
} {
  if (state.reserve.length < 2) {
    throw new Error("Not enough reserve cards for sudden death");
  }
  const [c1, c2, ...rest] = state.reserve;
  return {
    player1Hand: [c1],
    player2Hand: [c2],
    reserve: rest,
  };
}

export function resolveCurrentRound(
  state: GameState,
  nextCategory: StatCategory,
  random: () => number = Math.random,
): GameState {
  if (state.status === "finished") {
    throw new Error("Cannot resolve a round: the game is finished");
  }
  if (
    state.player1.selectedCardId === null ||
    state.player2.selectedCardId === null
  ) {
    throw new Error("Both players must selected a card before resolving");
  }
  const card1 = state.player1.hand.find(
    (card) => card.ID === state.player1.selectedCardId,
  );
  const card2 = state.player2.hand.find(
    (card) => card.ID === state.player2.selectedCardId,
  );
  if (!card1 || !card2) {
    throw new Error("A selected card was not found in a players hand");
  }

  const allowDraw = state.mode === "sudden_death" && !state.suddenDeath;
  const result = resolveRound(
    card1,
    card2,
    state.category,
    random,
    allowDraw,
  );
  const completedRound: CompletedRound = {
    round: state.round,
    category: state.category,
    card1,
    card2,
    result,
  };
  const player1Score =
    state.player1.score + (result.winner === "player1" ? 1 : 0);
  const player2Score =
    state.player2.score + (result.winner === "player2" ? 1 : 0);
  const player1RemainingHand = state.player1.hand.filter(
    (card) => card.ID !== card1.ID,
  );
  const player2RemainingHand = state.player2.hand.filter(
    (card) => card.ID !== card2.ID,
  );

  if (state.suddenDeath) {
    if (result.winner === null) {
      const next = dealSuddenDeathCards(state);
      return {
        ...state,
        player1: {
          ...state.player1,
          score: player1Score,
          hand: next.player1Hand,
          selectedCardId: null,
        },
        player2: {
          ...state.player2,
          score: player2Score,
          hand: next.player2Hand,
          selectedCardId: null,
        },
        reserve: next.reserve,
        history: [...state.history, completedRound],
        status: "picking",
        round: state.round + 1,
        category: nextCategory,
      };
    }
    return {
      ...state,
      player1: {
        ...state.player1,
        score: player1Score,
        hand: player1RemainingHand,
        selectedCardId: null,
      },
      player2: {
        ...state.player2,
        score: player2Score,
        hand: player2RemainingHand,
        selectedCardId: null,
      },
      history: [...state.history, completedRound],
      status: "finished",
    };
  }

  const regulationComplete = state.round >= state.regulationRounds;
  if (regulationComplete) {
    const tied = player1Score === player2Score;
    if (state.mode === "sudden_death" && tied) {
      const next = dealSuddenDeathCards(state);
      return {
        ...state,
        player1: {
          ...state.player1,
          score: player1Score,
          hand: next.player1Hand,
          selectedCardId: null,
        },
        player2: {
          ...state.player2,
          score: player2Score,
          hand: next.player2Hand,
          selectedCardId: null,
        },
        reserve: next.reserve,
        history: [...state.history, completedRound],
        status: "picking",
        suddenDeath: true,
        round: state.round + 1,
        category: nextCategory,
      };
    }
    return {
      ...state,
      player1: {
        ...state.player1,
        score: player1Score,
        hand: player1RemainingHand,
        selectedCardId: null,
      },
      player2: {
        ...state.player2,
        score: player2Score,
        hand: player2RemainingHand,
        selectedCardId: null,
      },
      history: [...state.history, completedRound],
      status: "finished",
    };
  }

  return {
    ...state,
    player1: {
      ...state.player1,
      score: player1Score,
      hand: player1RemainingHand,
      selectedCardId: null,
    },
    player2: {
      ...state.player2,
      score: player2Score,
      hand: player2RemainingHand,
      selectedCardId: null,
    },
    history: [...state.history, completedRound],
    status: "picking",
    round: state.round + 1,
    category: nextCategory,
  };
}
