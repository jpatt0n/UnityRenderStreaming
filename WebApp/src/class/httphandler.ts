import { Request, Response } from 'express';
import Offer from './offer';
import Answer from './answer';
import Candidate from './candidate';
import { v4 as uuid } from 'uuid';
import { authStore, ResolvedAuthProfile, toPublicAuthProfile } from './authstore';

class Disconnection {
  id: string;
  datetime: number;
  reason?: string;
  constructor(id: string, datetime: number, reason?: string) {
    this.id = id;
    this.datetime = datetime;
    this.reason = reason;
  }
}

const TimeoutRequestedTime = 10000; // 10sec

let isPrivate: boolean;

// [{sessonId:[connectionId,...]}]
const clients: Map<string, Set<string>> = new Map<string, Set<string>>();

// [{sessonId:Date}]
const lastRequestedTime: Map<string, number> = new Map<string, number>();

// [{connectionId:[sessionId1, sessionId2]}]
const connectionPair: Map<string, [string, string]> = new Map<string, [string, string]>(); // key = connectionId

// [{sessionId:[{connectionId:Offer},...]}]
const offers: Map<string, Map<string, Offer>> = new Map<string, Map<string, Offer>>(); // key = sessionId

// [{sessionId:[{connectionId:Answer},...]}]
const answers: Map<string, Map<string, Answer>> = new Map<string, Map<string, Answer>>(); // key = sessionId

// [{sessionId:[{connectionId:Candidate},...]}]
const candidates: Map<string, Map<string, Candidate[]>> = new Map<string, Map<string, Candidate[]>>(); // key = sessionId

// [{sessionId:[Disconnection,...]}]
const disconnections: Map<string, Disconnection[]> = new Map<string, Disconnection[]>(); // key = sessionId

// [{sessionId:{connectionId:ResolvedAuthProfile}}]
const connectionAuthProfiles: Map<string, Map<string, ResolvedAuthProfile>> =
  new Map<string, Map<string, ResolvedAuthProfile>>();

// [{sessionId:{connectionId:passcodeKey}}]
const connectionPasscodeKeys: Map<string, Map<string, string>> =
  new Map<string, Map<string, string>>();

// [{passcodeKey:{sessionId,connectionId}}]
const activeConnectionByPasscode: Map<string, { sessionId: string, connectionId: string }> =
  new Map<string, { sessionId: string, connectionId: string }>();

function getOrCreateConnectionIds(sessionId: string): Set<string> {
  let connectionIds = null;
  if (!clients.has(sessionId)) {
    connectionIds = new Set<string>();
    clients.set(sessionId, connectionIds);
  }
  connectionIds = clients.get(sessionId);
  return connectionIds;
}

function reset(mode: string): void {
  isPrivate = mode == "private";
  clients.clear();
  connectionPair.clear();
  offers.clear();
  answers.clear();
  candidates.clear();
  disconnections.clear();
  connectionAuthProfiles.clear();
  connectionPasscodeKeys.clear();
  activeConnectionByPasscode.clear();
  authStore.load();
}

function getOrCreateAuthProfileMap(sessionId: string): Map<string, ResolvedAuthProfile> {
  if (!connectionAuthProfiles.has(sessionId)) {
    connectionAuthProfiles.set(sessionId, new Map<string, ResolvedAuthProfile>());
  }
  return connectionAuthProfiles.get(sessionId);
}

function getOrCreatePasscodeKeyMap(sessionId: string): Map<string, string> {
  if (!connectionPasscodeKeys.has(sessionId)) {
    connectionPasscodeKeys.set(sessionId, new Map<string, string>());
  }
  return connectionPasscodeKeys.get(sessionId);
}

function checkSessionId(req: Request, res: Response, next): void {
  if (req.url === '/') {
    next();
    return;
  }
  const id: string = req.header('session-id');
  if (!clients.has(id)) {
    res.sendStatus(404);
    return;
  }
  lastRequestedTime.set(id, Date.now());
  next();
}

