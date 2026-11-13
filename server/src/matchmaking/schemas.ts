import { z } from "zod";

export const matchmakingJoinSchema = z.object({
  type: z.literal("matchmaking:join"),
});

export const matchmakingCancelSchema = z.object({
  type: z.literal("matchmaking:cancel"),
});

export const matchmakingClientSchemas = [
  matchmakingJoinSchema,
  matchmakingCancelSchema,
] as const;
