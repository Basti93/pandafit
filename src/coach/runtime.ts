import { randomUUID } from 'node:crypto';
import type { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Profile } from '../shared/profiles';
import type { CoachClientMessage, CoachServerMessage, CoachStateMessage } from '../shared/coach-protocol';
import { suggestProfile } from '../shared/garmin-profile';
import { Coach } from './coach';
import { readRide } from '../service/recorder';
import { cleanSamples } from './metrics';
import { GarminLink } from './garmin';
import { GarminDb } from './garmin-db';
import { readinessFrom, restingHrRaised, type GarminCoachData } from './readiness';
import { GarminSync } from './garmin-sync';
import { HevyLinks } from './hevy';
import { activityName, canUpload, REPO_DESCRIPTION } from './garmin-upload';
import { GarminUploader } from './garmin-uploader';
import type { Together } from './together';
import type { CoachState } from './state';
import { mergeCatalog } from '../shared/catalog';
import { EXERCISES } from '../shared/exercises';
import { FEDB_EXERCISES } from '../shared/fedb';
import { ExerciseMapper } from './gym/exercise-mapper';
import { GymCoach } from './gym/gym-coach';
import type { StrengthHealth } from './strength';
import { HevyRoutines } from './gym/hevy-routines';
import { gymPublic } from './gym/public';
import { RecordStore } from './tracking/store';
import { goalOfProfile, personalHint } from './tracking/personal';
import { personalKeyOf } from '../shared/personal';
import { handleRecords } from './tracking/records-api';
import { errorKind } from './error-kind';
import { MobilityCoach, muscleOf } from './mobility/mobility';
import { GarminWorkouts } from './run/garmin-workouts';
import { RunCoach } from './run/run-coach';
import { dateKey, dayRatings, type DayInput, type DayRating } from './day-load';
import { allTraining } from './all-training';
import { activitiesHint, activityData, allActivities, ActivitySeen, doneByDate } from './activity-feed';
import { manualRuns } from './run/runs';
import { CoachTasks, type CoachId, type GivenTask, type TaskFrom } from './coach-tasks';
import { statsContent } from './stats/stats-content';
import { exportStats } from './tracking/stats-export';
import { exportBike, radForChat } from './tracking/bike-export';
import { daysOf, weeksOf } from './health/aggregate';
import { findingsOf } from './health/findings';
import { CoachTexts, HealthCoachText } from './health/coach-text';
import { exportHealth } from './health/health-export';
import { activityItems, exportActivities, kindOf } from './activities-export';
import { mirrorExercises } from './tracking/mirror-exercises';
import { ChatCoach } from './chat/chat-coach';
import { planHint, type TodayContext } from './chat/plan-hint';
import { frameOfProfile, gymLegsKeyOf, gymPlanDateOf, gymPlanDayNoLegs } from './tracking/frame';
import { longTermHint } from './chat/long-term';
import { PlanSeen, adviceKey, weekPlanKey } from './chat/plan-seen';
import { duePrompts, SentPrompts } from './chat/prompts';
import { addDays, mondayOf, planFor, planOfWeek, type Sport } from '../shared/week-plan';
import { runView } from '../tracking/ui/run-view';
import { newestNotes, type ChangeNote } from '../shared/change-notes';
import { readStats, STATS_ID, type NextStep, type PublishedAdvice, type StatsBody } from '../shared/stats';
import type { HealthBody } from '../shared/health';
import { todayAdvice } from '../shared/today';
import type { RecordLinks } from './tracking/link';
import { AccountSync } from './tracking/mac-sync';
import { exportTogether } from './tracking/together-export';
import { mergedHealth, mergedStrength } from './tracking/strength-source';
import { MealCoach, usualTrainingDays, type MealsView } from './meals/meal-coach';
import type { SecretCodec } from './secrets/secret-box';
import { plainTokens, type GarminTokens } from './secrets/garmin-tokens';
import type { MailConfig } from './mail-client';
import { WeeklyMailer, type WeeklyMailBase } from './weekly-mail';
import { contactOfProfile } from './tracking/contact';
import { statsView, weekMinutes, weekSessions } from '../tracking/stats';
import { chatThread } from '../shared/chat';
import { openProposals } from '../tracking/ui/chat-open';

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

const RETRY_MS = 30 * 60_000;
const GARMIN_CACHE_MS = 5 * 60_000;
const GARMIN_DAYS = 60;
/** A mobility session done without its own length counts this many minutes. */
const STATS_EVERY_MS = 5 * 60_000;
/** The health record reads 52 weeks of Garmin days. */
const HEALTH_DAYS_BACK = 370;
const READ_ONLY = new Set<string>(['subscribe', 'records-list', 'ride-detail', 'gym-preview']);

