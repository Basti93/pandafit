import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeErrorKind } from '../claude-client';
import type { PaceCache } from './garmin-runs';
import { readKeyedNotes, type KeyedNote } from '../../shared/change-notes';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

/** A disposable cache per profile (Ruling 3): the records are the truth, so a lost file only costs a recomputation. */
export type RunCache = {
  profileId: string;
  paceCache: PaceCache;
  attempts: number;
  lastAttemptMs: number | null;
  lastError: ClaudeErrorKind | null;
  /** Per week: the inputs its plan was settled for. A changed key replans the week. */
  planKey: Record<string, string>;
  /** Per week: the day ratings (bike and gym) its plan was made with. A changed rating of a day still ahead replans the week. */
  planDays: Record<string, Record<string, string>>;
  /** Weeks whose review record was written. */
  reviewed: string[];
  /** When running was switched on; null while off. Anchors the first test run. */
  onSinceMs: number | null;
  /** The phase the last plan was made in; null before the first plan. A different one is a change worth a note. */
  lastPhase: 1 | 2 | null;
  /** Phase changes, light weeks and test weeks ("Zuletzt geändert"): at most 20, none older than 60 days. */
  changeNotes: KeyedNote[];
};

const file = (dir: string, profileId: string) => path.join(dir, `${encodeURIComponent(profileId)}.json`);

export const initialRunCache = (profileId: string): RunCache => ({
  profileId, paceCache: {}, attempts: 0, lastAttemptMs: null, lastError: null, planKey: {}, planDays: {}, reviewed: [], onSinceMs: null, lastPhase: null, changeNotes: [],
});

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export const loadRunCache = (dir: string, profileId: string): RunCache => {
  const f = file(dir, profileId);
  if (!fs.existsSync(f)) return initialRunCache(profileId);
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!isObj(parsed) || !isObj(parsed.paceCache) || !isObj(parsed.planKey) || !Array.isArray(parsed.reviewed)) throw new Error('not a cache');
    const c: RunCache = { ...initialRunCache(profileId), ...(parsed as Partial<RunCache>), profileId };
    return { ...c, planDays: isObj(c.planDays) ? c.planDays : {}, lastPhase: c.lastPhase === 1 || c.lastPhase === 2 ? c.lastPhase : null, changeNotes: readKeyedNotes(c.changeNotes) };
  } catch {
    return initialRunCache(profileId);
  }
};

export const saveRunCache = (dir: string, cache: RunCache): void => {
  fs.mkdirSync(dir, { recursive: true });
  const f = file(dir, cache.profileId);
  writeJsonAtomic(f, cache);
};
