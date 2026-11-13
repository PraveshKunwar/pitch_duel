import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";

import type { MatchmakingService } from "../matchmaking/service";
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
  createMatchmaking?: (ctx: {
    getSocket: (userId: string) => AuthenticatedSocket | undefined;
    send: typeof sendMessage;
  }) => MatchmakingService;
}

export function setupWebSocket(
  app: FastifyInstance,
  options: SetupWebSocketOptions,
): WebSocketServer {
  const verifyTicket = options.verifyAndConsumeTicket ?? verifyAndConsumeTicket;
  const connections = new Map<string, AuthenticatedSocket>();
  const getSocket = (userId: string) => connections.get(userId);

  const { finalizer } = options;

  const coordinator = createRoundCoordinator({
    sessions: options.sessions,
    getSocket,
    send: sendMessage,
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
  });

  const handleMessage = createMessageHandler({
    sessions: options.sessions,
    getSocket,
    send: sendMessage,
    coordinator,
    matchmaking,
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
    const previous = connections.get(socket.userId);
    if (previous && previous !== socket) {
      previous.close(1000, "replaced by new connection");
    }
    connections.set(socket.userId, socket);

    app.log.info(
      { userId: socket.userId },
      "authenticated websocket connected",
    );

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
      if (connections.get(socket.userId) === socket) {
        connections.delete(socket.userId);
      }
      if (matchmaking) {
        void matchmaking.onDisconnect(socket.userId).catch((error) => {
          app.log.error(
            { err: error, userId: socket.userId },
            "matchmaking disconnect cleanup failed",
          );
        });
      }
      app.log.info({ userId: socket.userId }, "websocket disconnected");
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
    matchmaking?.dispose();
    clearInterval(heartbeat);
    if (persistRetry) clearInterval(persistRetry);
    for (const client of wss.clients) {
      client.close(1001, "server shutting down");
    }
    connections.clear();
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
