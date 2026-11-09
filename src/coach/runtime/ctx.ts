import type { Profile } from '../../shared/profiles';
import type { CoachStateMessage } from '../protocol';
import { Coach } from '../coach';
import { GarminLink } from '../garmin';
import { type GarminCoachData } from '../readiness';
import { GarminSync } from '../garmin-sync';
import { HevyLinks } from '../hevy';
import { GarminUploader } from '../garmin-uploader';
import { ExerciseMapper } from '../gym/exercise-mapper';
import { GymCoach } from '../gym/gym-coach';
import { RecordStore } from '../tracking/store';
import { MobilityCoach } from '../mobility/mobility';
import { GarminWorkouts } from '../run/garmin-workouts';
import { RunCoach } from '../run/run-coach';
import { allActivities, ActivitySeen } from '../activity-feed';
import { CoachTasks } from '../coach-tasks';
import { ChatCoach } from '../chat/chat-coach';
import { type PublishedAdvice, type StatsBody } from '../../shared/stats';
import { AccountSync } from '../tracking/mac-sync';
import { MealCoach } from '../meals/meal-coach';
import type { RuntimeOptions } from './types';

export type { RuntimeOptions, CoachRuntime } from './types';

/** How often the stats and health records are made at most (or at once on a new date). */
export const STATS_EVERY_MS = 5 * 60_000;

/** Everything the message handlers and the scan steps work with. Built once in `createCoachRuntime`. */
export type RuntimeCtx = {
  opts: RuntimeOptions;
  profiles: () => Profile[];
  noOpenRide: () => boolean;
  scheduled: () => boolean;
  heavyBusy: () => boolean;
  mealsHere: () => boolean;
  nowMs: () => number;
  waitMs: number;
  ask: RuntimeOptions['ask'];
  dir: string;
  coachDir: string;
  garminDir: string;

  known: (profileId: string) => boolean;
  coachHere: (profileId: string) => boolean;
  /** The profiles this runtime coaches: all of profiles() but the ones the server coaches. */
  coached: () => Profile[];
  /** Tells the listeners that anything changed. */
  publish: () => void;
  /** Tells the listeners that the profile's records changed. */
  notifyRecords: (profileId: string) => void;
  /** After a write to these profiles' records: sync them and tell the listeners. */
  mealsChanged: (touched: string[]) => void;
  /** Makes the bike coach plan the profile again. */
  refresh: (profileId: string) => void;

  records: RecordStore;
  coach: Coach;
  gym: GymCoach;
  run: RunCoach;
  mobility: MobilityCoach;
  chat: ChatCoach;
  tasks: CoachTasks;
  exerciseMapper: ExerciseMapper;
  hevy: HevyLinks;
  garmin: GarminLink;
  garminSync: GarminSync;
  uploader: GarminUploader;
  workouts: GarminWorkouts;
  accountSync: AccountSync;
  ownCoach: MealCoach | null;
  /** The meal plan right now: the own one, the shared one once it is there, or none. */
  mealsNow: () => MealCoach | null;
  activitySeen: ActivitySeen;

  view: (profileId: string) => CoachStateMessage | null;
  startUpload: (profileId: string, rideId: string, repoLink: boolean) => void;
  garminData: (profileId: string) => GarminCoachData | null;
  activitiesOf: (id: string) => ReturnType<typeof allActivities>;
  adviceOf: (id: string) => PublishedAdvice | null;
  gymDoneDates: (id: string) => string[];
  personalKey: (id: string) => string;
  statsDue: (id: string) => Omit<StatsBody, 'atMs'> | null;
};