function getCurrentDatetime(sessionId: string): number {
  return lastRequestedTime.get(sessionId) || Date.now();
}

function clearAuthStateForConnection(sessionId: string, connectionId: string): void {
  const passcodeMap = connectionPasscodeKeys.get(sessionId);
  const passcodeKey = passcodeMap?.get(connectionId);
  if (passcodeKey) {
    const active = activeConnectionByPasscode.get(passcodeKey);
    if (active && active.connectionId === connectionId && active.sessionId === sessionId) {
      activeConnectionByPasscode.delete(passcodeKey);
    }
    passcodeMap.delete(connectionId);
  }

  const authMap = connectionAuthProfiles.get(sessionId);
  authMap?.delete(connectionId);

  if (passcodeMap && passcodeMap.size === 0) {
    connectionPasscodeKeys.delete(sessionId);
  }
  if (authMap && authMap.size === 0) {
    connectionAuthProfiles.delete(sessionId);
  }
}

function _deleteConnection(sessionId:string, connectionId:string, datetime:number, reason?: string) {
  if (clients.has(sessionId)) {
    clients.get(sessionId).delete(connectionId);
  }

  if(isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);
      const otherSessionId = pair[0] == sessionId ? pair[1] : pair[0];
      if (otherSessionId) {
        if (clients.has(otherSessionId)) {
          clients.get(otherSessionId).delete(connectionId);
          const array1 = disconnections.get(otherSessionId);
          array1.push(new Disconnection(connectionId, datetime, reason));
        }
      }
    }
  } else {
    disconnections.forEach((array, id) => {
      if (id == sessionId)
        return;
      array.push(new Disconnection(connectionId, datetime, reason));
    });
  }

  connectionPair.delete(connectionId);
  offers.get(sessionId)?.delete(connectionId);
  answers.get(sessionId)?.delete(connectionId);
  candidates.get(sessionId)?.delete(connectionId);
  clearAuthStateForConnection(sessionId, connectionId);

  const array2 = disconnections.get(sessionId);
  if (array2) {
    array2.push(new Disconnection(connectionId, datetime, reason));
  }
}

function _deleteSession(sessionId: string) {
  if(clients.has(sessionId)) {
    for(const connectionId of Array.from(clients.get(sessionId))) {
      _deleteConnection(sessionId, connectionId, Date.now());
    }
  }
  offers.delete(sessionId);
  answers.delete(sessionId);
  candidates.delete(sessionId);
  clients.delete(sessionId);
  disconnections.delete(sessionId);
  connectionAuthProfiles.delete(sessionId);
  connectionPasscodeKeys.delete(sessionId);
}

function _checkForTimedOutSessions(): void {
  for (const sessionId of Array.from(clients.keys()))
  {
    if(!lastRequestedTime.has(sessionId))
      continue;
    if(lastRequestedTime.get(sessionId) > Date.now() - TimeoutRequestedTime)
      continue;
    _deleteSession(sessionId);
    console.log(`deleted sessionId:${sessionId} by timeout.`);
  }
}

function _getConnection(sessionId: string): string[] {
  _checkForTimedOutSessions();
  return Array.from(clients.get(sessionId));
}

function _getDisconnection(sessionId: string, fromTime: number): Disconnection[] {
  _checkForTimedOutSessions();
  let arrayDisconnections: Disconnection[] = [];
  if (disconnections.size != 0 && disconnections.has(sessionId)) {
    arrayDisconnections = disconnections.get(sessionId);
  }

  if (fromTime > 0) {
    arrayDisconnections = arrayDisconnections.filter((v) => v.datetime >= fromTime);
  }
  return arrayDisconnections;
}

