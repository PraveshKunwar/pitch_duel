import { z } from "zod";

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

export const clientMessageSchema = z.discriminatedUnion("type", [
  gameJoinSchema,
  gamePickSchema,
]);

export type ParsedClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(data: unknown): ParsedClientMessage {
  return clientMessageSchema.parse(data);
}

export function safeParseClientMessage(data: unknown) {
  return clientMessageSchema.safeParse(data);
}
