import Offer from './offer';
import Answer from './answer';
import Candidate from './candidate';
import { authStore, ResolvedAuthProfile, toPublicAuthProfile } from './authstore';

let isPrivate: boolean;

// [{sessonId:[connectionId,...]}]
const clients: Map<WebSocket, Set<string>> = new Map<WebSocket, Set<string>>();

// [{connectionId:[sessionId1, sessionId2]}]
const connectionPair: Map<string, [WebSocket, WebSocket]> = new Map<string, [WebSocket, WebSocket]>();

// [{ws:{connectionId:ResolvedAuthProfile}}]
const connectionAuthProfiles: Map<WebSocket, Map<string, ResolvedAuthProfile>> =
  new Map<WebSocket, Map<string, ResolvedAuthProfile>>();

// [{ws:{connectionId:passcodeKey}}]
const connectionPasscodeKeys: Map<WebSocket, Map<string, string>> =
  new Map<WebSocket, Map<string, string>>();

// [{passcodeKey:{ws,connectionId}}]
const activeConnectionByPasscode: Map<string, { ws: WebSocket, connectionId: string }> =
  new Map<string, { ws: WebSocket, connectionId: string }>();

function getOrCreateConnectionIds(session: WebSocket): Set<string> {
  let connectionIds = null;
  if (!clients.has(session)) {
    connectionIds = new Set<string>();
    clients.set(session, connectionIds);
  }
  connectionIds = clients.get(session);
  return connectionIds;
}

function reset(mode: string): void {
  isPrivate = mode == "private";
  clients.clear();
  connectionPair.clear();
  connectionAuthProfiles.clear();
  connectionPasscodeKeys.clear();
  activeConnectionByPasscode.clear();
  authStore.load();
}

function getOrCreateAuthProfileMap(session: WebSocket): Map<string, ResolvedAuthProfile> {
  if (!connectionAuthProfiles.has(session)) {
    connectionAuthProfiles.set(session, new Map<string, ResolvedAuthProfile>());
  }
  return connectionAuthProfiles.get(session);
}

function getOrCreatePasscodeKeyMap(session: WebSocket): Map<string, string> {
  if (!connectionPasscodeKeys.has(session)) {
    connectionPasscodeKeys.set(session, new Map<string, string>());
  }
  return connectionPasscodeKeys.get(session);
}

function add(ws: WebSocket): void {
  clients.set(ws, new Set<string>());
  connectionAuthProfiles.set(ws, new Map<string, ResolvedAuthProfile>());
  connectionPasscodeKeys.set(ws, new Map<string, string>());
}

function remove(ws: WebSocket): void {
  const connectionIds = clients.get(ws);
  if (connectionIds) {
    connectionIds.forEach(connectionId => {
      onDisconnect(ws, connectionId, undefined, false);
    });
  }
  clients.delete(ws);
  connectionAuthProfiles.delete(ws);
  connectionPasscodeKeys.delete(ws);
}

function clearAuthStateForConnection(ws: WebSocket, connectionId: string): void {
  const passcodeMap = connectionPasscodeKeys.get(ws);
  const passcodeKey = passcodeMap?.get(connectionId);
  if (passcodeKey) {
    const active = activeConnectionByPasscode.get(passcodeKey);
    if (active && active.ws === ws && active.connectionId === connectionId) {
      activeConnectionByPasscode.delete(passcodeKey);
    }
    passcodeMap.delete(connectionId);
  }

  const authMap = connectionAuthProfiles.get(ws);
  authMap?.delete(connectionId);
}

