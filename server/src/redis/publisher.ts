import type Redis from "ioredis";
import { gameEventsChannel, userEventsChannel } from "./channels";
import type { GameBusEvent, UserBusEvent } from "./events";

export interface EventPublisher {
  publishGame(event: GameBusEvent): Promise<void>;
  publishUser(userId: string, event: UserBusEvent): Promise<void>;
}

export function createEventPublisher(client: Redis): EventPublisher {
  return {
    async publishGame(event) {
      await client.publish(gameEventsChannel(event.gameId), JSON.stringify(event));
    },

    async publishUser(userId, event) {
      await client.publish(userEventsChannel(userId), JSON.stringify(event));
    },
  };
}
