export const ELO_K = 32;

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function eloDelta(
  winnerRating: number,
  loserRating: number,
  k: number = ELO_K,
): number {
  return Math.round(k * (1 - expectedScore(winnerRating, loserRating)));
}

export function applyElo(
  winnerRating: number,
  loserRating: number,
  k: number = ELO_K,
): { delta: number; winnerRating: number; loserRating: number } {
  const delta = eloDelta(winnerRating, loserRating, k);
  return {
    delta,
    winnerRating: winnerRating + delta,
    loserRating: loserRating - delta,
  };
}
