import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "http";

export interface WsMessage {
  channel: string;
  args: unknown[];
}

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export const initWebSocketServer = (server: Server) => {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    clients.add(ws);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsMessage;
        handleClientMessage(ws, msg);
      } catch (e) {
        console.error("Invalid WebSocket message from client:", e);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", (err) => {
      console.error("WebSocket client error:", err);
      clients.delete(ws);
    });
  });

  return wss;
};

export const broadcast = (channel: string, ...args: unknown[]) => {
  const payload = JSON.stringify({ channel, args });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
};

const handleClientMessage = (ws: WebSocket, msg: WsMessage) => {
  // Echo or route bidirectional messages like debugger packets or music MIDI bridge
  if (msg.channel.startsWith("debugger:") || msg.channel.startsWith("music:")) {
    // Broadcast to other connected clients (e.g. game window / project window)
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(msg));
      }
    }
  }
};