function onConnect(ws: WebSocket, connectionId: string, passcode?: string, usernameHint?: string): void {
  if (!passcode) {
    ws.send(JSON.stringify({ type: "error", connectionId: connectionId, message: "passcode is required" }));
    return;
  }

  const resolved = authStore.resolve(passcode, usernameHint);
  if (!resolved) {
    ws.send(JSON.stringify({ type: "error", connectionId: connectionId, message: "invalid passcode" }));
    return;
  }

  let reason: string | undefined = undefined;
  const existing = activeConnectionByPasscode.get(resolved.passcodeKey);
  if (existing && (existing.ws !== ws || existing.connectionId !== connectionId)) {
    onDisconnect(existing.ws, existing.connectionId, "replaced_by_new_session");
    reason = "replaced_existing_session";
  }

  let polite = true;
  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);

      if (pair[0] != null && pair[1] != null) {
        ws.send(JSON.stringify({ type: "error", connectionId: connectionId, message: `${connectionId}: This connection id is already used.` }));
        return;
      } else if (pair[0] != null) {
        connectionPair.set(connectionId, [pair[0], ws]);
      }
    } else {
      connectionPair.set(connectionId, [ws, null]);
      polite = false;
    }
  }

  const connectionIds = getOrCreateConnectionIds(ws);
  connectionIds.add(connectionId);
  getOrCreateAuthProfileMap(ws).set(connectionId, resolved.profile);
  getOrCreatePasscodeKeyMap(ws).set(connectionId, resolved.passcodeKey);
  activeConnectionByPasscode.set(resolved.passcodeKey, { ws, connectionId });
  const connectPayload: any = {
    type: "connect",
    connectionId: connectionId,
    polite: polite,
    authProfile: toPublicAuthProfile(resolved.profile)
  };
  if (reason) {
    connectPayload.reason = reason;
  }
  ws.send(JSON.stringify(connectPayload));
}

function onDisconnect(ws: WebSocket, connectionId: string, reason?: string, notifySource = true): void {
  const connectionIds = clients.get(ws);
  if (connectionIds) {
    connectionIds.delete(connectionId);
  }
  clearAuthStateForConnection(ws, connectionId);

  if (connectionPair.has(connectionId)) {
    const pair = connectionPair.get(connectionId);
    const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
    if (otherSessionWs) {
      otherSessionWs.send(JSON.stringify({ type: "disconnect", connectionId: connectionId, reason }));
    }
  }
  connectionPair.delete(connectionId);
  if (notifySource && clients.has(ws)) {
    ws.send(JSON.stringify({ type: "disconnect", connectionId: connectionId, reason }));
  }
}

function onOffer(ws: WebSocket, message: any): void {
  const connectionId = message.connectionId as string;
  const authProfile = connectionAuthProfiles.get(ws)?.get(connectionId);
  const newOffer = new Offer(message.sdp, Date.now(), false, authProfile);

  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);
      const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
      if (otherSessionWs) {
        newOffer.polite = true;
        otherSessionWs.send(JSON.stringify({ from: connectionId, to: "", type: "offer", data: newOffer }));
      }
    }
    return;
  }

  connectionPair.set(connectionId, [ws, null]);
  clients.forEach((_v, k) => {
    if (k == ws) {
      return;
    }
    k.send(JSON.stringify({ from: connectionId, to: "", type: "offer", data: newOffer }));
  });
}

function onAnswer(ws: WebSocket, message: any): void {
  const connectionId = message.connectionId as string;
  const connectionIds = getOrCreateConnectionIds(ws);
  connectionIds.add(connectionId);
  const newAnswer = new Answer(message.sdp, Date.now());

  if (!connectionPair.has(connectionId)) {
    return;
  }

  const pair = connectionPair.get(connectionId);
  const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];

  if (!otherSessionWs || !clients.has(otherSessionWs)) {
    return;
  }

  if (!isPrivate) {
    connectionPair.set(connectionId, [otherSessionWs, ws]);
  }

  otherSessionWs.send(JSON.stringify({ from: connectionId, to: "", type: "answer", data: newAnswer }));
}

function onCandidate(ws: WebSocket, message: any): void {
  const connectionId = message.connectionId;
  const candidate = new Candidate(message.candidate, message.sdpMLineIndex, message.sdpMid, Date.now());

  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);
      const otherSessionWs = pair[0] == ws ? pair[1] : pair[0];
      if (otherSessionWs) {
        otherSessionWs.send(JSON.stringify({ from: connectionId, to: "", type: "candidate", data: candidate }));
      }
    }
    return;
  }

  clients.forEach((_v, k) => {
    if (k === ws) {
      return;
    }
    k.send(JSON.stringify({ from: connectionId, to: "", type: "candidate", data: candidate }));
  });
}

export { reset, add, remove, onConnect, onDisconnect, onOffer, onAnswer, onCandidate };
