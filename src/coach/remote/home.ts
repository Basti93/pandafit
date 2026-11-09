import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

const SAFE_ID = /^[A-Za-z0-9-]+$/;

/** The folder for a profile's server coach on this Mac: the moved marker, the cached state and the queue. */
export const remoteDir = (coachDir: string, profileId: string): string => path.join(coachDir, 'remote', profileId);
const marker = (coachDir: string, profileId: string): string => path.join(remoteDir(coachDir, profileId), 'moved.json');

/** Where a profile's coach runs. A moved profile without a link (unlinked, or never linked here) is local again. */
export const homeOf = (coachDir: string, profileId: string, linked: boolean): 'local' | 'server' => {
  if (!linked || !SAFE_ID.test(profileId)) return 'local';
  return fs.existsSync(marker(coachDir, profileId)) ? 'server' : 'local';
};

/** The move finished: from now on the server coaches this profile. */
export const markMoved = (coachDir: string, profileId: string, info: { atMs: number; counts: { rides: number; items: number } }): void => {
  if (!SAFE_ID.test(profileId)) throw new Error('invalid profile id');
  const dir = remoteDir(coachDir, profileId);
  fs.mkdirSync(dir, { recursive: true });
  const f = marker(coachDir, profileId);
  writeJsonAtomic(f, info);
};

/**
 * Back to the local coach. The cached server state and the queue are set aside (renamed, never deleted), so a later move
 * starts clean and never sends writes from before the unlink.
 */
export const clearMoved = (coachDir: string, profileId: string, nowMs: number = Date.now()): void => {
  if (!SAFE_ID.test(profileId)) return;
  fs.rmSync(marker(coachDir, profileId), { force: true });
  const dir = remoteDir(coachDir, profileId);
  for (const name of ['state', 'queue', 'drift', 'finish-sent']) {
    try { fs.renameSync(path.join(dir, `${name}.json`), path.join(dir, `${name}.unlinked-${nowMs}.json`)); } catch { /* not there */ }
  }
};

const mealsMarker = (coachDir: string): string => path.join(coachDir, 'remote', 'meals-moved.json');

/** The household's meal plan went to the server. Kept for good, so a profile still here cannot take it back. */
export const mealsMoved = (coachDir: string): boolean => fs.existsSync(mealsMarker(coachDir));

export const markMealsMoved = (coachDir: string, atMs: number): void => {
  const f = mealsMarker(coachDir);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  writeJsonAtomic(f, { atMs });
};

/** The local meal file: `<coachDir>/meals/household.json`. */
export const mealFile = (coachDir: string): string => path.join(coachDir, 'meals', 'household.json');

/**
 * Everyone the meal plan counts, as the server counts them: every person listed in the household's meal settings, meals on
 * or off. Without a meal file, every profile on this Mac.
 */
export const mealPeople = (coachDir: string, profileIds: string[]): string[] => {
  let d: unknown;
  try { d = JSON.parse(fs.readFileSync(mealFile(coachDir), 'utf8')); } catch { return profileIds; }
  const settings = (d as { settings?: unknown } | null)?.settings;
  return typeof settings === 'object' && settings !== null && !Array.isArray(settings) ? Object.keys(settings) : [];
};

/** The meal plan goes up now: it has not moved yet, and everyone it counts has. */
export const mealsDue = (coachDir: string, profileIds: string[], onServer: (id: string) => boolean): boolean => {
  if (mealsMoved(coachDir)) return false;
  const people = mealPeople(coachDir, profileIds);
  return people.every((id) => { try { return onServer(id); } catch { return false; } });
};

const driftFile = (coachDir: string, profileId: string): string => path.join(remoteDir(coachDir, profileId), 'drift.json');

/** Items changed here after the server took over: kept on this Mac, not on the server. Empty when none. */
export const driftOf = (coachDir: string, profileId: string): string[] => {
  if (!SAFE_ID.test(profileId)) return [];
  try {
    const d = JSON.parse(fs.readFileSync(driftFile(coachDir, profileId), 'utf8')) as { items?: unknown };
    return Array.isArray(d.items) ? d.items.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
};

export const recordDrift = (coachDir: string, profileId: string, items: string[], atMs: number): void => {
  if (!SAFE_ID.test(profileId)) return;
  const f = driftFile(coachDir, profileId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  writeJsonAtomic(f, { atMs, items });
};
