import { z } from "zod";
import {
  gameModeSchema,
  matchmakingCancelSchema,
  matchmakingJoinSchema,
} from "../matchmaking/schemas";

export const gameJoinSchema = z.object({
  type: z.literal("game:join"),
  gameId: z.string().min(1),
});

export const gamePickSchema = z.object({
  type: z.literal("game:pick"),
  gameId: z.string().min(1),
  round: z.number().int().positive(),
  sequence: z.number().int().positive(),
  cardId: z.string().min(1),
});

export const gameDraftPickSchema = z.object({
  type: z.literal("game:draftPick"),
  gameId: z.string().min(1),
  sequence: z.number().int().positive(),
  cardId: z.string().min(1),
});

export const gameChooseTacticSchema = z.object({
  type: z.literal("game:chooseTactic"),
  gameId: z.string().min(1),
  sequence: z.number().int().positive(),
  tactic: z.enum(["attacking", "defensive", "possession", "balanced"]),
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  gameJoinSchema,
  gamePickSchema,
  gameDraftPickSchema,
  gameChooseTacticSchema,
  matchmakingJoinSchema,
  matchmakingCancelSchema,
]);

export type ParsedClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(data: unknown): ParsedClientMessage {
  return clientMessageSchema.parse(data);
}

export function safeParseClientMessage(data: unknown) {
  return clientMessageSchema.safeParse(data);
}

void gameModeSchema;
