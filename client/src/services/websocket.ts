import type { ClientMessage, ServerMessage } from "../types/game";

export type SocketStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "reconnecting";

type Listener = (message: ServerMessage) => void;
type StatusListener = (status: SocketStatus) => void;

export class GameSocket {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: SocketStatus = "idle";
  private intentionallyClosed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private ticketProvider: (() => Promise<string>) | null = null;
  private reconnectAttempts = 0;

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): SocketStatus {
    return this.status;
  }

  private setStatus(status: SocketStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  async connect(getTicket: () => Promise<string>): Promise<void> {
    this.ticketProvider = getTicket;
    this.intentionallyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.open();
  }

  private async open(): Promise<void> {
    if (!this.ticketProvider) throw new Error("No ticket provider");
    this.setStatus(
      this.reconnectAttempts > 0 ? "reconnecting" : "connecting",
    );

    const ticket = await this.ticketProvider();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      const onOpen = () => {
        this.reconnectAttempts = 0;
        this.setStatus("open");
        cleanupBootstrap();
        resolve();
      };
      const onError = () => {
        cleanupBootstrap();
        reject(new Error("WebSocket connection failed"));
      };
      const cleanupBootstrap = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          for (const listener of this.listeners) listener(message);
        } catch {
          // ignore malformed frames
        }
      });
      socket.addEventListener("close", () => {
        this.socket = null;
        if (this.intentionallyClosed) {
          this.setStatus("closed");
          return;
        }
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || !this.ticketProvider) {
      this.setStatus("closed");
      return;
    }
    this.reconnectAttempts += 1;
    this.setStatus("reconnecting");
    const delay = Math.min(8_000, 500 * 2 ** (this.reconnectAttempts - 1));
    this.reconnectTimer = setTimeout(() => {
      void this.open().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ticketProvider = null;
    this.socket?.close(1000, "client close");
    this.socket = null;
    this.setStatus("closed");
  }
}
