import fs from 'node:fs';
import type { ClaudeErrorKind } from '../claude-client';
import type { GymWorkout } from '../../shared/gym/types';
import type { GymOutlook } from '../../shared/gym-outlook';
import { readKeyedNotes, type KeyedNote } from '../../shared/change-notes';
import { createStateFile, legacyRuleTexts, profileStateFile } from '../state-file';

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

const file = profileStateFile;

export const initialGymState = (profileId: string): GymState => ({
  profileId, next: null, outlook: null, emptyReason: null, lastNote: null, notes: [], answers: [], seenWorkoutIds: [],
  routine: null, planned: false, complaintsFingerprint: '', gymAsked: false, dirty: false, attempts: 0, attemptKey: null, lastError: null, lastAttemptMs: null, templatesFailedMs: null, localStart: false, links: {}, changeNotes: [],
});

export const loadGymState = (dir: string, profileId: string): GymState =>
  createStateFile<GymState>(file(dir, profileId), {
    empty: () => initialGymState(profileId),
    migrate: (parsed) => {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not a state');
      // `rules` moved to records, `goal` is gone.
      const { rules: _old, goal: _goal, ...rest } = parsed as GymState & { rules?: unknown; goal?: unknown };
      return { ...initialGymState(profileId), ...rest, profileId, changeNotes: readKeyedNotes(rest.changeNotes) };
    },
  }).load();

/** Writes the state. Legacy `rules` already in the file stay there until `dropLegacy` says they were migrated into records. */
export const saveGymState = (dir: string, state: GymState, dropLegacy = false): void =>
  createStateFile<GymState>(file(dir, state.profileId), { empty: () => state }).save(state, { keepRules: !dropLegacy });

export const removeGymState = (dir: string, profileId: string): void => {
  fs.rmSync(file(dir, profileId), { force: true });
};

/** The free-text rules older versions kept in the state file (moved to `rule` records, see tracking/personal). */
export const legacyGymRules = (dir: string, profileId: string): string[] => legacyRuleTexts(file(dir, profileId));