function _getOffer(sessionId: string, fromTime: number): [string, Offer][] {
  let arrayOffers: [string, Offer][] = [];

  if (offers.size != 0) {
    if (isPrivate) {
      if (offers.has(sessionId)) {
        arrayOffers = Array.from(offers.get(sessionId));
      }
    } else {
      const otherSessionMap = Array.from(offers).filter(x => x[0] != sessionId);
      arrayOffers = [].concat(...Array.from(otherSessionMap, x => Array.from(x[1], y => [y[0], y[1]])));
    }
  }

  if (fromTime > 0) {
    arrayOffers = arrayOffers.filter((v) => v[1].datetime >= fromTime);
  }
  return arrayOffers;
}

function _getAnswer(sessionId: string, fromTime: number): [string, Answer][] {
  let arrayAnswers: [string, Answer][] = [];

  if (answers.size != 0 && answers.has(sessionId)) {
    arrayAnswers = Array.from(answers.get(sessionId));
  }

  if (fromTime > 0) {
    arrayAnswers = arrayAnswers.filter((v) => v[1].datetime >= fromTime);
  }
  return arrayAnswers;
}

function _getCandidate(sessionId: string, fromTime: number): [string, Candidate][] {
  const connectionIds = Array.from(clients.get(sessionId));
  const arr: [string, Candidate][] = [];
  for (const connectionId of connectionIds) {
    const pair = connectionPair.get(connectionId);
    if (pair == null) {
      continue;
    }
    const otherSessionId = sessionId === pair[0] ? pair[1] : pair[0];
    if (!candidates.get(otherSessionId) || !candidates.get(otherSessionId).get(connectionId)) {
      continue;
    }
    const arrayCandidates = candidates.get(otherSessionId).get(connectionId)
      .filter((v) => v.datetime >= fromTime);
    if (arrayCandidates.length === 0) {
      continue;
    }
    for (const candidate of arrayCandidates) {
      arr.push([connectionId, candidate]);
    }
  }
  return arr;
}

function getAnswer(req: Request, res: Response): void {
  // get `fromtime` parameter from request query
  const fromTime: number = req.query.fromtime ? Number(req.query.fromtime) : 0;
  const sessionId: string = req.header('session-id');
  const answers: [string, Answer][] = _getAnswer(sessionId, fromTime);
  res.json({ answers: answers.map((v) => ({ connectionId: v[0], sdp: v[1].sdp, type: "answer", datetime: v[1].datetime })) });
}

function getConnection(req: Request, res: Response): void {
  // get `fromtime` parameter from request query
  const sessionId: string = req.header('session-id');
  const connections = _getConnection(sessionId);
  res.json({ connections: connections.map((v) => ({ connectionId: v, type: "connect", datetime: Date.now() })) });
}

function getOffer(req: Request, res: Response): void {
  // get `fromtime` parameter from request query
  const fromTime: number = req.query.fromtime ? Number(req.query.fromtime) : 0;
  const sessionId: string = req.header('session-id');
  const offers = _getOffer(sessionId, fromTime);
  res.json({
    offers: offers.map((v) => ({
      connectionId: v[0],
      sdp: v[1].sdp,
      polite: v[1].polite,
      authProfile: v[1].authProfile,
      type: "offer",
      datetime: v[1].datetime
    }))
  });
}

function getCandidate(req: Request, res: Response): void {
  // get `fromtime` parameter from request query
  const fromTime: number = req.query.fromtime ? Number(req.query.fromtime) : 0;
  const sessionId: string = req.header('session-id');
  const candidates = _getCandidate(sessionId, fromTime);
  res.json({ candidates: candidates.map((v) => ({ connectionId: v[0], candidate: v[1].candidate, sdpMLineIndex: v[1].sdpMLineIndex, sdpMid: v[1].sdpMid, type: "candidate", datetime: v[1].datetime })) });
}

