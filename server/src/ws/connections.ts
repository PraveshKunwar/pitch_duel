import type { AuthenticatedSocket } from "./types";

/**
 * Process-local WebSocket registry.
 * Other instances cannot see these sockets — cross-instance delivery goes through Redis Pub/Sub.
 */
export interface ConnectionRegistry {
  get(userId: string): AuthenticatedSocket | undefined;
  set(socket: AuthenticatedSocket): AuthenticatedSocket | undefined;
  /** Returns true when this socket was the registered one and was removed. */
  deleteIfCurrent(socket: AuthenticatedSocket): boolean;
  clear(): void;
  readonly size: number;
}

export function createConnectionRegistry(): ConnectionRegistry {
  const connections = new Map<string, AuthenticatedSocket>();

  return {
    get(userId) {
      return connections.get(userId);
    },

    set(socket) {
      const previous = connections.get(socket.userId);
      connections.set(socket.userId, socket);
      return previous && previous !== socket ? previous : undefined;
    },

    deleteIfCurrent(socket) {
      if (connections.get(socket.userId) !== socket) return false;
      connections.delete(socket.userId);
      return true;
    },

    clear() {
      connections.clear();
    },

    get size() {
      return connections.size;
    },
  };
}
