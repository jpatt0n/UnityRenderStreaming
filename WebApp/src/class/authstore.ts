import * as fs from "fs";
import * as path from "path";

export type AuthRole = "host" | "interviewer" | "guest" | string;

export interface StoredAuthProfile {
  passcode: string;
  passcodeId?: string;
  role: AuthRole;
  defaultUsername?: string;
  bodyType?: string;
  modelTypeDto?: unknown;
  characterDescription?: string;
  enabled?: boolean;
}

interface AuthProfileFile {
  profiles: StoredAuthProfile[];
}

export interface ResolvedAuthProfile {
  passcodeId: string;
  role: AuthRole;
  username: string;
  bodyType?: string;
  modelTypeDto?: unknown;
  characterDescription?: string;
}

export interface PublicAuthProfile {
  passcodeId: string;
  role: AuthRole;
  username: string;
  bodyType?: string;
  modelTypeDto?: unknown;
}

export interface AuthResolution {
  passcodeKey: string;
  profile: ResolvedAuthProfile;
}

const defaultProfiles: StoredAuthProfile[] = [
  {
    passcode: "HOSTBOT",
    passcodeId: "hostbot",
    role: "host",
    defaultUsername: "hostbot",
    characterDescription: "A steady host who keeps sessions moving clearly and calmly."
  },
  {
    passcode: "JOSH",
    passcodeId: "josh",
    role: "host",
    defaultUsername: "josh",
    characterDescription: "An energetic host who drives momentum and quick decisions."
  },
  {
    passcode: "BIRD",
    passcodeId: "bird",
    role: "host",
    defaultUsername: "bird",
    characterDescription: "A reflective host who stays observant and detail-oriented."
  },
  {
    passcode: "TESTGUEST",
    passcodeId: "testguest",
    role: "host",
    defaultUsername: "testguest",
    characterDescription: "A flexible test host profile for validation and troubleshooting."
  }
];

function getDefaultAuthPath(): string {
  return path.resolve(__dirname, "../../config/auth-passcodes.json");
}

function normalizePasscode(value: string): string {
  return (value || "").trim().toUpperCase();
}

function normalizeUsername(value: string): string {
  return (value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

function toModelTypeDto(value: unknown): unknown {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
}

function parseProfiles(raw: unknown): StoredAuthProfile[] {
  if (Array.isArray(raw)) {
    return raw as StoredAuthProfile[];
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as AuthProfileFile).profiles)) {
    return (raw as AuthProfileFile).profiles;
  }
  return [];
}

export function toPublicAuthProfile(profile: ResolvedAuthProfile): PublicAuthProfile {
  return {
    passcodeId: profile.passcodeId,
    role: profile.role,
    username: profile.username,
    bodyType: profile.bodyType,
    modelTypeDto: profile.modelTypeDto
  };
}

class AuthStore {
  private readonly profileMap: Map<string, StoredAuthProfile> = new Map<string, StoredAuthProfile>();
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || process.env.AUTH_PASSCODE_FILE || getDefaultAuthPath();
    this.load();
  }

  load(): void {
    this.profileMap.clear();
    let records: StoredAuthProfile[] = [];
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(content);
        records = parseProfiles(parsed);
      }
    } catch (err) {
      console.warn(`[authstore] Failed to load ${this.filePath}:`, err);
    }

    if (!records.length) {
      records = defaultProfiles;
    }

    for (const record of records) {
      if (!record || typeof record.passcode !== "string") {
        continue;
      }
      const passcodeKey = normalizePasscode(record.passcode);
      if (!passcodeKey) {
        continue;
      }
      this.profileMap.set(passcodeKey, record);
    }
  }

  resolve(passcode: string, usernameHint?: string): AuthResolution | null {
    const passcodeKey = normalizePasscode(passcode);
    if (!passcodeKey) {
      return null;
    }
    const stored = this.profileMap.get(passcodeKey);
    if (!stored || stored.enabled === false) {
      return null;
    }

    const hint = normalizeUsername(usernameHint || "");
    const fallback = normalizeUsername(stored.defaultUsername || "");
    const username = hint || fallback || normalizeUsername(stored.passcodeId || "");
    const passcodeId = (stored.passcodeId || passcodeKey).trim().toLowerCase();

    return {
      passcodeKey,
      profile: {
        passcodeId,
        role: stored.role || "guest",
        username,
        bodyType: stored.bodyType,
        modelTypeDto: toModelTypeDto(stored.modelTypeDto),
        characterDescription: stored.characterDescription
      }
    };
  }
}

export const authStore = new AuthStore();
