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

const SessionLifetimeMs = 5 * 60 * 1000;

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

/**
 * Issues the short-lived signaling sessions that both cast and guest links exchange their key for.
 *
 * Admission itself is no longer decided here. A guest used to wait on a pending record in this
 * service and only receive a session once a cast member approved it, which meant the waiting list
 * lived on the signaling host while the people on it existed nowhere. Guests now connect on
 * entering the green room and wait inside the show, so Unity - the only process that knows who is
 * actually connected - owns the waiting list and the admission decision. What survives here is the
 * access boundary: a valid link, and only a valid link, buys a session.
 */
export class AdmissionService {
  private readonly configPath: string;
  private readonly sessions = new Map<string, AdmissionSession>();

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

      // A guest session connects them to the green room, not to the show. Unity puts every guest
      // behind its own admission gate on arrival, so handing the session over here grants a seat in
      // the waiting room rather than a place on air.
      const identity: AdmissionIdentity = { username, profile: 'guest', kind: 'guest' };
      res.json({ token: this.issueSession(identity), identity });
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
  }
}
