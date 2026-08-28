import WebSocket from "ws";
import { CommandMessage, ServerMessage, TelemetryEvent, StatusMessage } from "../types.js";

export type MessageHandler = (msg: ServerMessage) => void;
export type TelemetryHandler = (event: TelemetryEvent) => void;
export type StatusHandler = (status: StatusMessage) => void;

export class TrainerWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private messageHandlers: Set<MessageHandler> = new Set();
  private telemetryHandlers: Set<TelemetryHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private isExplicitlyClosed = false;

  constructor(httpBaseUrl: string) {
    const wsUrl = httpBaseUrl
      .replace(/^http:\/\//i, "ws://")
      .replace(/^https:\/\//i, "wss://")
      .replace(/\/+$/, "");
    this.url = `${wsUrl}/ws`;
  }

  async connect(): Promise<void> {
    this.isExplicitlyClosed = false;

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.ws = socket;

      const timer = setTimeout(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          socket.terminate();
          reject(new Error(`WebSocket connection timeout to ${this.url}`));
        }
      }, 5000);

      socket.on("open", () => {
        clearTimeout(timer);
        resolve();
      });

      socket.on("message", (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString()) as ServerMessage;
          for (const handler of this.messageHandlers) {
            handler(parsed);
          }
          if (parsed.type === "telemetry") {
            for (const handler of this.telemetryHandlers) {
              handler(parsed);
            }
          } else if (parsed.type === "status") {
            for (const handler of this.statusHandlers) {
              handler(parsed);
            }
          }
        } catch (e) {
          // Ignore malformed JSON
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        if (!this.isExplicitlyClosed) {
          reject(err);
        }
      });

      socket.on("close", () => {
        // Socket closed
      });
    });
  }

  onTelemetry(handler: TelemetryHandler): () => void {
    this.telemetryHandlers.add(handler);
    return () => this.telemetryHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  sendCommand(action: CommandMessage["action"], payload?: Record<string, any>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const cmd: CommandMessage = { action, payload };
      this.ws.send(JSON.stringify(cmd));
    }
  }

  close(): void {
    this.isExplicitlyClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
