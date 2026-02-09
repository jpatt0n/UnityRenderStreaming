import * as websocket from "ws";
import { Server } from 'http';
import * as handler from "./class/websockethandler";

export default class WSSignaling {
  server: Server;
  wss: websocket.Server;

  constructor(server: Server, mode: string) {
    this.server = server;
    this.wss = new websocket.Server({ server });
    handler.reset(mode);

    this.wss.on('connection', (ws: WebSocket) => {

      handler.add(ws);

      ws.onclose = (): void => {
        handler.remove(ws);
      };

      ws.onmessage = (event: MessageEvent): void => {

        // type: connect, disconnect JSON Schema
        // connectionId: connect or disconnect connectionId

        // type: offer, answer, candidate JSON Schema
        // from: from connection id
        // to: to connection id
        // data: any message data structure

        let msg: any = null;
        try {
          msg = JSON.parse(event.data as string);
        } catch (err) {
          console.warn(`invalid websocket payload: ${err}`);
          return;
        }

        if (!msg || !this) {
          return;
        }

        console.log(msg);

        try {
          switch (msg.type) {
            case "connect":
              handler.onConnect(ws, msg.connectionId);
              break;
            case "disconnect":
              handler.onDisconnect(ws, msg.connectionId);
              break;
            case "offer":
              handler.onOffer(ws, msg.data);
              break;
            case "answer":
              handler.onAnswer(ws, msg.data);
              break;
            case "candidate":
              handler.onCandidate(ws, msg.data);
              break;
            default:
              break;
          }
        } catch (err) {
          console.error(`websocket message handling failed: ${err}`);
        }
      };
    });
  }
}
