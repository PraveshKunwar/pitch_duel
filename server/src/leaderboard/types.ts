export const LEADERBOARD_KEY = "leaderboard";
export const DEFAULT_LEADERBOARD_LIMIT = 10;
export const MAX_LEADERBOARD_LIMIT = 100;

export interface LeaderboardEntry {
  userId: string;
  rating: number;
}

export interface RankedLeaderboardEntry extends LeaderboardEntry {
  rank: number;
}

export interface LeaderboardPlayer extends RankedLeaderboardEntry {
  username: string | null;
}

export interface LeaderboardResponse {
  players: LeaderboardPlayer[];
}
