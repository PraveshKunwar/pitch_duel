import WebSocket from "ws";
import type { Card } from "../../src/game/types";
import type { ClientMessage, ServerMessage } from "../../src/ws/types";

type MessageOf<T extends ServerMessage["type"]> = Extract<
  ServerMessage,
  { type: T }
>;

export class TestClient {
  readonly received: ServerMessage[] = [];
  private cursor = 0;
  private wake: (() => void) | null = null;

  private constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      this.received.push(JSON.parse(data.toString()) as ServerMessage);
      this.wake?.();
    });
    socket.on("error", () => {});
  }

  static connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    const client = new TestClient(socket);
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve(client));
      socket.once("unexpected-response", (_request, response) => {
        reject(new Error(`unexpected response ${response.statusCode}`));
      });
      socket.once("error", reject);
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  async next<T extends ServerMessage["type"]>(
    type: T,
    timeoutMs = 5_000,
  ): Promise<MessageOf<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      while (this.cursor < this.received.length) {
        const message = this.received[this.cursor++];
        if (message.type === type) return message as MessageOf<T>;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const seen = this.received.map((message) => message.type).join(", ");
        throw new Error(`timed out waiting for ${type}; received: ${seen}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  get hand(): Card[] {
    for (let index = this.received.length - 1; index >= 0; index -= 1) {
      const message = this.received[index];
      if (message.type === "game:state") return message.state.hand;
    }
    throw new Error("no game:state received yet");
  }

  close(): void {
    this.socket.close();
  }
}

export type PickStrategy = (round: number, hand: Card[]) => string;

export const firstCard: PickStrategy = (_round, hand) => hand[0].ID;

async function roundOpened(
  client: TestClient,
  round: number,
): Promise<MessageOf<"game:roundStart">> {
  for (;;) {
    const open = await client.next("game:roundStart");
    if (open.round === round) return open;
    if (open.round > round) {
      throw new Error(`expected round ${round} to open, got ${open.round}`);
    }
  }
}

export async function playRounds(
  gameId: string,
  player1: { client: TestClient; pick?: PickStrategy },
  player2: { client: TestClient; pick?: PickStrategy },
  from = 1,
  to = 5,
): Promise<Array<MessageOf<"game:roundResult">>> {
  const results: Array<MessageOf<"game:roundResult">> = [];
  for (let round = from; round <= to; round += 1) {
    await Promise.all([
      roundOpened(player1.client, round),
      roundOpened(player2.client, round),
    ]);

    for (const player of [player1, player2]) {
      player.client.send({
        type: "game:pick",
        gameId,
        round,
        sequence: round,
        cardId: (player.pick ?? firstCard)(round, player.client.hand),
      });
    }

    const [result] = await Promise.all([
      player1.client.next("game:roundResult"),
      player2.client.next("game:roundResult"),
    ]);
    results.push(result);
  }
  return results;
}

export async function eventually<T>(
  read: () => Promise<T | null | undefined>,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error("condition was never met");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