function getAll(req: Request, res: Response): void {
  const fromTime: number = req.query.fromtime ? Number(req.query.fromtime) : 0;
  const sessionId: string = req.header('session-id');
  const connections = _getConnection(sessionId);
  const offers = _getOffer(sessionId, fromTime);
  const answers: [string, Answer][] = _getAnswer(sessionId, fromTime);
  const candidates: [string, Candidate][] = _getCandidate(sessionId, fromTime);
  const disconnections: Disconnection[] = _getDisconnection(sessionId, fromTime);
  const datetime = lastRequestedTime.get(sessionId);

  let array: any[] = [];

  array = array.concat(connections.map((v) => ({ connectionId: v, type: "connect", datetime: datetime })));
  array = array.concat(offers.map((v) => ({
    connectionId: v[0],
    sdp: v[1].sdp,
    polite: v[1].polite,
    authProfile: v[1].authProfile,
    type: "offer",
    datetime: v[1].datetime
  })));
  array = array.concat(answers.map((v) => ({ connectionId: v[0], sdp: v[1].sdp, type: "answer", datetime: v[1].datetime })));
  array = array.concat(candidates.map((v) => ({ connectionId: v[0], candidate: v[1].candidate, sdpMLineIndex: v[1].sdpMLineIndex, sdpMid: v[1].sdpMid, type: "candidate", datetime: v[1].datetime })));
  array = array.concat(disconnections.map((v) => ({ connectionId: v.id, reason: v.reason, type: "disconnect", datetime: v.datetime })));

  array.sort((a, b) => a.datetime - b.datetime);
  res.json({ messages: array, datetime: datetime });
}

function createSession(sessionId: string, res: Response): void;
function createSession(req: Request, res: Response): void;

function createSession(req: string | Request, res: Response): void {
  const sessionId: string = typeof req === "string" ? req : uuid();
  clients.set(sessionId, new Set<string>());
  offers.set(sessionId, new Map<string, Offer>());
  answers.set(sessionId, new Map<string, Answer>());
  candidates.set(sessionId, new Map<string, Candidate[]>());
  disconnections.set(sessionId, []);
  connectionAuthProfiles.set(sessionId, new Map<string, ResolvedAuthProfile>());
  connectionPasscodeKeys.set(sessionId, new Map<string, string>());
  res.json({ sessionId: sessionId });
}

function deleteSession(req: Request, res: Response): void {
  const id: string = req.header('session-id');
  _deleteSession(id);
  res.sendStatus(200);
}

function createConnection(req: Request, res: Response): void {
  const sessionId: string = req.header('session-id');
  const { connectionId, passcode, usernameHint } = req.body;
  const datetime = getCurrentDatetime(sessionId);

  if (connectionId == null) {
    res.status(400).send({ error: new Error(`connectionId is required`) });
    return;
  }

  if (!passcode) {
    res.status(401).send({ error: { message: "passcode is required" } });
    return;
  }

  const resolved = authStore.resolve(passcode, usernameHint);
  if (!resolved) {
    res.status(401).send({ error: { message: "invalid passcode" } });
    return;
  }

  let reason: string | undefined = undefined;
  const existing = activeConnectionByPasscode.get(resolved.passcodeKey);
  if (existing && (existing.sessionId !== sessionId || existing.connectionId !== connectionId)) {
    _deleteConnection(existing.sessionId, existing.connectionId, datetime, "replaced_by_new_session");
    reason = "replaced_existing_session";
  }

  let polite = true;
  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);

      if (pair[0] != null && pair[1] != null) {
        const err = new Error(`${connectionId}: This connection id is already used.`);
        console.log(err);
        res.status(400).send({ error: err });
        return;
      } else if (pair[0] != null) {
        connectionPair.set(connectionId, [pair[0], sessionId]);
        const map = getOrCreateConnectionIds(pair[0]);
        map.add(connectionId);
      }
    } else {
      connectionPair.set(connectionId, [sessionId, null]);
      polite = false;
    }
  }

  const connectionIds = getOrCreateConnectionIds(sessionId);
  connectionIds.add(connectionId);
  getOrCreateAuthProfileMap(sessionId).set(connectionId, resolved.profile);
  getOrCreatePasscodeKeyMap(sessionId).set(connectionId, resolved.passcodeKey);
  activeConnectionByPasscode.set(resolved.passcodeKey, { sessionId, connectionId });

  const payload = {
    connectionId: connectionId,
    polite: polite,
    authProfile: toPublicAuthProfile(resolved.profile),
    type: "connect",
    datetime: datetime
  } as any;
  if (reason) {
    payload.reason = reason;
  }

  res.json(payload);
}

