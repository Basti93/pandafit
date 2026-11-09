import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileAtomic } from './atomic-write';

const FILE = 'local-token';
const TOKEN_RE = /^[0-9a-f]{64}$/;

/** The token of this machine for the local WebSockets, or null if there is none yet. */
export const readLocalToken = (dataDir: string): string | null => {
  try {
    const t = fs.readFileSync(path.join(dataDir, FILE), 'utf8').trim();
    return TOKEN_RE.test(t) ? t : null;
  } catch { return null; }
};

/** Reads the token or creates it (32 random bytes as hex, mode 0600). */
export const ensureLocalToken = (dataDir: string): string => {
  const have = readLocalToken(dataDir);
  if (have) return have;
  fs.mkdirSync(dataDir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  writeFileAtomic(path.join(dataDir, FILE), token, { mode: 0o600 });
  return token;
};

/** Constant-time comparison; a missing or differently long token never matches. */
export const tokenMatches = (expected: string, given: string | null | undefined): boolean => {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** The app's data folder: the parent of BIKE_DATA_DIR (`rides/`) if set, else the Mac default. */
export const appDataDir = (env: NodeJS.ProcessEnv = process.env): string =>
  env.BIKE_DATA_DIR ? path.dirname(env.BIKE_DATA_DIR) : path.join(os.homedir(), 'Library', 'Application Support', 'bike-coach');

/** The token for a process of ours: the variable the app sets, else the file. Throws if there is none, so that nothing listens unprotected. */
export const requireLocalToken = (env: NodeJS.ProcessEnv = process.env): string => {
  const t = env.PANDAFIT_LOCAL_TOKEN || readLocalToken(appDataDir(env));
  if (!t) throw new Error('Kein lokales Token (PANDAFIT_LOCAL_TOKEN oder local-token im Datenordner)');
  return t;
};

/** Port variables: the PANDAFIT_ name first, the old BIKE_ names as fallback. */
export const servicePort = (fallback: number, env: NodeJS.ProcessEnv = process.env): number =>
  Number(env.PANDAFIT_SERVICE_PORT ?? env.BIKE_SERVICE_PORT ?? env.BIKE_PORT ?? fallback);
export const coachPort = (fallback: number, env: NodeJS.ProcessEnv = process.env): number =>
  Number(env.PANDAFIT_COACH_PORT ?? env.BIKE_COACH_PORT ?? fallback);
