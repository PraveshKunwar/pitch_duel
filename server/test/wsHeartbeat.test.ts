import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { runHeartbeatTick } from "../src/ws/server";
import type { AuthenticatedSocket } from "../src/ws/types";

function fakeSocket(isAlive: boolean): AuthenticatedSocket {
  return {
    userId: "u",
    connectionId: "conn",
    isAlive,
    terminate: vi.fn(),
    ping: vi.fn(),
  } as unknown as AuthenticatedSocket;
}

describe("websocket heartbeats", () => {
  it("marks a living socket not-alive and pings it", () => {
    const socket = fakeSocket(true);
    runHeartbeatTick([socket as unknown as WebSocket]);
    expect(socket.isAlive).toBe(false);
    expect(socket.ping).toHaveBeenCalledOnce();
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it("terminates a nonresponsive socket", () => {
    const socket = fakeSocket(false);
    runHeartbeatTick([socket as unknown as WebSocket]);
    expect(socket.terminate).toHaveBeenCalledOnce();
    expect(socket.ping).not.toHaveBeenCalled();
  });
});
