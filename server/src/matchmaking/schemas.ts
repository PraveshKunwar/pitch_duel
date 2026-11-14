import { z } from "zod";

export const gameModeSchema = z.enum([
  "classic",
  "draft",
  "sudden_death",
  "tactical",
]);

export const matchmakingJoinSchema = z.object({
  type: z.literal("matchmaking:join"),
  mode: gameModeSchema,
});

export const matchmakingCancelSchema = z.object({
  type: z.literal("matchmaking:cancel"),
});

export const matchmakingClientSchemas = [
  matchmakingJoinSchema,
  matchmakingCancelSchema,
] as const;
