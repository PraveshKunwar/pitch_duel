export const gameEventsChannel = (gameId: string): string =>
  `game:${gameId}:events`;

export const userEventsChannel = (userId: string): string =>
  `user:${userId}:events`;
