import type { WordProgress } from '../shared/language';
import type { PassState } from '../shared/passes';
import type { Session } from '../shared/session';
import type { ClaudeErrorKind } from './claude-client';
import type { RideDebrief } from './debrief';
import type { GarminUploadSettings } from '../shared/garmin-upload';
import type { RideSummary } from './metrics';
import { RAMP_ID } from '../shared/session';
import type { Complaint, Motive } from './motivation';
import { ruleBasedSession } from './rules';
import { createStateFile, legacyRuleTexts, profileStateFile } from './state-file';

/** Shorter rides are test rides or false starts and do not count as training (our own choice). */
export const MIN_COUNTED_S = 300;

export type Rating = 'easy' | 'right' | 'hard';
export type CoachState = {
  profileId: string; ftpW: number; ftpCapW?: number;
  ftpHistory: { atMs: number; ftpW: number; source: 'manual' | 'ramp' | 'coach' }[];
  phase: { name: string; weeksLeft: number; goal: string };
  ftpForecast: { weeksAhead: number; ftpW: number }[];
  next: { session: Session; reason: string; source: 'claude' | 'rules' };
  alternatives?: { session: Session; why: string }[];
  wordProgress?: WordProgress;
  pass?: PassState;
  changes: { atMs: number; text: string }[];
  notes: { atMs: number; text: string; reply?: string }[];
  complaints?: Complaint[];
  /** Old notes were read once for complaints. */
  complaintsFromNotes?: true;
  motives?: Motive[];
  lastQuestionMs?: number;
  encouragement?: string;
  garminUpload?: GarminUploadSettings;
  debriefs?: Record<string, RideDebrief>;
  /** Ride whose debrief still has to be shown once. */
  debriefToShow?: string | null;
  feedback: Record<string, Rating>;
  summaries: RideSummary[];
  processedRides: string[];
  awaitingFeedback: string | null;
  dirty: boolean;
  dirtySinceMs: number | null;
  lastError: ClaudeErrorKind | null;
  lastAttemptMs: number | null;
};

const file = profileStateFile;

const initial = (profileId: string, ftpW: number, nowMs: number): CoachState => ({
  profileId, ftpW, ftpHistory: [{ atMs: nowMs, ftpW, source: 'manual' }],
  phase: { name: 'Einstieg', weeksLeft: 0, goal: 'Locker anfangen und die Belastung kennenlernen' }, ftpForecast: [],
  next: { ...ruleBasedSession({ ftpW, summaries: [], nowMs }), source: 'rules' },
  changes: [], notes: [], feedback: {}, summaries: [], processedRides: [], awaitingFeedback: null,
  dirty: false, dirtySinceMs: null, lastError: null, lastAttemptMs: null,
});

export const loadState = (dir: string, profileId: string, initialFtpW: number, nowMs: number): CoachState =>
  createStateFile<CoachState>(file(dir, profileId), {
    empty: () => initial(profileId, initialFtpW, nowMs),
    migrate: (raw) => {
      const s = raw as CoachState & { rules?: unknown };
      // Free-text rules moved to `rule` records, see tracking/personal.
      delete s.rules;
      // An upload cut off by a restart: unknown whether it arrived, a repeat is harmless because Garmin recognizes it.
      for (const r of Object.values(s.garminUpload?.rides ?? {})) if (r.status === 'uploading') { r.status = 'failed'; r.reason = 'failed'; }
      // The ramp test is no longer mandatory: older states without a ride start with a normal session.
      if (s.next.session.id === RAMP_ID && s.summaries.length === 0) s.next = initial(profileId, s.ftpW, nowMs).next;
      // Older states: take out short rides that were already counted and have them replanned.
      const counted = s.summaries.filter((r) => r.durationS >= MIN_COUNTED_S);
      if (counted.length !== s.summaries.length) {
        if (s.awaitingFeedback && !counted.some((r) => r.rideId === s.awaitingFeedback)) s.awaitingFeedback = null;
        s.summaries = counted;
        s.dirty = true;
        s.dirtySinceMs ??= nowMs;
      }
      return s;
    },
  }).load();

/** Writes the state. Legacy `rules` already in the file stay there until `dropLegacy` says they were migrated into records. */
export const saveState = (dir: string, state: CoachState, dropLegacy = false): void =>
  createStateFile<CoachState>(file(dir, state.profileId), { empty: () => state }).save(state, { keepRules: !dropLegacy });

/** The free-text rules older versions kept in the state file (moved to `rule` records, see tracking/personal). */
export const legacyBikeRules = (dir: string, profileId: string): string[] => legacyRuleTexts(file(dir, profileId));
