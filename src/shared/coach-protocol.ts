import type { CoachState, Rating } from '../coach/state';
import type { Together } from '../coach/together';
import type { GarminReadiness } from './garmin';
import type { GarminSuggestion } from './garmin-profile';
import type { GymPublic } from '../coach/gym/public';
import type { GymWorkout } from '../coach/gym/types';
import type { StrengthHealth } from '../coach/strength';
import type { MobilityView } from '../coach/mobility/mobility';
import type { RecordKind, TrackedRecord } from './records';
import type { MealsView } from '../coach/meals/meal-coach';
import type { ItemState } from './meals';
import type { Profile } from './profiles';
import type { LiveMessage } from './live';

export type GarminStatus =
  | { state: 'idle' | 'connecting' | 'needs-mfa' | 'connected' }
  | { state: 'failed'; reason: 'credentials' | 'rate-limit' | 'setup' | 'failed' };

export type GarminSyncInfo = { running: boolean; lastRunMs: number | null; complete: boolean; problem: 'reauth' | 'rate-limit' | 'failed' | null };

export type HevyStatus =
  | { state: 'idle' | 'connecting' }
  | { state: 'connected'; workouts: number; loading: boolean; lastSyncMs: number | null }
  | { state: 'failed'; reason: 'invalid' | 'expired' | 'failed' };

/** The link to a Pandafit account. Never carries the token or the password. */
export type AccountStatus = { state: 'idle' | 'linking' | 'linked' | 'rejected' | 'failed'; name: string | null; reason: 'invalid' | 'limited' | 'url' | 'failed' | null; refused: number; offline: boolean; lastSyncMs: number | null;
  /** The origin of the linked server's web app (https only), for "Web-App öffnen". Absent without a link or on an old coach. */
  webOrigin?: string | null };

export type CoachClientMessage =
  | { type: 'account-link'; profileId: string; url: string; name: string; password: string }
  | { type: 'account-unlink'; profileId: string }
  | { type: 'hevy-connect'; profileId: string; key: string }
  | { type: 'hevy-disconnect'; profileId: string }
  | { type: 'garmin-login'; profileId: string; email: string; password: string }
  | { type: 'garmin-mfa'; profileId: string; code: string }
  | { type: 'garmin-disconnect'; profileId: string }
  | { type: 'set-ftp'; profileId: string; ftpW: number }
  | { type: 'subscribe'; profileId: string }
  | { type: 'feedback'; profileId: string; rideId: string; rating: Rating }
  | { type: 'skip-feedback'; profileId: string } | { type: 'skip-ramp'; profileId: string }
  | { type: 'note'; profileId: string; text: string }
  | { type: 'complaint-update'; profileId: string; id: string; status: 'active' | 'healing' | 'over' }
  | { type: 'answer-question'; profileId: string; questionId: string; text: string }
  | { type: 'skip-question'; profileId: string }
  | { type: 'debrief-seen'; profileId: string }
  | { type: 'garmin-upload-settings'; profileId: string; mode: 'off' | 'ask' }
  | { type: 'garmin-upload'; profileId: string; rideId: string; repoLink?: boolean }
  | { type: 'debrief-answer'; profileId: string; rideId: string; question: string; text: string }
  | { type: 'debrief-skip-question'; profileId: string; rideId: string; question: string }
  | { type: 'remove-motive'; profileId: string; atMs: number }
  | { type: 'ride-detail'; profileId: string; rideId: string }
  | { type: 'word-result'; profileId: string; nl: string; knew: boolean }
  | { type: 'adjust'; profileId: string; how: 'easier' | 'harder' | 'shorter' }
  | { type: 'pass-select'; profileId: string; passId: string }
  | { type: 'pass-progress'; profileId: string; passId: string; distanceM: number }
  | { type: 'pass-summit'; profileId: string; passId: string }
  | { type: 'gym-adjust'; profileId: string; how: 'easier' | 'harder' | 'shorter' }
  | { type: 'gym-note'; profileId: string; text: string }
  | { type: 'gym-answer'; profileId: string; question: string; text: string }
  | { type: 'gym-skip-question'; profileId: string; question: string }
  | { type: 'gym-start'; profileId: string }
  | { type: 'gym-forget'; profileId: string }
  | { type: 'gym-preview'; profileId: string }
  | { type: 'gym-confirm'; profileId: string; name: string }
  | { type: 'mobility-done'; profileId: string; sessionId: string }
  | { type: 'mobility-feel'; profileId: string; text: string }
  | { type: 'meals-settings'; profileId: string; settings: unknown }
  | { type: 'meals-replan'; profileId: string; week: string }
  | { type: 'meals-swap'; profileId: string; week: string; meal: string; ai: boolean }
  | { type: 'meals-chat'; profileId: string; week: string; text: string }
  | { type: 'meals-eater'; profileId: string; week: string; meal: string; person: string; on: boolean }
  | { type: 'meals-item'; profileId: string; week: string; item: string; state: ItemState }
  | { type: 'records-put'; requestId: string; profileId: string; record: TrackedRecord; seenMs?: number }
  | { type: 'records-list'; requestId: string; profileId: string; kind: RecordKind }
  /** The profile's values (name, FTP, weight ...) as changed on a client. The server coach keeps them per account. */
  | { type: 'profile-update'; profileId: string; profile: Profile }
  /**
   * A change made while the server was unreachable or a ride was open, with the time it was made. Only QUEUEABLE messages count.
   * qid is the client's id for the entry: the server answers every queued message with a queued-ack carrying it.
   */
  | { type: 'queued'; qid: string; atMs: number; message: CoachClientMessage }
  /** The running ride (Mac to server), a phone's command or the Mac's answer to it. Never queued, never stored. */
  | LiveMessage;