/** One coach for the profiles of one data root: the Mac's own, or one account's on the server. */
export const createCoachRuntime = (opts: RuntimeOptions): CoachRuntime => {
  const { root, profiles, noOpenRide, ask } = opts;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const scheduled = opts.scheduled ?? (() => true);
  const heavyBusy = opts.heavyBusy ?? (() => false);
  const waitMs = opts.waitMs ?? 5 * 60_000;
  const spawnOpt = opts.spawnFn ? { spawnFn: opts.spawnFn } : {};
  const dir = path.join(root, 'rides');
  const coachDir = path.join(root, 'coach');
  const garminDir = path.join(root, 'garmin');
  const hevyDir = path.join(root, 'hevy');
  const garminTokens = opts.garminTokens ?? plainTokens(garminDir);

  const listeners = new Set<(profileId: string | null) => void>();
  const emit = (profileId: string | null): void => { for (const fn of listeners) { try { fn(profileId); } catch { /* a listener never stops the coach */ } } };
  const publish = (): void => emit(null);
  const notifyRecords = (profileId: string): void => emit(profileId);
  const known = (profileId: string): boolean => profiles().some((p) => p.id === profileId);
  const coachHere = (profileId: string): boolean => opts.coachHere?.(profileId) ?? true;
  /** The profiles this runtime coaches: all of profiles() but the ones the server coaches. */
  const coached = (): Profile[] => profiles().filter((p) => coachHere(p.id));
  const mealsHere = opts.mealsHere ?? (() => true);

  const garminCache = new Map<string, { atMs: number; data: GarminCoachData | null }>();
  const garminData = (profileId: string): GarminCoachData | null => {
    if (!/^[A-Za-z0-9-]+$/.test(profileId)) return null;
    const now = nowMs();
    const cached = garminCache.get(profileId);
    if (cached && now - cached.atMs < GARMIN_CACHE_MS) return cached.data;
    const db = new GarminDb(path.join(garminDir, 'data', profileId, 'garmin.db'));
    const activities = db.activities(0);
    const days = db.days(new Date(now - GARMIN_DAYS * 86_400_000).toISOString().slice(0, 10));
    const data = activities.length || days.length ? { activities, days, body: db.body() } : null;
    garminCache.set(profileId, { atMs: now, data });
    return data;
  };

  // Optional and per profile: without a key nothing happens.
  const hevy = new HevyLinks({ baseDir: hevyDir, nowMs, ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}), ...(opts.hevyCodec ? { codec: opts.hevyCodec } : {}), onChange: (profileId) => {
    try { coach.strengthChanged(profileId); } catch { /* unknown profile */ }
    // Keeps the new Hevy workouts here too, so they stay when Hevy is removed.
    try { gym.importHevy(profileId); } catch { /* try again on the next change */ }
  } });

  const records = new RecordStore({ dir: path.join(coachDir, 'tracking') });
  const coach = new Coach({
    ridesDir: dir, coachDir, nowMs, garmin: garminData, store: records,
    strength: mergedStrength((profileId) => gym.history(profileId), (profileId) => hevy.workouts(profileId)),
    mobility: (profileId) => mobility.promptData(profileId),
    giveTask: (profileId, t) => giveTask(profileId, 'bike', t),
    planHint: (profileId) => planHint(records.all(profileId, 'weekplan'), nowMs(), 'bike', todayContextOf(profileId), doneOf(profileId)) + longTermHint(records.all(profileId, 'stats'), nowMs()) + activityHintOf(profileId) + tasks.hint(profileId, 'bike', nowMs()),
    ask,
  });

  const gymConnected = (profileId: string): boolean => hevy.status(profileId).state === 'connected';
  // Built fresh per use, never kept: a disconnected profile has no key and so no writer.
  const gymWriter = (profileId: string): HevyRoutines | null => {
    const key = hevy.apiKey(profileId);
    return key ? new HevyRoutines({ key, dir: path.join(hevyDir, profileId), nowMs }) : null;
  };
  // One exercise catalog per profile: built-ins, the base list and the profile's records (aliases the mapper or the person added).
  const catalogOf = (id: string) => mergeCatalog(EXERCISES, FEDB_EXERCISES, records.all(id, 'exercise'));
  const gym = new GymCoach({
    dir: path.join(coachDir, 'gym'), nowMs,
    store: records, hevy: gymConnected, catalog: catalogOf,
    mobility: (id) => mobility.promptData(id),
    giveTask: (id, t) => giveTask(id, 'gym', t),
    planHint: (id) => planHint(records.all(id, 'weekplan'), nowMs(), 'gym', todayContextOf(id), doneOf(id)) + longTermHint(records.all(id, 'stats'), nowMs()) + activityHintOf(id) + tasks.hint(id, 'gym', nowMs()),
    ask,
    workouts: (id) => hevy.workouts(id),
    templates: async (id) => { const w = gymWriter(id); return w ? w.templates() : []; },
    refreshTemplates: async (id) => { const w = gymWriter(id); return w ? w.refreshTemplates() : []; },
    // Without Hevy there is no history to wait for. The rider's own start is checked by the coach itself.
    ready: (id) => (gymConnected(id) ? hevy.strengthReady(id) : noOpenRide()),
    bike: (id) => { const s = coach.state(id); return { summaries: s.summaries, complaints: s.complaints ?? [] }; },
    complaint: (id, text) => coach.addComplaintFromText(id, text),
    // Tired legs on the day the gym coach plans for (the agreed plan day, or today's advice): strength goes on, without leg exercises.
    avoidLegs: (id) => {
      if (gymPlanDayNoLegs(records, id, dateKey(nowMs()), gymDoneDates(id))) return true;
      const a = adviceOf(id);
      return gymPlanDateOf(records, id, dateKey(nowMs()), gymDoneDates(id)) === dateKey(nowMs()) && a !== null && a.legs === false && (a.sport === 'gym' || a.also?.sport === 'gym');
    },
    writer: gymWriter,
    account: (id) => opts.links.status(id).state === 'linked',
    onWorkoutFinished: (id) => coach.strengthChanged(id),
  });
  const exerciseMapper = new ExerciseMapper({
    store: records, ask, nowMs, dir: path.join(coachDir, 'gym'),
    catalog: catalogOf,
    mayAsk: () => noOpenRide() && scheduled(),
  });
  // Mobility needs no Hevy and no Garmin: rides and the merged strength history are enough. Local rules and records, no AI.
  const mobility = new MobilityCoach({
    store: records, nowMs,
    rides: (id) => coach.state(id).summaries,
    strength: (id) => gym.history(id),
    complaints: (id) => coach.state(id).complaints ?? [],
    runs: (id) => run.runs(id),
  });
  /**
   * How hard each date is. Both modes count the runs done (also while the run plan is off). 'plan' adds the next bike and gym
   * sessions on their usual days (the planners use it); 'done' is only what happened (advice and statistics).
   */
  const ratingsOf = (id: string, dates: string[], mode: 'plan' | 'done'): Record<string, DayRating> => {
    const s = coach.state(id);
    const history = gym.history(id);
    const now = nowMs();
    const planned = mode === 'plan';
    return dayRatings({
      rides: s.summaries, bikeNext: planned ? s.next?.session ?? null : null, gym: history, gymNext: planned ? gym.state(id).next?.workout ?? null : null, muscleOf: (t, title) => gym.templateMuscle(id, t) ?? muscleOf(t, title),
      bikeDays: usualTrainingDays(s.summaries.map((r) => r.startedAtMs), now), gymDays: usualTrainingDays(history.map((w) => w.startMs), now),
      runs: run.runsFor(id), today: dateKey(now),
    }, dates);
  };
  /** What the hints need to say what fits today: the last days' load, goal, frame and the resting pulse. */
  const todayContextOf = (id: string): TodayContext => {
    const now = nowMs();
    const dates = Array.from({ length: 9 }, (_, i) => addDays(dateKey(now), -i));
    let ratings: Record<string, DayRating> = {};
    try { ratings = ratingsOf(id, dates, 'done'); } catch { /* no ratings: the advice goes by the plan */ }
    let readiness: TodayContext['readiness'];
    try { const data = garminData(id); if (data) readiness = { restingHrRaised: restingHrRaised(data.days) }; } catch { /* no body data */ }
    return { ratings, hour: new Date(now).getHours(), goal: goalOfProfile(records, id, dateKey(now)), frame: frameOfProfile(records, id, dateKey(now)), ...(readiness ? { readiness } : {}) };
  };
  /** What fits today for a profile, with the bike rides in the ratings; null when it cannot be told. */
  const adviceOf = (id: string): PublishedAdvice | null => {
    try {
      const ctx = todayContextOf(id);
      const date = dateKey(nowMs());
      return { ...todayAdvice({ ...ctx, date, planDay: planFor(records.all(id, 'weekplan'), date) }), date, mode: ctx.frame.mode };
    } catch { return null; }
  };
  /** What the stats record of a profile says; null when there is nothing in the nine weeks. */
  const statsOf = (id: string): Omit<StatsBody, 'atMs'> | null => {
    // After a start the gym coach has not listed the templates yet: list them once (cache first), then make the stats again.
    if (!gym.knowsTemplates(id)) void gym.templateList(id).then(() => { statsMade.delete(id); }, () => {});
    const runs = run.runsFor(id);
    const content = statsContent({
      nowMs: nowMs(), rides: coach.state(id).summaries, history: gym.history(id), runs,
      mobility: records.all(id, 'mobility'), activities: garminData(id)?.activities ?? [],
      ratings: (dates) => ratingsOf(id, dates, 'done'), goal: goalOfProfile(records, id, dateKey(nowMs())).strength,
      templateMuscle: (templateId) => gym.templateMuscle(id, templateId),
      ftp: coach.state(id).ftpHistory, weightKg: profiles().find((p) => p.id === id)?.weightKg ?? null,
    });
    // The advice with the bike rides in it, for the devices that cannot see them.
    const advice = content ? adviceOf(id) : null;
    // What the next gym workout will bring for each exercise of the last one, and why. Left out when there is none.
    let next: NextStep[] = [];
    try { next = content ? gym.nextSteps(id) : []; } catch { /* the rest of the stats still go out */ }
    // What the coaches changed lately and why, the newest few across the three. Left out when there is none.
    let changes: ChangeNote[] = [];
    try { changes = content ? newestNotes([...coach.changeNotes(id), ...gym.changeNotes(id), ...run.changeNotes(id)]) : []; } catch { /* the rest of the stats still go out */ }
    return content ? { ...content, ...(advice ? { advice } : {}), ...(next.length > 0 ? { next } : {}), ...(changes.length > 0 ? { changes } : {}) } : content;
  };
  // A newly taken week plan makes the bike and gym coach plan again (the run coach sees it in its own key).
  const planSeen = new PlanSeen(path.join(coachDir, 'chat', 'plan-seen.json'));
  // A change of the person's rules or goal makes the coaches plan again, like a new week plan. No records: no key, no replan.
  const personalSeen = new PlanSeen(path.join(coachDir, 'chat', 'personal-seen.json'));
  const taskSeen = new PlanSeen(path.join(coachDir, 'chat', 'task-seen.json'));
  const personalKey = (id: string): string => personalKeyOf(records.all(id, 'rule'), records.all(id, 'goal'), records.all(id, 'frame'), dateKey(nowMs()), records.all(id, 'change'));
  // Today's advice changing (a new day, tired legs, a raised pulse) makes the coaches plan again, at most about once a day. The first sighting only counts.
  const adviceSeen = new PlanSeen(path.join(coachDir, 'chat', 'advice-seen.json'));
  // The week conversation and the evening suggestion, only when the rider switched them on.
  const sentPrompts = new SentPrompts(path.join(coachDir, 'chat', 'prompts-sent.json'));
  /** The week conversation is tried at most this often while it fails. */
  const WEEK_RETRY_MS = 30 * 60_000;
  const weekTried = new Map<string, number>();
  const detailOf = (id: string, sport: string): string | null => {
    if (sport === 'gym') return gym.state(id).next?.workout.name ?? null;
    if (sport === 'bike') return coach.state(id).next?.session.name ?? null;
    if (sport === 'run') { const r = runView(records.all(id, 'run'), nowMs() + 86_400_000).week?.runs.find((x) => x.date === dateKey(nowMs() + 86_400_000)); return r ? `${r.minutes} Minuten` : null; }
    return null;
  };
  // The coach chat: answers the rider's messages of the profiles coached here, never with a ride open.
  const chat = new ChatCoach({
    store: records, ask, nowMs, newId: () => randomUUID(), catalog: catalogOf,
    complaints: (id) => (coach.state(id).complaints ?? []).map((c) => ({ id: c.id, text: c.text, status: c.status })),
    addComplaint: (id, text) => coach.addComplaintFromText(id, text),
    endComplaint: (id, cid) => coach.updateComplaint(id, cid, 'over', nowMs()),
    sessions: (id) => sessionsOf(id),
    giveTask: (id, t) => giveTask(id, 'chat', t),
  });
  /** What the three coaches have planned next, short, for the week chat. */
  const sessionsOf = (id: string): object => {
    const bikeState = coach.state(id);
    const g = gym.enabled(id) ? gym.state(id).next : null;
    const runWeek = runView(records.all(id, 'run'), nowMs()).week;
    return {
      ...(bikeState.next ? radForChat(bikeState) : { rad: null, radFahrten: [] }),
      kraft: g ? {
        geplant: true, name: g.workout.name, begruendung: g.reason,
        uebungen: g.workout.exercises.map((e) => {
          const work = e.sets.filter((st) => st.type !== 'warmup');
          return { titel: e.title, saetze: work.length, wdh: work[0]?.reps ?? null, kg: work[0]?.weightKg ?? null, hinweis: e.notes || undefined };
        }),
      } : null,
      laufen: runWeek ? runWeek.runs.map((r) => ({ tag: r.date, art: r.kind, minuten: r.minutes, erledigt: r.done !== null })) : null,
    };
  };
  /** The shared task board: the week chat and the coaches give each other tasks; the coach in charge plans again at once. */
  const tasks = new CoachTasks(path.join(coachDir, 'chat', 'tasks.json'), records, nowMs);
  const giveTask = (id: string, from: TaskFrom, t: GivenTask): void => {
    if (!tasks.add(id, { from, ...t }, nowMs()) || from !== 'chat') return;
    // Only the rider's task plans again at once; a coach's task waits for that coach's next plan. The run coach sees it in its plan key.
    if (t.to === 'bike') coach.taskAdded(id);
    if (t.to === 'gym') gym.taskAdded(id);
  };
  /** Every activity of a profile from every source: rides, strength (app and Hevy), Garmin, runs entered by hand. */
  const activitiesOf = (id: string) => allActivities({
    rides: coach.state(id).summaries, workouts: gym.history(id), activities: garminData(id)?.activities,
    manualRuns: manualRuns(records.all(id, 'run'), null),
  });
  /** Which sports were really done on each date, from every source. Planned sessions are not in it. */
  const doneOf = (id: string): Record<string, Sport[]> => { try { return doneByDate(activitiesOf(id)); } catch { return {}; } };
  /** Dates with a strength session from any source (also Hevy and Garmin): they move the gym coach's target day. */
  const gymDoneDates = (id: string): string[] => Object.entries(doneOf(id)).filter(([, sports]) => sports.includes('gym')).map(([d]) => d);
  // A coach must never fail over the extra block.
  const activityHintOf = (id: string): string => { try { return activitiesHint(activitiesOf(id), nowMs()); } catch { return ''; } };
  // New activities, planned or not, make every coach plan again (the run coach sees it in its own key).
  const activitySeen = new ActivitySeen(path.join(coachDir, 'chat', 'activities-seen.json'));
  /** New activities waiting for the chat's look at this week's plan. Only in memory: a restart skips one look. */
  const weekReviews = new Map<string, object[]>();
  /** When each profile's stats were last made: at most every five minutes, or at once on a new date. */
  const statsMade = new Map<string, { atMs: number; date: string }>();
  /** The health record's content per profile, made at most every five minutes (or on a new date); the cached copy is returned in between. */
  const healthMade = new Map<string, { atMs: number; date: string; body: Omit<HealthBody, 'atMs' | 'coachText'> | null }>();
  const healthContent = (id: string): Omit<HealthBody, 'atMs' | 'coachText'> | null => {
    const now = nowMs();
    const last = healthMade.get(id);
    if (last && now - last.atMs < STATS_EVERY_MS && now >= last.atMs && last.date === dateKey(now)) return last.body;
    let body: Omit<HealthBody, 'atMs' | 'coachText'> | null = null;
    try {
      const data = garminData(id);
      const days = data ? new GarminDb(path.join(garminDir, 'data', id, 'garmin.db')).days(new Date(now - HEALTH_DAYS_BACK * 86_400_000).toISOString().slice(0, 10)) : [];
      if (data && days.length) {
        const weeks = weeksOf(days, gym.history(id), now);
        body = { type: 'health', today: readinessFrom(data, coach.state(id).summaries, now), findings: findingsOf(days, weeks, { birthDate: data.body?.birthDate ?? null }, now), weeks, days: daysOf(days, now) };
      }
    } catch { body = null; }
    healthMade.set(id, { atMs: now, date: dateKey(now), body });
    return body;
  };
  const healthTexts = new CoachTexts(path.join(coachDir, 'health', 'texts.json'));
  const healthText = new HealthCoachText({ texts: healthTexts, nowMs, ask });
  const exportHealthNow = (profileIds: string[]): string[] =>
    exportHealth({ store: records, profileIds, coachHere, noOpenRide, nowMs: nowMs(), content: healthContent, coachText: (id) => healthTexts.get(id) });
  const statsDue = (id: string): Omit<StatsBody, 'atMs'> | null => {
    const now = nowMs();
    const last = statsMade.get(id);
    if (last && now - last.atMs < STATS_EVERY_MS && now >= last.atMs && last.date === dateKey(now)) return null;
    statsMade.set(id, { atMs: now, date: dateKey(now) });
    return statsOf(id);
  };
  // Optional and per profile: without a settings record and without Garmin runs it writes nothing. Plans with no ride open only.
  const run = new RunCoach({
    dir: path.join(coachDir, 'run'), store: records, nowMs, ask, noOpenRide: () => noOpenRide(),
    giveTask: (id, t) => giveTask(id, 'run', t),
    planHint: (id) => planHint(records.all(id, 'weekplan'), nowMs(), 'run', todayContextOf(id), doneOf(id)) + longTermHint(records.all(id, 'stats'), nowMs()) + activityHintOf(id) + tasks.hint(id, 'run', nowMs()),
    // A new activity of any source makes the week be planned again, from today on (from tomorrow after a run today).
    planKey: (id, week) => `${weekPlanKey(records.all(id, 'weekplan').filter((r) => r.id === week))}|a${activitySeen.version(id)}|t${tasks.version(id, 'run')}|p${personalKey(id)}`,
    profile: (id) => profiles().find((p) => p.id === id) ?? null,
    garminDb: (id) => {
      if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
      const file = path.join(garminDir, 'data', id, 'garmin.db');
      return fs.existsSync(file) ? new GarminDb(file) : null;
    },
    // Only reads the other coaches' plans and history; never changes them.
    days: (id, dates) => ratingsOf(id, dates, 'plan'),
    weeks: (id) => allTraining({ rides: coach.state(id).summaries, workouts: gym.history(id), activities: garminData(id)?.activities }, nowMs())?.weeks ?? [],
    complaints: (id) => coach.state(id).complaints ?? [],
    garmin: (id) => {
      const connected = garmin.status(id).state === 'connected';
      // Once per process, and only with a login: can the library send running workouts?
      if (connected) workouts.check(id);
      return { connected, capable: workouts.capable(id) };
    },
    sendWorkouts: (id, week, ops) => workouts.send(id, week, ops),
    onExport: (id) => { accountSync.touch(id); notifyRecords(id); },
  });
  // Planned runs go to Garmin only after a confirmation record, never during a ride and never without a login.
  const workouts = new GarminWorkouts({
    baseDir: garminDir, python: opts.python, script: path.join(opts.garminScripts, 'garmin_workout.py'),
    tokens: garminTokens, rideOpen: () => !noOpenRide(),
    onResult: (id, week, r) => { try { run.sendResult(id, week, r); } catch { /* the week stays as it was */ } publish(); },
    ...spawnOpt,
  });
  // Optional and per profile: without a link nothing is sent. Never runs with a ride open and never blocks the bike coach.
  const accountSync = new AccountSync({
    links: opts.links, store: records, nowMs, coach, gym, mobility, noOpenRide: () => noOpenRide(), coachHere,
    onChange: (profileId) => notifyRecords(profileId),
  });
  const trainingDays = (id: string): number[] => usualTrainingDays([...coach.state(id).summaries.map((r) => r.startedAtMs), ...gym.history(id).map((w) => w.startMs)], nowMs());
  // Optional and per profile, off by default: with no one in, nothing is read, asked or sent.
  const ownCoach: MealCoach | null = opts.meals === 'own' ? new MealCoach({
    dir: path.join(coachDir, 'meals'), nowMs,
    profiles: () => profiles().map(({ id, name, avatar }) => ({ id, name, ...(avatar ? { avatar } : {}) })),
    noOpenRide: () => noOpenRide(),
    ask,
    trainingDays: (id) => trainingDays(id),
    store: records, linked: (id) => opts.links.status(id).state === 'linked',
    onExport: (touched) => mealsChanged(touched),
  }) : null;
  const sharedMeals = typeof opts.meals === 'function' ? opts.meals : null;
  /** The meal plan right now: the own one, the shared one once it is there, or none. */
  const mealsNow = (): MealCoach | null => {
    if (ownCoach) return ownCoach;
    try { return sharedMeals?.() ?? null; } catch { return null; }
  };
  const mealsOf = (profileId: string) => { try { const meals = mealsNow(); return meals ? meals.view(profileId) : null; } catch { return null; } };
  function mealsChanged(touched: string[]): void { for (const id of touched) { accountSync.touch(id); notifyRecords(id); } }
  const mobilityOf = (profileId: string) => { try { return mobility.view(profileId); } catch { return null; } };
  const gymOf = (profileId: string) => {
    try {
      const connected = gymConnected(profileId);
      return gymPublic(gym.enabled(profileId), gym.state(profileId), gym.isThinking(profileId), connected ? hevy.strengthReady(profileId) : noOpenRide(), { hevy: connected, complaints: coach.state(profileId).complaints ?? [], hasHistory: gym.hasHistory(profileId) });
    } catch { return null; }
  };

  // Local workouts only, no Hevy call.
  const ownStrengthHealth = mergedHealth({ history: (id) => gym.history(id), connected: gymConnected, nowMs });
  const strengthHealthOf = (profileId: string): StrengthHealth | null => {
    try { return ownStrengthHealth(profileId); } catch { return null; }
  };

  const garmin = new GarminLink({
    baseDir: garminDir, python: opts.python, script: path.join(opts.garminScripts, 'bridge.py'),
    onUpdate: () => publish(), tokens: garminTokens, ...spawnOpt,
  });
  const garminSync = new GarminSync({
    baseDir: garminDir, python: opts.python, script: path.join(opts.garminScripts, 'garmin_sync.py'),
    rideOpen: () => !noOpenRide(), onUpdate: () => publish(), nowMs, tokens: garminTokens, ...spawnOpt,
  });

  const readinessOf = (profileId: string) => {
    try {
      const data = garminData(profileId);
      return data ? readinessFrom(data, coach.state(profileId).summaries, nowMs()) : null;
    } catch { return null; }
  };
  const suggestionOf = (profileId: string) => {
    try {
      const data = garminData(profileId);
      return data?.body ? suggestProfile(data.body, data.activities, nowMs()) : null;
    } catch { return null; }
  };
  const view = (profileId: string): CoachStateMessage | null => {
    if (!known(profileId) || !coachHere(profileId)) return null;
    try {
      return { type: 'coach-state', state: coach.state(profileId), thinking: coach.isThinking(profileId), hevy: hevy.status(profileId), debriefing: coach.isDebriefing(profileId), together: opts.together(), garmin: garmin.status(profileId), garminSync: garminSync.info(profileId), garminReadiness: readinessOf(profileId), garminSuggestion: suggestionOf(profileId), gym: gymOf(profileId), strengthHealth: strengthHealthOf(profileId), mobility: mobilityOf(profileId), account: accountSync.status(profileId), meals: mealsOf(profileId) };
    } catch { return null; }
  };
  const refresh = (profileId: string): void => {
    void coach.refresh(profileId).catch(() => {}).finally(publish);
    publish();
  };
  const uploader = new GarminUploader({
    baseDir: garminDir, python: opts.python, script: path.join(opts.garminScripts, 'garmin_upload.py'),
    exportsDir: path.join(dir, 'exports'),
    rideOpen: () => !noOpenRide(),
    tokens: garminTokens,
    onResult: (profileId, rideId, result) => { coach.markUpload(profileId, rideId, result); publish(); },
    ...spawnOpt,
  });
  const startUpload = (profileId: string, rideId: string, repoLink: boolean): void => {
    const s = coach.state(profileId);
    const ride = s.summaries.find((r) => r.rideId === rideId);
    if (ride && canUpload(s, rideId) && uploader.upload(profileId, rideId, activityName(ride), ride.startedAtMs, repoLink ? REPO_DESCRIPTION : undefined)) coach.markUpload(profileId, rideId, { status: 'uploading' });
  };

  const handleGym = (m: CoachClientMessage, send: (msg: CoachServerMessage) => void): void => {
    if (m.type === 'gym-forget') { gym.forget(m.profileId); publish(); return; }
    if (m.type === 'gym-start') { gym.start(m.profileId); publish(); return; }
    if (!('profileId' in m) || !gym.enabled(m.profileId)) {
      if (m.type === 'gym-preview') send({ type: 'gym-preview', preview: null });
      if (m.type === 'gym-confirm') send({ type: 'gym-confirm-result', result: 'failed' });
      return;
    }
    // Hevy is only read or written with no ride open.
    if (m.type === 'gym-preview') {
      if (!noOpenRide()) { send({ type: 'gym-preview', preview: null }); return; }
      void gym.preview(m.profileId).catch(() => null).then((preview) => send({ type: 'gym-preview', preview }));
      return;
    }
    if (m.type === 'gym-confirm') {
      if (!noOpenRide()) { send({ type: 'gym-confirm-result', result: 'failed' }); return; }
      void gym.confirm(m.profileId, m.name).catch((): 'failed' => 'failed').then((result) => { send({ type: 'gym-confirm-result', result }); publish(); });
      return;
    }
    if (m.type === 'gym-adjust') gym.adjust(m.profileId, m.how);
    if (m.type === 'gym-note') gym.note(m.profileId, m.text);
    if (m.type === 'gym-answer') gym.answer(m.profileId, m.question, m.text);
    if (m.type === 'gym-skip-question') gym.skipQuestion(m.profileId, m.question);
    publish();
  };

  /** Settings, ticks and who eats are local writes and fine with a ride open. Planning and swapping wait for no ride (the coach checks). */
  const handleMeals = (m: CoachClientMessage, atMs: number | undefined): void => {
    const meals = mealsNow();
    if (!meals) return;
    const sync = () => publish();
    if (m.type === 'meals-settings') meals.setSettings(m.profileId, m.settings);
    if (m.type === 'meals-eater') meals.setEater(m.profileId, m.week, m.meal, m.person, m.on === true, atMs);
    if (m.type === 'meals-item') meals.setItem(m.profileId, m.week, m.item, m.state, atMs);
    if (m.type === 'meals-replan') { void meals.replan(m.profileId, m.week).catch(() => {}).finally(sync); }
    if (m.type === 'meals-swap') { void meals.swap(m.profileId, m.week, m.meal, m.ai === true).catch(() => {}).finally(sync); }
    if (m.type === 'meals-chat') { void meals.chat(m.profileId, m.week, m.text).catch(() => {}).finally(sync); }
    sync();
  };

  const handle = (m: CoachClientMessage, reply: (msg: CoachServerMessage) => void, atMs?: number): void => {
    const send = (msg: CoachServerMessage) => { try { reply(msg); } catch { /* connection gone */ } };
    try {
      // The server coach handles a profile update and a queued change itself, before they reach a runtime.
      if (m.type === 'queued' || m.type === 'profile-update') return;
      // Records check the profile themselves and always answer the request.
      if (m.type === 'records-put' || m.type === 'records-list') {
        if (m.type === 'records-put' && known(m.profileId)) accountSync.touch(m.profileId);
        // A finished workout plans the gym here only for a profile coached here; the server plans for a moved one.
        const recordsGym = { start: (id: string) => { if (coachHere(id)) gym.start(id); }, workoutFinished: (id: string) => { if (coachHere(id)) gym.workoutFinished(id); } };
        const out = handleRecords({ store: records, gym: recordsGym, profiles: () => profiles().map((p) => p.id) }, m);
        send(out.reply);
        if (out.changed) {
          notifyRecords(out.changed);
          publish();
        }
        return;
      }
      // Only this runtime's profiles: a message for any other changes nothing here. A request still gets its empty answer.
      if (typeof m.profileId !== 'string' || !known(m.profileId)) {
        if (m.type === 'gym-preview') send({ type: 'gym-preview', preview: null });
        if (m.type === 'gym-confirm') send({ type: 'gym-confirm-result', result: 'failed' });
        return;
      }
      // The password is only passed on to the server once, never stored, logged or sent back.
      if (m.type === 'account-link') { void accountSync.link(m.profileId, m.url, m.name, m.password).catch(() => {}).finally(publish); publish(); return; }
      if (m.type === 'account-unlink') { accountSync.unlink(m.profileId); publish(); return; }
      // The server coaches a moved profile; only its meals stay here while the meal plan is local.
      if (!coachHere(m.profileId) && !m.type.startsWith('meals-')) {
        if (m.type === 'gym-preview') send({ type: 'gym-preview', preview: null });
        if (m.type === 'gym-confirm') send({ type: 'gym-confirm-result', result: 'failed' });
        return;
      }
      if (!READ_ONLY.has(m.type)) accountSync.touch(m.profileId);
      // Login credentials are only passed on, never stored or sent back.
      // The key is only passed on and stored privately, never sent back.
      if (m.type === 'hevy-connect') { void hevy.connect(m.profileId, m.key).catch(() => {}).finally(publish); publish(); return; }
      if (m.type === 'hevy-disconnect') { hevy.disconnect(m.profileId); publish(); return; }
      if (m.type === 'garmin-login') { garmin.login(m.profileId, m.email, m.password); return; }
      if (m.type === 'garmin-mfa') { garmin.mfa(m.profileId, m.code); return; }
      // The profile's sync and upload stop first and keep nothing, so no token of the old login comes back.
      if (m.type === 'garmin-disconnect') { garminSync.stop(m.profileId); uploader.stop(m.profileId); workouts.stop(m.profileId); garmin.disconnect(m.profileId); try { coach.garminDisconnected(m.profileId); } catch { /* unknown profile */ } publish(); return; }
      if (m.type.startsWith('gym-')) { handleGym(m, send); return; }
      if (m.type.startsWith('meals-')) { handleMeals(m, atMs); return; }
      // Local writes only, also with a ride open: no AI, no Hevy, no Garmin.
      if (m.type === 'mobility-done') { mobility.markDone(m.profileId, m.sessionId); publish(); return; }
      if (m.type === 'mobility-feel') { mobility.feel(m.profileId, m.text); publish(); return; }
      coach.scanRides(coached());
      if (m.type === 'subscribe') { const v = view(m.profileId); if (v) send(v); }
      if (m.type === 'feedback') { coach.feedback(m.profileId, m.rideId, m.rating); if (noOpenRide()) refresh(m.profileId); }
      if (m.type === 'skip-feedback') { coach.skipFeedback(m.profileId); if (noOpenRide()) refresh(m.profileId); }
      if (m.type === 'note') { coach.note(m.profileId, m.text); if (noOpenRide()) refresh(m.profileId); }
      if (m.type === 'complaint-update') { coach.updateComplaint(m.profileId, m.id, m.status, atMs); if (noOpenRide()) refresh(m.profileId); }
      if (m.type === 'answer-question') { coach.answerQuestion(m.profileId, m.questionId, m.text); if (noOpenRide()) refresh(m.profileId); }
      if (m.type === 'skip-question') coach.skipQuestion(m.profileId);
      if (m.type === 'debrief-seen') coach.debriefSeen(m.profileId);
      if (m.type === 'garmin-upload-settings') coach.setUploadMode(m.profileId, m.mode === 'off' ? 'off' : 'ask');
      if (m.type === 'garmin-upload') startUpload(m.profileId, m.rideId, m.repoLink === true);
      if (m.type === 'debrief-answer') { coach.answerDebrief(m.profileId, m.rideId, m.question, m.text); if (noOpenRide()) refresh(m.profileId); }
      if (m.type === 'debrief-skip-question') coach.skipDebriefQuestion(m.profileId, m.rideId, m.question);
      if (m.type === 'remove-motive') { coach.removeMotive(m.profileId, m.atMs); if (noOpenRide()) refresh(m.profileId); }
      if (m.type === 'set-ftp' && m.ftpW >= 50) { coach.setFtp(m.profileId, m.ftpW); if (noOpenRide()) refresh(m.profileId); }
      if (m.type === 'adjust') coach.adjustNext(m.profileId, m.how);
      if (m.type === 'skip-ramp') coach.skipRamp(m.profileId);
      if (m.type === 'ride-detail') {
        const detail = coach.rideDetail(m.profileId, m.rideId);
        if (detail) send({ type: 'ride-detail', detail });
      }
      if (m.type === 'word-result') coach.wordResult(m.profileId, m.nl, m.knew);
      if (m.type === 'pass-select') coach.passSelect(m.profileId, m.passId);
      if (m.type === 'pass-progress') coach.passProgress(m.profileId, m.passId, m.distanceM);
      if (m.type === 'pass-summit') coach.passSummit(m.profileId, m.passId);
      publish();
    } catch { /* ignore invalid message */ }
  };

  // The weekly overview by email: Sunday evening, only with an address and the switch on. Never disturbs the coaches.
  const weeklyMailer = opts.mail ? new WeeklyMailer({ mail: opts.mail, file: path.join(coachDir, 'chat', 'mail-sent.json'), nowMs, ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}) }) : null;
  const weeklyMailOf = (id: string) => (): WeeklyMailBase => {
    const now = nowMs();
    const monday = addDays(mondayOf(dateKey(now)), 7);
    const rec = records.all(id, 'stats').find((x) => x.id === STATS_ID && !x.deleted);
    const stats = rec ? readStats(rec.body) : null;
    const week = statsView(stats, [], now).thisWeek;
    return {
      profileName: profiles().find((p) => p.id === id)?.name ?? '',
      monday,
      lastWeek: { sessions: weekSessions(stats, week), minutes: weekMinutes(week) },
      nextWeek: planOfWeek(records.all(id, 'weekplan'), monday)?.days ?? null,
      notes: stats?.changes ?? [],
      openProposals: openProposals(chatThread(records.all(id, 'chat')), records.all(id, 'weekplan'), records.all(id, 'change'), records.all(id, 'rule'), mondayOf(dateKey(now))).length,
    };
  };

  const scan = (): void => {
    try {
      const all = profiles();
      // Coach runs only for the profiles coached here; records sync for all.
      const list = all.filter((p) => coachHere(p.id));
      coach.scanRides(list);
      const free = noOpenRide();
      // Scan-driven runs only: a message still gets its answer when they pause.
      const runs = free && scheduled();
      const now = nowMs();
      for (const p of list) {
        const s = coach.state(p.id);
        if (runs && !coach.isThinking(p.id)) void coach.ensureDebrief(p.id).catch(() => {}).finally(publish);
        if (!runs || !s.dirty || coach.isThinking(p.id)) continue;
        const waited = now - (s.dirtySinceMs ?? now) >= waitMs;
        if (s.awaitingFeedback && !waited) continue;
        if (s.lastError && s.lastAttemptMs && now - s.lastAttemptMs < RETRY_MS) continue;
        refresh(p.id);
      }
      // Separate safeguard: Hevy must never disturb the coach run or a ride, and waits while a heavy run goes.
      const syncs = runs && !heavyBusy();
      if (syncs) void hevy.tick(list.map((p) => p.id), noOpenRide).catch(() => {}).finally(publish);
      // Separate safeguard: the gym coach must never disturb the bike coach or a ride, and runs with no ride open only.
      // Unknown exercise titles are then classified once; the answer is stored and applied by code, never by AI later. Written to this profile, the mirror copies it.
      if (runs) for (const p of list) { try { void gym.tick(p.id).catch(() => {}).then(() => exerciseMapper.run(p.id)).then((wrote) => { if (wrote) mealsChanged([p.id]); }).catch(() => {}).finally(publish); } catch { /* try again on the next run */ } }
      // Separate safeguard: the run coach must never disturb a ride or the other coaches, and plans with no ride open only.
      if (runs) for (const p of list) { try { void run.tick(p.id).catch(() => {}).finally(publish); } catch { /* try again on the next run */ } }
      // Separate safeguard: the meal plan must never disturb a ride or the coach. It plans only with no ride open.
      // A shared meal plan is ticked by its owner.
      if (ownCoach && scheduled() && mealsHere()) void ownCoach.tick().catch(() => {}).finally(publish);
      // One exercise catalog for every profile on this store: mirrored on every scan (cheap, idempotent, the first scan covers the start). Touches no workout.
      if (free) mealsChanged(mirrorExercises(records, all.map((p) => p.id)));
      // The together page for linked accounts: written only when it changes, never with a ride open. Never throws.
      if (free) mealsChanged(exportTogether({ store: records, profileIds: list.map((p) => p.id), linked: (id) => opts.links.status(id).state === 'linked', noOpenRide, nowMs: now, together: opts.together }));
      for (const p of list) { try { if (planSeen.changed(p.id, weekPlanKey(records.all(p.id, 'weekplan')))) { coach.weekPlanChanged(p.id); gym.weekPlanChanged(p.id); } } catch { /* next scan */ } }
      for (const p of list) { try { if (personalSeen.changed(p.id, personalKey(p.id))) { coach.weekPlanChanged(p.id); gym.weekPlanChanged(p.id); } } catch { /* next scan */ } }
      // A task of the rider or a removal of any task (also from another Mac) makes the bike and gym coach plan again, like a rule change.
      for (const p of list) { try { if (taskSeen.changed(p.id, `${tasks.version(p.id, 'bike')}|${tasks.version(p.id, 'gym')}`, true)) { coach.weekPlanChanged(p.id); gym.weekPlanChanged(p.id); } } catch { /* next scan */ } }
      for (const p of list) { try { if ((adviceKey(adviceOf(p.id)) !== '' && adviceSeen.changed(p.id, `${adviceKey(adviceOf(p.id))}|g${gymLegsKeyOf(records, p.id, dateKey(nowMs()), gymDoneDates(p.id))}`, true))) { coach.weekPlanChanged(p.id); gym.weekPlanChanged(p.id); } } catch { /* next scan */ } }
      // Never with a ride open (a ride becomes an activity only once it is closed), and only while coaches may plan.
      if (runs) for (const p of list) {
        try {
          const fresh = activitySeen.check(p.id, activitiesOf(p.id), now);
          if (fresh.length === 0) continue;
          coach.activityAdded(p.id); gym.activityAdded(p.id);
          weekReviews.set(p.id, [...(weekReviews.get(p.id) ?? []), ...fresh.map(activityData)]);
        } catch { /* next scan */ }
      }
      // The accepted week plan is never changed: the chat proposes the updated week, the rider takes it or keeps the old one.
      if (runs) for (const [id, acts] of weekReviews) {
        if (!list.some((p) => p.id === id)) { weekReviews.delete(id); continue; }
        void chat.reviewWeek(id, acts).then((r) => { if (r === 'done' && weekReviews.get(id) === acts) weekReviews.delete(id); if (r === 'done') mealsChanged([id]); }).catch(() => {}).finally(publish);
      }
      if (free && scheduled()) for (const p of list) {
        try {
          const due = duePrompts({ id: p.id, records: { prefs: records.all(p.id, 'coachprefs'), weekplan: records.all(p.id, 'weekplan') }, nowMs: now, sent: sentPrompts, detail: (s) => detailOf(p.id, s) });
          if (due.evening) { chat.say(p.id, due.evening); mealsChanged([p.id]); }
          if (due.week && now - (weekTried.get(p.id) ?? 0) >= WEEK_RETRY_MS) {
            weekTried.set(p.id, now);
            const monday = mondayOf(dateKey(now));
            void chat.openWeek(p.id).then((wrote) => { if (wrote) { sentPrompts.mark(p.id, 'week', monday); mealsChanged([p.id]); } }).catch(() => {}).finally(publish);
          }
        } catch { /* next scan */ }
      }
      // Chat answers: a message gets its answer even while scheduled runs pause. Never with a ride open.
      if (free) for (const p of list) { try { void chat.tick(p.id).then((wrote) => { if (wrote) mealsChanged([p.id]); }).catch(() => {}).finally(publish); } catch { /* next scan */ } }
      // Separate safeguard: a mail problem never reaches the coach loop; the mailer catches and logs once.
      if (weeklyMailer) for (const p of list) { try { void weeklyMailer.tick(p.id, contactOfProfile(records, p.id), weeklyMailOf(p.id)).catch(() => {}); } catch { /* next scan */ } }
      // The stats record for every profile coached here, linked or not: written only when it changes, never with a ride open. Never throws.
      if (free) mealsChanged(exportStats({ store: records, profileIds: list.map((p) => p.id), coachHere, noOpenRide, nowMs: now, content: statsDue }));
      // The health record and the weekly note on it: only on change and once per week, never with a ride open. Never throws.
      if (free) {
        mealsChanged(exportHealthNow(list.map((p) => p.id)));
        for (const p of list) { try { const body = healthContent(p.id); if (body) void healthText.tick(p.id, body).then((wrote) => { if (wrote) mealsChanged(exportHealthNow([p.id])); }).catch(() => {}); } catch { /* next scan */ } }
      }
      // All recent activities from every source for the web, only on change, never with a ride open. Never throws.
      if (free) mealsChanged(exportActivities({ store: records, profileIds: list.map((p) => p.id), coachHere, noOpenRide, nowMs: now, content: (id) => { try { return activityItems(activitiesOf(id), garminData(id)?.activities ?? []); } catch { return null; } } }));
      // A one-off task is done once its sport has a session after it. Never throws.
      if (free) for (const p of list) {
        try {
          const sessions = activitiesOf(p.id).flatMap((a) => { const k = kindOf(a); const sport: CoachId | null = k === 'kraft' ? 'gym' : k === 'rad' ? 'bike' : k === 'lauf' ? 'run' : null; return sport ? [{ sport, startMs: a.startMs }] : []; });
          tasks.settle(p.id, sessions, now);
        } catch { /* next scan */ }
      }
      // The bike plan and the counted rides for the web, only on change, never with a ride open. Never throws.
      if (free) mealsChanged(exportBike({ store: records, profileIds: list.map((p) => p.id), coachHere, noOpenRide, nowMs: now, state: (id) => { try { return coach.state(id); } catch { return null; } }, samples: (rideId) => cleanSamples(readRide(dir, rideId).samples).samples }));
      // Separate safeguard: the account sync must never disturb a ride or the coach, and is not awaited here.
      for (const p of all) { try { void accountSync.tick(p.id).finally(publish); } catch { /* try again on the next run */ } }
      // Separate safeguard: the fetch must never disturb the coach run.
      if (scheduled() && !heavyBusy()) for (const p of list) { try { garminSync.tick(p.id); } catch { /* try again on the next run */ } }
      publish();
    } catch (e) {
      console.error('Coach-Lauf fehlgeschlagen', errorKind(e));
    }
  };

  return {
    handle, view, scan,
    rideReplaced: (profileId, rideId) => {
      try {
        if (!coachHere(profileId)) return;
        coach.scanRides(coached()); // loads the profile's state
        coach.reprocessRide(profileId, rideId);
      } catch { /* the next scan reads what it can */ }
    },
    onChange: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    notify: (profileId) => notifyRecords(profileId),
    coachState: (profileId) => { if (!known(profileId) || !coachHere(profileId)) return null; try { return coach.state(profileId); } catch { return null; } },
    mealsView: (profileId) => (known(profileId) ? mealsOf(profileId) : null),
    together: () => opts.together(),
    profileIds: () => profiles().map((p) => p.id),
    trainingDays: (profileId) => (known(profileId) ? trainingDays(profileId) : []),
    records, accountSync,
  };
};
