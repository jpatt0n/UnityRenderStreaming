import Offer from './offer';
import Answer from './answer';
import Candidate from './candidate';
import { AdmissionIdentity } from '../admission';

type ClientRole = 'legacy' | 'participant' | 'host';
type ClientState = {
  connectionIds: Set<string>;
  role: ClientRole;
  identity?: AdmissionIdentity;
};

let legacyPrivate = false;
const clients = new Map<WebSocket, ClientState>();
const connectionPair = new Map<string, [WebSocket, WebSocket]>();

function reset(mode: string): void {
  legacyPrivate = mode == 'private';
}

function safeSend(ws: WebSocket, payload: string): boolean {
  if (!ws || ws.readyState !== 1) {
    return false;
  }
  try {
    ws.send(payload);
    return true;
  } catch (err) {
    console.warn(`websocket send failed: ${err}`);
    return false;
  }
}

function add(ws: WebSocket, role: ClientRole = 'legacy', identity?: AdmissionIdentity): void {
  clients.set(ws, { connectionIds: new Set<string>(), role, identity });
}

function getConnectionIds(ws: WebSocket): string[] {
  return Array.from(clients.get(ws)?.connectionIds ?? []);
}

function remove(ws: WebSocket): void {
  const state = clients.get(ws);
  if (!state) {
    return;
  }

  state.connectionIds.forEach(connectionId => {
    const pair = connectionPair.get(connectionId);
    if (pair) {
      const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
      if (otherSessionWs) {
        safeSend(otherSessionWs, JSON.stringify({ type: 'disconnect', connectionId }));
      }
    }
    connectionPair.delete(connectionId);
  });
  clients.delete(ws);
}

function isAllowed(ws: WebSocket, connectionId: string): boolean {
  const state = clients.get(ws);
  if (!state || state.role !== 'participant') {
    return true;
  }
  const identity = state.identity;
  const expectedPrefix = identity ? `${identity.username}~${identity.profile}~` : '';
  const allowed = Boolean(expectedPrefix) && connectionId.startsWith(expectedPrefix);
  if (!allowed) {
    safeSend(ws, JSON.stringify({ type: 'error', message: 'Connection identity does not match admission session.' }));
  }
  return allowed;
}

function hosts(): WebSocket[] {
  return Array.from(clients.entries())
    .filter(([, state]) => state.role === 'host')
    .map(([ws]) => ws);
}

function onConnect(ws: WebSocket, connectionId: string): void {
  if (!isAllowed(ws, connectionId)) {
    return;
  }

  const state = clients.get(ws);
  if (!state) {
    return;
  }

  let polite = true;
  if (state.role === 'legacy' && legacyPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);
      if (pair[0] != null && pair[1] != null) {
        safeSend(ws, JSON.stringify({ type: 'error', message: `${connectionId}: This connection id is already used.` }));
        return;
      } else if (pair[0] != null) {
        connectionPair.set(connectionId, [pair[0], ws]);
      }
    } else {
      connectionPair.set(connectionId, [ws, null]);
      polite = false;
    }
  }

  state.connectionIds.add(connectionId);
  safeSend(ws, JSON.stringify({ type: 'connect', connectionId, polite }));
}

function onDisconnect(ws: WebSocket, connectionId: string): void {
  if (!isAllowed(ws, connectionId)) {
    return;
  }
  clients.get(ws)?.connectionIds.delete(connectionId);
  const pair = connectionPair.get(connectionId);
  if (pair) {
    const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
    if (otherSessionWs) {
      safeSend(otherSessionWs, JSON.stringify({ type: 'disconnect', connectionId }));
    }
  }
  connectionPair.delete(connectionId);
  safeSend(ws, JSON.stringify({ type: 'disconnect', connectionId }));
}

function onOffer(ws: WebSocket, message: any): void {
  const connectionId = message.connectionId as string;
  if (!isAllowed(ws, connectionId)) {
    return;
  }

  const state = clients.get(ws);
  const newOffer = new Offer(message.sdp, Date.now(), false);
  if (state?.role === 'participant') {
    connectionPair.set(connectionId, [ws, null]);
    hosts().forEach(host => {
      safeSend(host, JSON.stringify({ from: connectionId, to: '', type: 'offer', data: newOffer }));
    });
    return;
  }

  if (state?.role === 'host' || legacyPrivate) {
    const pair = connectionPair.get(connectionId);
    const otherSessionWs = pair ? (pair[0] == ws ? pair[1] : pair[0]) : null;
    if (otherSessionWs) {
      newOffer.polite = true;
      safeSend(otherSessionWs, JSON.stringify({ from: connectionId, to: '', type: 'offer', data: newOffer }));
    }
    return;
  }

  connectionPair.set(connectionId, [ws, null]);
  clients.forEach((_state, client) => {
    if (client !== ws) {
      safeSend(client, JSON.stringify({ from: connectionId, to: '', type: 'offer', data: newOffer }));
    }
  });
}

function onAnswer(ws: WebSocket, message: any): void {
  const connectionId = message.connectionId as string;
  if (!isAllowed(ws, connectionId)) {
    return;
  }
  const state = clients.get(ws);
  state?.connectionIds.add(connectionId);
  const pair = connectionPair.get(connectionId);
  if (!pair) {
    return;
  }

  const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
  if (!otherSessionWs || !clients.has(otherSessionWs)) {
    return;
  }
  if (state?.role === 'host' || (!legacyPrivate && state?.role === 'legacy')) {
    connectionPair.set(connectionId, [otherSessionWs, ws]);
  }

  const newAnswer = new Answer(message.sdp, Date.now());
  safeSend(otherSessionWs, JSON.stringify({ from: connectionId, to: '', type: 'answer', data: newAnswer }));
}

function onCandidate(ws: WebSocket, message: any): void {
  const connectionId = message.connectionId as string;
  if (!isAllowed(ws, connectionId)) {
    return;
  }

  const candidate = new Candidate(message.candidate, message.sdpMLineIndex, message.sdpMid, Date.now());
  const payload = JSON.stringify({ from: connectionId, to: '', type: 'candidate', data: candidate });
  const pair = connectionPair.get(connectionId);
  const otherSessionWs = pair ? (pair[0] == ws ? pair[1] : pair[0]) : null;
  if (otherSessionWs) {
    safeSend(otherSessionWs, payload);
    return;
  }

  const state = clients.get(ws);
  if (state?.role === 'participant') {
    hosts().forEach(host => safeSend(host, payload));
    return;
  }

  if (state?.role === 'legacy' && !legacyPrivate) {
    clients.forEach((_clientState, client) => {
      if (client !== ws) {
        safeSend(client, payload);
      }
    });
  }
}

export { reset, add, getConnectionIds, remove, onConnect, onDisconnect, onOffer, onAnswer, onCandidate };
