import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../../shared/node/log';
import type { Profile } from '../../shared/profiles';
import type { CoachStateMessage } from '../protocol';
import { suggestProfile } from '../../shared/garmin-profile';
import { Coach } from '../coach';
import { GarminLink } from '../garmin';
import { GarminDb } from '../garmin-db';
import { readinessFrom, restingHrRaised, type GarminCoachData } from '../readiness';
import { GarminSync } from '../garmin-sync';
import { HevyLinks } from '../hevy';
import { canUpload } from '../garmin-upload';
import { activityName, REPO_DESCRIPTION } from '../../shared/garmin-upload';
import { GarminUploader } from '../garmin-uploader';
import { mergeCatalog } from '../../shared/catalog';
import { EXERCISES } from '../../shared/exercises';
import { FEDB_EXERCISES } from '../../shared/fedb';
import { ExerciseMapper } from '../gym/exercise-mapper';
import { GymCoach } from '../gym/gym-coach';
import type { StrengthHealth } from '../strength';
import { HevyRoutines } from '../gym/hevy-routines';
import { gymPublic } from '../gym/public';
import { RecordStore } from '../tracking/store';
import { goalOfProfile } from '../tracking/personal';
import { personalKeyOf } from '../../shared/personal';
import { MobilityCoach, muscleOf } from '../mobility/mobility';
import { GarminWorkouts } from '../run/garmin-workouts';
import { RunCoach } from '../run/run-coach';
import { dateKey, dayRatings, type DayRating } from '../day-load';
import { allTraining } from '../all-training';
import { activitiesHint, allActivities, ActivitySeen, doneByDate } from '../activity-feed';
import { manualRuns } from '../run/runs';
import { CoachTasks, type GivenTask, type TaskFrom } from '../coach-tasks';
import { statsContent } from '../stats/stats-content';
import { radForChat } from '../tracking/bike-export';
import { ChatCoach } from '../chat/chat-coach';
import { planHint, type TodayContext } from '../chat/plan-hint';
import { frameOfProfile, gymPlanDateOf, gymPlanDayNoLegs } from '../tracking/frame';
import { longTermHint } from '../chat/long-term';
import { weekPlanKey } from '../chat/plan-seen';
import { addDays, planFor, type Sport } from '../../shared/week-plan';
import { runView } from '../../tracking/ui/run-view';
import { newestNotes, type ChangeNote } from '../../shared/change-notes';
import { type NextStep, type PublishedAdvice, type StatsBody } from '../../shared/stats';
import { todayAdvice } from '../../shared/today';
import { AccountSync } from '../tracking/mac-sync';
import { mergedHealth, mergedStrength } from '../tracking/strength-source';
import { MealCoach, usualTrainingDays } from '../meals/meal-coach';
import { plainTokens } from '../secrets/garmin-tokens';
import { createHandle } from './handlers';
import { createScan } from './scan';
import { STATS_EVERY_MS, type RuntimeCtx } from './ctx';
import type { RuntimeOptions, CoachRuntime } from './types';
export type { RuntimeOptions, CoachRuntime } from './types';

const log = createLogger('runtime');
const GARMIN_CACHE_MS = 5 * 60_000;
const GARMIN_DAYS = 60;

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
  const personalKey = (id: string): string => personalKeyOf(records.all(id, 'rule'), records.all(id, 'goal'), records.all(id, 'frame'), dateKey(nowMs()), records.all(id, 'change'));
  // The coach chat: answers the rider's messages of the profiles coached here, never with a ride open.
  const chat = new ChatCoach({
    store: records, ask, nowMs, newId: () => randomUUID(), catalog: catalogOf,
    complaints: (id) => (coach.state(id).complaints ?? []).map((c) => ({ id: c.id, text: c.text, status: c.status })),
    addComplaint: (id, text) => coach.addComplaintFromText(id, text),
    endComplaint: (id, cid) => coach.updateComplaint(id, cid, 'over', nowMs()),
    healComplaint: (id, cid) => coach.updateComplaint(id, cid, 'healing', nowMs()),
    sessions: (id) => sessionsOf(id),
    giveTask: (id, t) => giveTask(id, 'chat', t),
    strengthFacts: (id) => gym.reviewFacts(id),
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
  /** When each profile's stats were last made: at most every five minutes, or at once on a new date. */
  const statsMade = new Map<string, { atMs: number; date: string }>();
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
    void coach.refresh(profileId).catch((e) => log.error('coach refresh', e)).finally(publish);
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

  const ctx: RuntimeCtx = {
    opts, profiles, noOpenRide, scheduled, heavyBusy, mealsHere, nowMs, waitMs, ask, dir, coachDir, garminDir,
    known, coachHere, coached, publish, notifyRecords, mealsChanged, refresh,
    records, coach, gym, run, mobility, chat, tasks, exerciseMapper, hevy, garmin, garminSync, uploader, workouts, accountSync,
    ownCoach, mealsNow, activitySeen, view, startUpload, garminData, activitiesOf, adviceOf, gymDoneDates, personalKey, statsDue,
  };

  return {
    handle: createHandle(ctx), view, scan: createScan(ctx),
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
