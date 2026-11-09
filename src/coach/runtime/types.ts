import type { spawn } from 'node:child_process';
import type { Profile } from '../../shared/profiles';
import type { CoachClientMessage, CoachServerMessage, CoachStateMessage } from '../protocol';
import type { Together } from '../together';
import type { CoachState } from '../state';
import { RecordStore } from '../tracking/store';
import type { RecordLinks } from '../tracking/link';
import { AccountSync } from '../tracking/mac-sync';
import { MealCoach, type MealsView } from '../meals/meal-coach';
import type { SecretCodec } from '../secrets/secret-box';
import { type GarminTokens } from '../secrets/garmin-tokens';
import type { MailConfig } from '../mail-client';

export type RuntimeOptions = {
  /** Holds `rides/`, `coach/`, `garmin/`, `hevy/` and `accounts/`. */
  root: string;
  profiles: () => Profile[];
  /** False while a ride is open: no Claude, Hevy or Garmin run then. */
  noOpenRide: () => boolean;
  /** False pauses the runs a scan starts (planning, debrief, gym, meals, Hevy, Garmin). A message still gets its answer. Default: always. */
  scheduled?: () => boolean;
  /** True while a heavy run (Claude) is going: the Hevy and Garmin syncs wait. Default: never. */
  heavyBusy?: () => boolean;
  ask: (input: { prompt: string; systemPrompt: string; schema: object }) => Promise<unknown>;
  python: string;
  /** Folder with `bridge.py`, `garmin_sync.py`, `garmin_upload.py` and `garmin_workout.py`. */
  garminScripts: string;
  links: RecordLinks;
  /**
   * 'own': a meal plan in `coach/meals`, ticked here. A getter: a shared meal plan, ticked by its owner, asked on every use;
   * while it gives null, meal messages are ignored and the view has `meals: null`. null: no meal plan.
   */
  meals: 'own' | (() => MealCoach | null) | null;
  together: () => Together;
  /**
   * False for a profile coached by the server (moved): here only its records sync and, while the meal plan is local, its
   * meals. No planning, no debrief, no Hevy, Garmin or gym runs and no answer to its coach messages. Default: always.
   */
  coachHere?: (profileId: string) => boolean;
  /** False once the meal plan is the server's: the own meal plan is not ticked here any more. Default: always. */
  mealsHere?: () => boolean;
  nowMs?: () => number;
  /** How long a finished ride waits for feedback before planning anyway. */
  waitMs?: number;
  /** For tests: Garmin runs and Hevy requests. */
  spawnFn?: typeof spawn;
  fetchFn?: typeof fetch;
  /** How the Hevy key is stored per profile. Default: plain, as on the Mac. */
  hevyCodec?: (profileId: string) => SecretCodec;
  /** Where the Garmin login lives. Default: plain in `<root>/garmin/tokens/<id>`, as on the Mac. */
  garminTokens?: GarminTokens;
  /** The mail service for the weekly overview. null or missing: no mail. */
  mail?: MailConfig | null;
};

export type CoachRuntime = {
  /** `atMs`: when a change applied late (queued while offline) was made. Without it the change is made now. */
  handle(m: CoachClientMessage, reply: (m: CoachServerMessage) => void, atMs?: number): void;
  view(profileId: string): CoachStateMessage | null;
  scan(): void;
  /** The files of a ride were replaced: its summary is made again from the new files. */
  rideReplaced(profileId: string, rideId: string): void;
  /** profileId: that profile's records changed. null: anything else changed. A view is worth sending again either way. */
  onChange(fn: (profileId: string | null) => void): () => void;
  /** Tells the listeners that the profile's records changed, e.g. when a shared meal plan wrote them outside this runtime. */
  notify(profileId: string): void;
  coachState(profileId: string): CoachState | null;
  /** The meal plan as this runtime shows it to a profile, also to one coached by the server. */
  mealsView(profileId: string): MealsView | null;
  /** The together page as this runtime computes it. */
  together(): Together;
  profileIds(): string[];
  /** Weekdays (Monday 0) the profile usually trains on, from rides and workouts. For a meal plan shared by several runtimes. */
  trainingDays(profileId: string): number[];
  records: RecordStore;
  accountSync: AccountSync;
};
