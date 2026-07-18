import * as websocket from "ws";
import { Server } from 'http';
import * as handler from "./class/websockethandler";

type HeartbeatWebSocket = websocket.WebSocket & {
  isAlive: boolean;
  signalingSessionId: number;
  connectedAt: number;
};

export default class WSSignaling {
  private static readonly HeartbeatIntervalMs = 25000;

  server: Server;
  wss: websocket.Server;
  heartbeatTimer: NodeJS.Timeout;
  nextSessionId = 1;

  constructor(server: Server, mode: string) {
    this.server = server;
    this.wss = new websocket.Server({ server });
    handler.reset(mode);

    this.wss.on('connection', (rawWs: websocket.WebSocket) => {
      const ws = rawWs as HeartbeatWebSocket;
      const handlerWs = ws as unknown as WebSocket;
      ws.isAlive = true;
      ws.signalingSessionId = this.nextSessionId++;
      ws.connectedAt = Date.now();

      handler.add(handlerWs);
      console.log(`[signaling] websocket opened session=${ws.signalingSessionId}`);

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('close', (code: number, reason: Buffer) => {
        const connectionIds = handler.getConnectionIds(handlerWs);
        const durationMs = Date.now() - ws.connectedAt;
        const closeReason = reason?.toString() || '(none)';
        console.warn(
          `[signaling] websocket closed session=${ws.signalingSessionId} code=${code} reason=${closeReason} durationMs=${durationMs} connections=${this.formatConnectionIds(connectionIds)}`
        );
        handler.remove(handlerWs);
      });

      ws.on('error', (error: Error) => {
        const connectionIds = handler.getConnectionIds(handlerWs);
        console.error(
          `[signaling] websocket error session=${ws.signalingSessionId} message=${error.message} connections=${this.formatConnectionIds(connectionIds)}`
        );
      });

      ws.on('message', (data: websocket.RawData) => {
        // type: connect, disconnect JSON Schema
        // connectionId: connect or disconnect connectionId

        // type: offer, answer, candidate JSON Schema
        // from: from connection id
        // to: to connection id
        // data: any message data structure

        let msg: any = null;
        try {
          msg = JSON.parse(data.toString());
        } catch (err) {
          console.warn(`[signaling] invalid websocket payload session=${ws.signalingSessionId}: ${err}`);
          return;
        }

        if (!msg || !this) {
          return;
        }

        console.log(msg);

        try {
          switch (msg.type) {
            case "connect":
              handler.onConnect(handlerWs, msg.connectionId);
              break;
            case "disconnect":
              handler.onDisconnect(handlerWs, msg.connectionId);
              break;
            case "offer":
              handler.onOffer(handlerWs, msg.data);
              break;
            case "answer":
              handler.onAnswer(handlerWs, msg.data);
              break;
            case "candidate":
              handler.onCandidate(handlerWs, msg.data);
              break;
            default:
              break;
          }
        } catch (err) {
          console.error(`[signaling] websocket message handling failed session=${ws.signalingSessionId}: ${err}`);
        }
      });
    });

    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((rawClient: websocket.WebSocket) => {
        const client = rawClient as HeartbeatWebSocket;
        const handlerClient = client as unknown as WebSocket;

        if (!client.isAlive) {
          const connectionIds = handler.getConnectionIds(handlerClient);
          console.warn(
            `[signaling] websocket heartbeat timeout session=${client.signalingSessionId} connections=${this.formatConnectionIds(connectionIds)}`
          );
          client.terminate();
          return;
        }

        client.isAlive = false;
        client.ping();
      });
    }, WSSignaling.HeartbeatIntervalMs);

    this.wss.on('close', () => {
      clearInterval(this.heartbeatTimer);
    });
  }

  private formatConnectionIds(connectionIds: string[]): string {
    return connectionIds.length > 0 ? connectionIds.join(',') : '(none)';
  }
}
