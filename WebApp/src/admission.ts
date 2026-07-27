import * as crypto from 'crypto';
import * as express from 'express';
import * as fs from 'fs';
import * as path from 'path';

export type AdmissionIdentity = {
  username: string;
  profile: string;
  kind: 'cast' | 'guest';
};

type CastPass = {
  key: string;
  defaultUsername: string;
  profile: string;
  allowUsernameOverride?: boolean;
  enabled?: boolean;
};

type GuestInvite = {
  key: string;
  username: string;
  enabled?: boolean;
  expiresAt?: string;
};

type AccessConfig = {
  cast: CastPass[];
  guests: GuestInvite[];
};

type AdmissionSession = {
  identity: AdmissionIdentity;
  expiresAt: number;
};

type PendingGuest = {
  id: string;
  identity: AdmissionIdentity;
  requestedAt: number;
  status: 'waiting' | 'approved';
  sessionToken?: string;
};

const SessionLifetimeMs = 5 * 60 * 1000;
const PendingLifetimeMs = 2 * 60 * 60 * 1000;

function sanitizeUsername(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export class AdmissionService {
  private readonly configPath: string;
  private readonly sessions = new Map<string, AdmissionSession>();
  private readonly pendingGuests = new Map<string, PendingGuest>();

  constructor(configPath = process.env.ACCESS_CONFIG || path.join(process.cwd(), 'access.local.json')) {
    this.configPath = configPath;
  }

  public createPublicRouter(): express.Router {
    const router = express.Router();

    router.post('/cast', (req, res) => {
      const config = this.loadConfig();
      const key = String(req.body?.key ?? '');
      const castPass = config.cast.find(pass => pass.enabled !== false && safeEqual(pass.key, key));
      if (!castPass) {
        res.status(403).json({ error: 'This access link is invalid or disabled.' });
        return;
      }

      const defaultUsername = sanitizeUsername(castPass.defaultUsername);
      const requestedUsername = sanitizeUsername(req.body?.username);
      const username = castPass.allowUsernameOverride !== false && requestedUsername
        ? requestedUsername
        : defaultUsername;
      const profile = sanitizeUsername(castPass.profile);

      if (!username || !profile) {
        res.status(500).json({ error: 'The cast pass is not configured correctly.' });
        return;
      }

      const identity: AdmissionIdentity = { username, profile, kind: 'cast' };
      res.json({ token: this.issueSession(identity), identity });
    });

    router.post('/guest', (req, res) => {
      const config = this.loadConfig();
      const key = String(req.body?.key ?? '');
      const invite = config.guests.find(candidate => candidate.enabled !== false && safeEqual(candidate.key, key));
      const expired = invite?.expiresAt && Date.parse(invite.expiresAt) <= Date.now();
      if (!invite || expired) {
        res.status(403).json({ error: 'This guest link is invalid, expired, or disabled.' });
        return;
      }

      const username = sanitizeUsername(invite.username);
      if (!username) {
        res.status(500).json({ error: 'The guest invite is not configured correctly.' });
        return;
      }

      this.cleanup();
      const existing = Array.from(this.pendingGuests.values()).find(
        pending => pending.identity.username === username && pending.status === 'waiting'
      );
      if (existing) {
        res.json(this.publicPending(existing));
        return;
      }

      const pending: PendingGuest = {
        id: randomToken(),
        identity: { username, profile: 'guest', kind: 'guest' },
        requestedAt: Date.now(),
        status: 'waiting',
      };
      this.pendingGuests.set(pending.id, pending);
      res.json(this.publicPending(pending));
    });

    router.post('/guest/preview', (req, res) => {
      const config = this.loadConfig();
      const key = String(req.body?.key ?? '');
      const invite = config.guests.find(candidate => candidate.enabled !== false && safeEqual(candidate.key, key));
      const expired = invite?.expiresAt && Date.parse(invite.expiresAt) <= Date.now();
      if (!invite || expired) {
        res.status(403).json({ error: 'This guest link is invalid, expired, or disabled.' });
        return;
      }

      const username = sanitizeUsername(invite.username);
      if (!username) {
        res.status(500).json({ error: 'The guest invite is not configured correctly.' });
        return;
      }

      res.json({ identity: { username, profile: 'guest', kind: 'guest' } });
    });

    router.get('/guest/:id', (req, res) => {
      this.cleanup();
      const pending = this.pendingGuests.get(req.params.id);
      if (!pending) {
        res.status(404).json({ error: 'This green-room request is no longer active.' });
        return;
      }
      res.json(this.publicPending(pending));
    });

    return router;
  }

  public createPrivateRouter(): express.Router {
    const router = express.Router();

    router.get('/pending', (_req, res) => {
      this.cleanup();
      const waiting = Array.from(this.pendingGuests.values())
        .filter(pending => pending.status === 'waiting')
        .sort((left, right) => left.requestedAt - right.requestedAt)
        .map(pending => ({
          id: pending.id,
          username: pending.identity.username,
          requestedAt: new Date(pending.requestedAt).toISOString(),
        }));
      res.json({ waiting });
    });

    router.post('/pending/:id/approve', (req, res) => {
      this.cleanup();
      const pending = this.pendingGuests.get(req.params.id);
      if (!pending || pending.status !== 'waiting') {
        res.status(404).json({ error: 'This guest is no longer waiting.' });
        return;
      }

      pending.status = 'approved';
      pending.sessionToken = this.issueSession(pending.identity);
      res.json({ approved: true, username: pending.identity.username });
    });

    return router;
  }

  public takeSession(token: string): AdmissionIdentity | null {
    this.cleanup();
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }
    return session.identity;
  }

  private issueSession(identity: AdmissionIdentity): string {
    const token = randomToken();
    this.sessions.set(token, {
      identity,
      expiresAt: Date.now() + SessionLifetimeMs,
    });
    return token;
  }

  private publicPending(pending: PendingGuest): object {
    return {
      id: pending.id,
      status: pending.status,
      identity: pending.identity,
      token: pending.status === 'approved' ? pending.sessionToken : undefined,
    };
  }

  private loadConfig(): AccessConfig {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<AccessConfig>;
      return {
        cast: Array.isArray(parsed.cast) ? parsed.cast : [],
        guests: Array.isArray(parsed.guests) ? parsed.guests : [],
      };
    } catch (error) {
      console.warn(`[admission] Unable to load ${this.configPath}: ${error}`);
      return { cast: [], guests: [] };
    }
  }

  private cleanup(): void {
    const now = Date.now();
    this.sessions.forEach((session, token) => {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    });
    this.pendingGuests.forEach((pending, id) => {
      if (pending.requestedAt + PendingLifetimeMs <= now) {
        this.pendingGuests.delete(id);
      }
    });
  }
}