function deleteConnection(req: Request, res: Response): void {
  const sessionId: string = req.header('session-id');
  const { connectionId } = req.body;
  const datetime = getCurrentDatetime(sessionId);

  _deleteConnection(sessionId, connectionId, datetime);

  res.json({ connectionId: connectionId });
}

function postOffer(req: Request, res: Response): void {
  const sessionId: string = req.header('session-id');
  const { connectionId } = req.body;
  const datetime = getCurrentDatetime(sessionId);
  const authProfile = connectionAuthProfiles.get(sessionId)?.get(connectionId);
  let keySessionId = null;
  let polite = false;

  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId);
      keySessionId = pair[0] == sessionId ? pair[1] : pair[0];
      if (keySessionId != null) {
        polite = true;
        const map = offers.get(keySessionId);
        map.set(connectionId, new Offer(req.body.sdp, datetime, polite, authProfile));
      }
    }
    res.sendStatus(200);
    return;
  }

  if(!connectionPair.has(connectionId))
  {
    connectionPair.set(connectionId, [sessionId, null]);
  }

  keySessionId = sessionId;
  const map = offers.get(keySessionId);
  map.set(connectionId, new Offer(req.body.sdp, datetime, polite, authProfile));

  res.sendStatus(200);
}

function postAnswer(req: Request, res: Response): void {
  const sessionId: string = req.header('session-id');
  const { connectionId } = req.body;
  const datetime = getCurrentDatetime(sessionId);
  const connectionIds = getOrCreateConnectionIds(sessionId);
  connectionIds.add(connectionId);

  if (!connectionPair.has(connectionId)) {
    res.sendStatus(200);
    return;
  }

  // add connectionPair
  const pair = connectionPair.get(connectionId);
  const otherSessionId = pair[0] == sessionId ? pair[1] : pair[0];
  if (!clients.has(otherSessionId)) {
    // already deleted
    res.sendStatus(200);
    return;
  }

  if (!isPrivate) {
    connectionPair.set(connectionId, [otherSessionId, sessionId]);
  }

  const map = answers.get(otherSessionId);
  map.set(connectionId, new Answer(req.body.sdp, datetime));

  // update datetime for candidates
  const mapCandidates = candidates.get(otherSessionId);
  if (mapCandidates) {
    const arrayCandidates = mapCandidates.get(connectionId);
    if (arrayCandidates) {
      for (const candidate of arrayCandidates) {
        candidate.datetime = datetime;
      }
    }
  }
  res.sendStatus(200);
}

function postCandidate(req: Request, res: Response): void {
  const sessionId: string = req.header('session-id');
  const { connectionId } = req.body;
  const datetime = getCurrentDatetime(sessionId);

  const map = candidates.get(sessionId);
  if (!map.has(connectionId)) {
    map.set(connectionId, []);
  }
  const arr = map.get(connectionId);
  const candidate = new Candidate(req.body.candidate, req.body.sdpMLineIndex, req.body.sdpMid, datetime);
  arr.push(candidate);
  res.sendStatus(200);
}

export { reset, checkSessionId, getAll, getConnection, getOffer, getAnswer, getCandidate, createSession, deleteSession, createConnection, deleteConnection, postOffer, postAnswer, postCandidate };
