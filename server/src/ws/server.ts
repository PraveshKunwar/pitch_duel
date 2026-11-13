import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type Redis from "ioredis";
import { WebSocket, WebSocketServer } from "ws";

import type { MatchmakingService } from "../matchmaking/service";
import {
  createReconnectService,
  type ReconnectService,
} from "../reconnect/service";
import { createEventPublisher } from "../redis/publisher";
import { createEventSubscriber } from "../redis/subscriber";
import { createConnectionRegistry } from "./connections";
import { createGameEventRouter } from "./events";
import {
  createLocalGameFanout,
  createRedisGameFanout,
  type GameFanout,
} from "./fanout";
import { createMessageHandler } from "./handlers";
import type { GameSessionStore } from "./gameSessions";
import type { MatchFinalizer } from "./matchFinalizer";
import { createRoundCoordinator } from "./roundCoordinator";
import { safeParseClientMessage } from "./schemas";
import type { AuthenticatedSocket, ServerMessage } from "./types";
import { verifyAndConsumeTicket } from "./tickets";

const HEARTBEAT_MS = 30_000;
const PERSIST_RETRY_MS = 30_000;

export function sendMessage(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function runHeartbeatTick(clients: Iterable<WebSocket>): void {
  for (const client of clients) {
    const socket = client as AuthenticatedSocket;
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}

export interface SetupWebSocketOptions {
  sessions: GameSessionStore;
  verifyAndConsumeTicket?: typeof verifyAndConsumeTicket;
  finalizer?: MatchFinalizer;
  /** When set, game/user events fan out through Redis Pub/Sub. */
  redis?: Redis;
  instanceId?: string;
  createMatchmaking?: (ctx: {
    getSocket: (userId: string) => AuthenticatedSocket | undefined;
    send: typeof sendMessage;
    fanout: GameFanout;
  }) => MatchmakingService;
  createReconnect?: (ctx: {
    getSocket: (userId: string) => AuthenticatedSocket | undefined;
    send: typeof sendMessage;
    fanout: GameFanout;
    onMatchEnded?: (session: import("./gameSessions").GameSession) => Promise<unknown>;
    onResumed?: (session: import("./gameSessions").GameSession) => void | Promise<unknown>;
  }) => ReconnectService;
  gracePeriodMs?: number;
}

export function setupWebSocket(
  app: FastifyInstance,
  options: SetupWebSocketOptions,
): WebSocketServer {
  const verifyTicket = options.verifyAndConsumeTicket ?? verifyAndConsumeTicket;
  const connections = createConnectionRegistry();
  const getSocket = (userId: string) => connections.get(userId);
  const instanceId = options.instanceId ?? "local";

  const { finalizer } = options;

  const localFanout = createLocalGameFanout(getSocket, sendMessage);
  const publisher = options.redis
    ? createEventPublisher(options.redis)
    : null;
  const fanout: GameFanout = publisher
    ? createRedisGameFanout(publisher, instanceId, localFanout)
    : localFanout;

  const coordinator = createRoundCoordinator({
    sessions: options.sessions,
    getSocket,
    send: sendMessage,
    fanout,
    onGameFinished: finalizer
      ? (session) => finalizer.finalize(session)
      : undefined,
    onError: (error, context) => {
      app.log.error({ err: error, ...context }, "round coordinator failed");
    },
  });
  options.sessions.setOnCreated((session) =>
    coordinator.beginRound(session.id),
  );

  const reconnect =
    options.createReconnect?.({
      getSocket,
      send: sendMessage,
      fanout,
      onMatchEnded: finalizer
        ? (session) => finalizer.finalize(session)
        : undefined,
      onResumed: (session) =>
        coordinator.resume(session, { notify: false }),
    }) ??
    createReconnectService({
      sessions: options.sessions,
      getSocket,
      send: sendMessage,
      fanout,
      onMatchEnded: finalizer
        ? (session) => finalizer.finalize(session)
        : undefined,
      onResumed: (session) =>
        coordinator.resume(session, { notify: false }),
      config: options.gracePeriodMs
        ? { gracePeriodMs: options.gracePeriodMs }
        : undefined,
      onError: (error, context) => {
        app.log.error({ err: error, ...context }, "reconnect service failed");
      },
    });

  const eventRouter = createGameEventRouter({
    instanceId,
    sessions: options.sessions,
    getSocket,
    send: sendMessage,
    coordinator,
    reconnect,
  });

  const subscriber = options.redis
    ? createEventSubscriber({
        redis: options.redis,
        onGameEvent: (event) => eventRouter.handleGameEvent(event),
        onUserEvent: (userId, event) =>
          eventRouter.handleUserEvent(userId, event),
        onError: (error, context) => {
          app.log.error({ err: error, ...context }, "redis subscriber failed");
        },
      })
    : null;

  /** Local players currently attached to each game (drives game-channel refcounts). */
  const localGameMembers = new Map<string, Set<string>>();

  const watchGame = async (userId: string, gameId: string): Promise<void> => {
    if (!subscriber) return;
    let members = localGameMembers.get(gameId);
    if (!members) {
      members = new Set();
      localGameMembers.set(gameId, members);
      await subscriber.retainGame(gameId);
    }
    members.add(userId);
  };

  const unwatchGame = async (
    userId: string,
    gameId: string,
  ): Promise<void> => {
    if (!subscriber) return;
    const members = localGameMembers.get(gameId);
    if (!members) return;
    members.delete(userId);
    if (members.size > 0) return;
    localGameMembers.delete(gameId);
    await subscriber.releaseGame(gameId);
  };

  const unwatchUserGames = async (userId: string): Promise<void> => {
    const gameIds = [...localGameMembers.entries()]
      .filter(([, members]) => members.has(userId))
      .map(([gameId]) => gameId);
    for (const gameId of gameIds) {
      await unwatchGame(userId, gameId);
    }
  };

  let recovering = false;
  const recoverUnpersisted = async (): Promise<void> => {
    if (!finalizer || recovering) return;
    recovering = true;
    try {
      const { recovered, failed, lost } = await finalizer.recoverPending();
      if (recovered.length > 0) {
        app.log.info({ gameIds: recovered }, "persisted finished games");
      }
      for (const { gameId, error } of failed) {
        app.log.error(
          { err: error, gameId },
          "finished game still unpersisted",
        );
      }
      if (lost.length > 0) {
        app.log.error(
          { gameIds: lost },
          "finished games expired before saving",
        );
      }
    } catch (error) {
      app.log.error(error, "unpersisted game recovery failed");
    } finally {
      recovering = false;
    }
  };

  const matchmaking = options.createMatchmaking?.({
    getSocket,
    send: sendMessage,
    fanout,
  });

  const handleMessage = createMessageHandler({
    sessions: options.sessions,
    getSocket,
    send: sendMessage,
    coordinator,
    matchmaking,
    reconnect,
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
  });

  const attachUpgrade = () => {
    app.server.on("upgrade", (request, socket, head) => {
      void (async () => {
        try {
          const url = new URL(
            request.url ?? "/",
            `http://${request.headers.host ?? "localhost"}`,
          );

          if (url.pathname !== "/ws") {
            socket.destroy();
            return;
          }

          const ticket = url.searchParams.get("ticket");
          if (!ticket) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          const user = await verifyTicket(ticket);
          if (!user) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          wss.handleUpgrade(request, socket, head, (ws) => {
            const authenticated = ws as AuthenticatedSocket;
            authenticated.userId = user.userId;
            authenticated.connectionId = randomUUID();
            authenticated.isAlive = true;
            wss.emit("connection", authenticated, request);
          });
        } catch (error) {
          app.log.error(error, "websocket upgrade failed");
          if (!socket.destroyed) {
            socket.destroy();
          }
        }
      })();
    });
  };

  wss.on("connection", (socket: AuthenticatedSocket) => {
    const previous = connections.set(socket);
    if (previous) {
      previous.close(1000, "replaced by new connection");
    } else {
      void subscriber?.retainUser(socket.userId).catch((error: unknown) => {
        app.log.error(
          { err: error, userId: socket.userId },
          "user channel subscribe failed",
        );
      });
    }

    app.log.info(
      {
        userId: socket.userId,
        connectionId: socket.connectionId,
        instanceId,
      },
      "authenticated websocket connected",
    );

    void reconnect
      .attachConnection(socket)
      .then(async (session) => {
        if (session) {
          await watchGame(socket.userId, session.id);
        }
        if (!session || session.frozen || session.outcome) return;
        return coordinator.beginRound(session.id);
      })
      .catch((error: unknown) => {
        app.log.error(
          { err: error, userId: socket.userId },
          "auto-reconnect failed",
        );
      });

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", async (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        sendMessage(socket, { type: "error", message: "Invalid JSON" });
        return;
      }

      const parsed = safeParseClientMessage(raw);
      if (!parsed.success) {
        sendMessage(socket, {
          type: "error",
          message: "Invalid message format",
        });
        return;
      }

      try {
        await handleMessage(socket, parsed.data);
        if (parsed.data.type === "game:join") {
          const active = await options.sessions.activeGameFor(socket.userId);
          if (active === parsed.data.gameId) {
            await watchGame(socket.userId, parsed.data.gameId);
          }
        }
      } catch (error) {
        app.log.error(
          { err: error, userId: socket.userId },
          "websocket message handler failed",
        );
        sendMessage(socket, {
          type: "error",
          message: "Unable to process message",
        });
      }
    });

    socket.on("close", () => {
      if (!connections.deleteIfCurrent(socket)) {
        // A newer socket already replaced this one — do not start grace.
        return;
      }
      void subscriber?.releaseUser(socket.userId).catch((error: unknown) => {
        app.log.error(
          { err: error, userId: socket.userId },
          "user channel unsubscribe failed",
        );
      });
      void unwatchUserGames(socket.userId).catch((error: unknown) => {
        app.log.error(
          { err: error, userId: socket.userId },
          "game channel unsubscribe failed",
        );
      });
      if (matchmaking) {
        void matchmaking.onDisconnect(socket.userId).catch((error) => {
          app.log.error(
            { err: error, userId: socket.userId },
            "matchmaking disconnect cleanup failed",
          );
        });
      }
      void reconnect
        .onDisconnect(socket.userId, socket.connectionId)
        .then((session) => {
          if (session?.frozen) coordinator.pause(session.id);
        })
        .catch((error: unknown) => {
          app.log.error(
            { err: error, userId: socket.userId },
            "game disconnect handling failed",
          );
        });
      app.log.info({ userId: socket.userId, instanceId }, "websocket disconnected");
    });

    socket.on("error", (error) => {
      app.log.error(
        { err: error, userId: socket.userId },
        "websocket connection error",
      );
    });
  });

  const heartbeat = setInterval(() => {
    runHeartbeatTick(wss.clients);
  }, HEARTBEAT_MS);

  let persistRetry: NodeJS.Timeout | null = null;
  if (finalizer) {
    app.addHook("onReady", recoverUnpersisted);
    persistRetry = setInterval(() => {
      void recoverUnpersisted();
    }, PERSIST_RETRY_MS);
    persistRetry.unref();
  }

  app.addHook("preClose", async () => {
    coordinator.dispose();
    reconnect.dispose();
    matchmaking?.dispose();
    clearInterval(heartbeat);
    if (persistRetry) clearInterval(persistRetry);
    for (const client of wss.clients) {
      client.close(1001, "server shutting down");
    }
    connections.clear();
    if (subscriber) {
      await subscriber.dispose();
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  });

  if (app.server.listening) {
    attachUpgrade();
  } else {
    app.addHook("onListen", async () => {
      attachUpgrade();
    });
  }

  return wss;
}
