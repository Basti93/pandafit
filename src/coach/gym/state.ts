import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeErrorKind } from '../claude-client';
import type { GymWorkout } from './types';
import type { GymOutlook } from '../../shared/gym-outlook';
import { readKeyedNotes, type KeyedNote } from '../../shared/change-notes';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

export type GymState = {
  profileId: string;
  next: { workout: GymWorkout; reason: string; source: 'claude' | 'rules' } | null;
  /** The workouts after the next one, sketched, and where the training is heading. Null until the AI planned. */
  outlook: GymOutlook | null;
  /** Why there is no workout right now: the rule workout found nothing to offer. Never stored as a workout. */
  emptyReason: string | null;
  lastNote: { workoutId: string; text: string; questions: string[]; atMs: number } | null;
  /** The rider's own notes, handed to the AI as data. */
  notes: { atMs: number; text: string }[];
  answers: { atMs: number; question: string; text: string }[];
  seenWorkoutIds: string[];
  routine: { routineId: string; updatedAt: string } | null;
  /** True once a plan completed (by AI or by the rules after a refused answer). */
  planned: boolean;
  /** The open complaints the plan took into account. The only thing from the bike coach that can trigger a replan. */
  complaintsFingerprint: string;
  /** The gym question after a long break is asked once per break. */
  gymAsked: boolean;
  dirty: boolean;
  attempts: number;
  attemptKey: string | null;
  lastError: ClaudeErrorKind | null;
  lastAttemptMs: number | null;
  /** When fetching the templates last failed. Such a failure is no attempt: it only waits and tries again. */
  templatesFailedMs: number | null;
  /** "Krafttraining starten": the rider began without Hevy. Kept on the Mac only. */
  localStart: boolean;
  /** Hevy template id to own exercise id, as last seen. Kept so history stays linked after Hevy is removed. */
  links: Record<string, string>;
  /** What a new plan changed on an exercise and why ("Zuletzt geändert"): at most 20, none older than 60 days. */
  changeNotes: KeyedNote[];
};

const file = (dir: string, profileId: string) => path.join(dir, `${encodeURIComponent(profileId)}.json`);

export const initialGymState = (profileId: string): GymState => ({
  profileId, next: null, outlook: null, emptyReason: null, lastNote: null, notes: [], answers: [], seenWorkoutIds: [],
  routine: null, planned: false, complaintsFingerprint: '', gymAsked: false, dirty: false, attempts: 0, attemptKey: null, lastError: null, lastAttemptMs: null, templatesFailedMs: null, localStart: false, links: {}, changeNotes: [],
});

export const loadGymState = (dir: string, profileId: string): GymState => {
  const f = file(dir, profileId);
  if (!fs.existsSync(f)) return initialGymState(profileId);
  try {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8')) as GymState;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not a state');
    const { rules: _old, goal: _goal, ...rest } = parsed as GymState & { rules?: unknown; goal?: unknown };
    return { ...initialGymState(profileId), ...rest, profileId, changeNotes: readKeyedNotes(rest.changeNotes) };
  } catch {
    try { fs.copyFileSync(f, `${f}.broken`); } catch { /* starting fresh matters more */ }
    return initialGymState(profileId);
  }
};

/** Writes the state. Legacy `rules` already in the file stay there until `dropLegacy` says they were migrated into records. */
export const saveGymState = (dir: string, state: GymState, dropLegacy = false): void => {
  fs.mkdirSync(dir, { recursive: true });
  const f = file(dir, state.profileId);
  const keep = dropLegacy ? undefined : legacyField(f);
  writeJsonAtomic(f, keep === undefined ? state : { ...state, rules: keep });
};

export const removeGymState = (dir: string, profileId: string): void => {
  fs.rmSync(file(dir, profileId), { force: true });
};

/** The free-text rules older versions kept in the state file (moved to `rule` records, see tracking/personal). */
export const legacyGymRules = (dir: string, profileId: string): string[] => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(dir, profileId), 'utf8')) as { rules?: unknown };
    return Array.isArray(parsed.rules) ? parsed.rules.flatMap((r: unknown) => (typeof (r as { text?: unknown })?.text === 'string' ? [(r as { text: string }).text] : [])) : [];
  } catch { return []; }
};

const legacyField = (f: string): unknown => {
  try { const r = (JSON.parse(fs.readFileSync(f, 'utf8')) as { rules?: unknown }).rules; return Array.isArray(r) && r.length ? r : undefined; } catch { return undefined; }
};