/** What a client may queue while offline: writes a person made, never a login, a key, an upload or a request that wants an answer. */
export const QUEUEABLE: ReadonlySet<CoachClientMessage['type']> = new Set<CoachClientMessage['type']>([
  'feedback', 'skip-feedback', 'note', 'complaint-update', 'answer-question', 'skip-question', 'debrief-seen', 'debrief-answer',
  'debrief-skip-question', 'remove-motive', 'set-ftp', 'adjust', 'skip-ramp', 'word-result', 'pass-select', 'pass-progress',
  'pass-summit', 'gym-adjust', 'gym-note', 'gym-answer', 'gym-skip-question', 'mobility-done', 'mobility-feel',
  'meals-settings', 'meals-eater', 'meals-item', 'garmin-upload-settings', 'profile-update',
]);

/** Where a profile's coach runs, as the Mac shows it. */
export type CoachHome =
  | { where: 'local' }
  /**
   * problem: other-profile (the account holds another profile), offline (server not reached; tried again), unreadable (an item here
   * cannot be read), missing (the server keeps missing an item), too-large (a ride over the upload limit), refused (the server refused a request).
   */
  | { where: 'moving'; done: number; total: number; problem: 'other-profile' | 'offline' | 'unreadable' | 'missing' | 'too-large' | 'refused' | null }
  /**
   * full: the queue holds its most entries, so further writes are refused until the server is back. drift: items changed here after
   * the server took over on a cut-off finish; they stay on this Mac and did not reach the server.
   */
  | { where: 'server'; online: boolean; sinceMs: number | null; session: 'server' | 'cached' | 'rules'; queued: number; full: boolean; drift?: string[];
      /** Finished rides on this Mac the server does not hold yet. Only the Mac knows; absent on the phone. */
      pendingRides?: number };
export type RideDetail = { rideId: string; points: { t: number; powerW: number | null; hrBpm: number | null; cadenceRpm: number | null }[] };
export type GymConfirmResult = 'written' | 'stale' | 'failed';
/** queued-ack: the queued entry was handled (applied, skipped as stale or ignored as invalid) and may leave the client's queue. */
export type CoachServerMessage = LiveMessage | { type: 'queued-ack'; qid: string } | { type: 'records'; requestId: string; kind: RecordKind; records: TrackedRecord[] } | { type: 'records-put-result'; requestId: string; ok: boolean; refused?: boolean; kept?: boolean; updatedMs?: number } | { type: 'records-changed'; profileId: string } | { type: 'gym-preview'; preview: { workout: GymWorkout; edited: boolean; leftOut?: string[] } | null } | { type: 'gym-confirm-result'; result: GymConfirmResult } | { type: 'ride-detail'; detail: RideDetail } | { type: 'coach-state'; state: CoachState; thinking: boolean; debriefing?: boolean; together: Together; hevy?: HevyStatus; garmin?: GarminStatus; garminSync?: GarminSyncInfo; garminReadiness?: GarminReadiness | null; garminSuggestion?: GarminSuggestion | null; gym?: GymPublic | null; strengthHealth?: StrengthHealth | null; mobility?: MobilityView | null; account?: AccountStatus; meals?: MealsView | null; profile?: Profile; coachHome?: CoachHome };
export type CoachStateMessage = Extract<CoachServerMessage, { type: 'coach-state' }>;
export const COACH_PORT = 7411;
