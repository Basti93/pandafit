import path from 'node:path';
import { createLogger } from '../../shared/node/log';
import type { Profile } from '../../shared/profiles';
import { readRide } from '../../ride-format/read';
import { cleanSamples } from '../metrics';
import { GarminDb } from '../garmin-db';
import { readinessFrom } from '../readiness';
import { errorKind } from '../error-kind';
import { dateKey } from '../day-load';
import { activityData } from '../activity-feed';
import { type CoachId } from '../coach-tasks';
import { exportStats } from '../tracking/stats-export';
import { exportBike } from '../tracking/bike-export';
import { daysOf, weeksOf } from '../health/aggregate';
import { findingsOf } from '../health/findings';
import { CoachTexts, HealthCoachText } from '../health/coach-text';
import { exportHealth } from '../health/health-export';
import { DayCoachText, DayTexts, type DayInput as DayTextInput } from '../day-text';
import { doneToday, exportDayText } from '../day-text-export';
import { activityItems, exportActivities, kindOf } from '../activities-export';
import { mirrorExercises } from '../tracking/mirror-exercises';
import { gymLegsKeyOf } from '../tracking/frame';
import { PlanSeen, adviceKey, weekPlanKey } from '../chat/plan-seen';
import { duePrompts, SentPrompts } from '../chat/prompts';
import { pushAskDue, sportsKeyOf, startReview } from '../chat/month-review';
import { goalOfProfile } from '../tracking/personal';
import { addDays, mondayOf, planFor, planOfWeek } from '../../shared/week-plan';
import { runView } from '../../tracking/ui/run-view';
import { readStats, STATS_ID } from '../../shared/stats';
import type { HealthBody } from '../../shared/health';
import { exportTogether } from '../tracking/together-export';
import { WeeklyMailer, type WeeklyMailBase } from '../weekly-mail';
import { contactOfProfile } from '../tracking/contact';
import { weekMinutes, weekSessions } from '../../tracking/stats';
import { statsView } from '../../tracking/stats-node';
import { chatThread, prefsOf } from '../../shared/chat';
import { openProposals } from '../../tracking/ui/chat-open';
import type { RuntimeCtx } from './ctx';
import { STATS_EVERY_MS } from './ctx';

const log = createLogger('runtime');
const RETRY_MS = 30 * 60_000;
/** The health record reads 52 weeks of Garmin days. */
const HEALTH_DAYS_BACK = 370;
export type ScanRun = {
  /** Every profile of the runtime. */
  all: Profile[];
  /** The profiles coached here. */
  list: Profile[];
  /** No ride is open. */
  free: boolean;
  /** Scan-driven runs may start: no ride open and scheduling on. A message still gets its answer when they pause. */
  runs: boolean;
  now: number;
};
export type ScanStep = { name: string; run(s: ScanRun): void };

/** The scan: a list of steps in a fixed order. Each step has its own try/catch: one failing step never stops the others. */
export const createScan = (ctx: RuntimeCtx): (() => void) => {
  const { opts, profiles, coachHere, noOpenRide, scheduled, heavyBusy, nowMs, waitMs, ask, dir, coachDir, garminDir, publish, refresh, mealsChanged,
    records, coach, gym, run, chat, tasks, exerciseMapper, hevy, garminSync, accountSync, ownCoach, mealsHere, activitySeen, personalKey, adviceOf,
    gymDoneDates, activitiesOf, statsDue, garminData } = ctx;

  // A newly taken week plan makes the bike and gym coach plan again (the run coach sees it in its own key).
  const planSeen = new PlanSeen(path.join(coachDir, 'chat', 'plan-seen.json'));
  // A change of the person's rules or goal makes the coaches plan again, like a new week plan. No records: no key, no replan.
  const personalSeen = new PlanSeen(path.join(coachDir, 'chat', 'personal-seen.json'));
  const taskSeen = new PlanSeen(path.join(coachDir, 'chat', 'task-seen.json'));
  // Today's advice changing (a new day, tired legs, a raised pulse) makes the coaches plan again, at most about once a day. The first sighting only counts.
  const adviceSeen = new PlanSeen(path.join(coachDir, 'chat', 'advice-seen.json'));
  // The week conversation and the evening suggestion, only when the rider switched them on.
  const sentPrompts = new SentPrompts(path.join(coachDir, 'chat', 'prompts-sent.json'));
  /** The week conversation is tried at most this often while it fails. */
  const WEEK_RETRY_MS = 30 * 60_000;
  const weekTried = new Map<string, number>();
  /** The monthly review waits as long between failed tries; only a written review is marked as sent. */
  const reviewTried = new Map<string, number>();
  const detailOf = (id: string, sport: string): string | null => {
    if (sport === 'gym') return gym.state(id).next?.workout.name ?? null;
    if (sport === 'bike') return coach.state(id).next?.session.name ?? null;
    if (sport === 'run') { const r = runView(records.all(id, 'run'), nowMs() + 86_400_000).week?.runs.find((x) => x.date === dateKey(nowMs() + 86_400_000)); return r ? `${r.minutes} Minuten` : null; }
    return null;
  };
  /** New activities waiting for the chat's look at this week's plan. Only in memory: a restart skips one look. */
  const weekReviews = new Map<string, object[]>();
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
  const dayTexts = new DayTexts(path.join(coachDir, 'day', 'texts.json'));
  const dayText = new DayCoachText({ texts: dayTexts, nowMs, ask });
  const exportDayTextNow = (profileIds: string[]): string[] =>
    exportDayText({ store: records, profileIds, coachHere, noOpenRide, nowMs: nowMs(), entry: (id) => dayTexts.get(id) });
  /** What the day sentence is made from: today's finished trainings, the last four weeks, the week plan, motives, the health note and open complaints. */
  /** Reading every activity on each scan is costly: the day sentence looks at most once a minute per profile. */
  const DAY_LOOK_EVERY_MS = 60_000;
  const dayLooked = new Map<string, number>();
  const dayInputOf = (id: string, now: number): DayTextInput => {
    const date = dateKey(now);
    const sessions = activitiesOf(id);
    const complaints = (coach.state(id).complaints ?? []).filter((c) => c.status !== 'over');
    const findings = healthContent(id)?.findings ?? [];
    const plan = records.all(id, 'weekplan');
    const week = planOfWeek(plan, mondayOf(date))?.days.map((d) => ({ datum: d.date, sport: d.sport, haerte: d.hardness })) ?? null;
    const heute = planFor(plan, date);
    const since = now - 28 * 86_400_000;
    const data = {
      aktivitaeten: sessions.filter((a) => a.startMs >= since && a.startMs <= now).sort((a, b) => a.startMs - b.startMs)
        .map((a) => ({ tag: dateKey(a.startMs), art: kindOf(a), titel: a.title, minuten: Math.round(a.minutes) })),
      woche: week, planHeute: heute ? { sport: heute.sport, haerte: heute.hardness } : null,
      beweggruende: (coach.state(id).motives ?? []).map((m) => m.text),
      gesundheit: healthTexts.get(id)?.text ?? null,
      beschwerden: complaints.map((c) => c.text),
    };
    return { date, done: doneToday(sessions, now), data, caution: complaints.length > 0 || findings.some((f) => f.tone === 'arzt') };
  };
  /** Without any data the web shows the saying; no AI call is spent on it. */
  const dayHasData = (i: DayTextInput): boolean => i.done.length > 0 || Object.values(i.data).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null));
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

  const steps: ScanStep[] = [
    {
      name: 'coach-runs',
      run: ({ list, runs, now }) => {
      for (const p of list) {
        const s = coach.state(p.id);
        if (runs && !coach.isThinking(p.id)) void coach.ensureDebrief(p.id).catch((e) => log.error('coach debrief', e)).finally(publish);
        if (!runs || !s.dirty || coach.isThinking(p.id)) continue;
        const waited = now - (s.dirtySinceMs ?? now) >= waitMs;
        if (s.awaitingFeedback && !waited) continue;
        if (s.lastError && s.lastAttemptMs && now - s.lastAttemptMs < RETRY_MS) continue;
        refresh(p.id);
      }
      },
    },
    {
      name: 'hevy',
      run: ({ list, runs }) => {
      // Separate safeguard: Hevy must never disturb the coach run or a ride, and waits while a heavy run goes.
      const syncs = runs && !heavyBusy();
      if (syncs) void hevy.tick(list.map((p) => p.id), noOpenRide).catch((e) => log.error('hevy tick', e)).finally(publish);
      },
    },
    {
      name: 'gym',
      run: ({ list, runs }) => {
      // Separate safeguard: the gym coach must never disturb the bike coach or a ride, and runs with no ride open only.
      // Unknown exercise titles are then classified once; the answer is stored and applied by code, never by AI later. Written to this profile, the mirror copies it.
      if (runs) for (const p of list) { try { void gym.tick(p.id).catch((e) => log.error('gym tick', e)).then(() => exerciseMapper.run(p.id)).then((wrote) => { if (wrote) mealsChanged([p.id]); }).catch((e) => log.error('gym tick (step 2)', e)).finally(publish); } catch { /* try again on the next run */ } }
      },
    },
    {
      name: 'run',
      run: ({ list, runs }) => {
      // Separate safeguard: the run coach must never disturb a ride or the other coaches, and plans with no ride open only.
      if (runs) for (const p of list) { try { void run.tick(p.id).catch((e) => log.error('run tick', e)).finally(publish); } catch { /* try again on the next run */ } }
      },
    },
    {
      name: 'meals',
      run: () => {
      // Separate safeguard: the meal plan must never disturb a ride or the coach. It plans only with no ride open.
      // A shared meal plan is ticked by its owner.
      if (ownCoach && scheduled() && mealsHere()) void ownCoach.tick().catch((e) => log.error('own coach tick', e)).finally(publish);
      },
    },
    {
      name: 'mirror-exercises',
      run: ({ all, free }) => {
      // One exercise catalog for every profile on this store: mirrored on every scan (cheap, idempotent, the first scan covers the start). Touches no workout.
      if (free) mealsChanged(mirrorExercises(records, all.map((p) => p.id)));
      },
    },
    {
      name: 'together',
      run: ({ list, free, now }) => {
      // The together page for linked accounts: written only when it changes, never with a ride open. Never throws.
      if (free) mealsChanged(exportTogether({ store: records, profileIds: list.map((p) => p.id), linked: (id) => opts.links.status(id).state === 'linked', noOpenRide, nowMs: now, together: opts.together }));
      },
    },
    {
      name: 'plan-seen',
      run: ({ list }) => {
      for (const p of list) { try { if (planSeen.changed(p.id, weekPlanKey(records.all(p.id, 'weekplan')))) { coach.weekPlanChanged(p.id); gym.weekPlanChanged(p.id); } } catch { /* next scan */ } }
      },
    },
    {
      name: 'personal-seen',
      run: ({ list }) => {
      for (const p of list) { try { if (personalSeen.changed(p.id, personalKey(p.id))) { coach.weekPlanChanged(p.id); gym.weekPlanChanged(p.id); } } catch { /* next scan */ } }
      },
    },
    {
      name: 'task-seen',
      run: ({ list }) => {
      // A task of the rider or a removal of any task (also from another Mac) makes the bike and gym coach plan again, like a rule change.
      for (const p of list) { try { if (taskSeen.changed(p.id, `${tasks.version(p.id, 'bike')}|${tasks.version(p.id, 'gym')}`, true)) { coach.weekPlanChanged(p.id); gym.weekPlanChanged(p.id); } } catch { /* next scan */ } }
      },
    },
    {
      name: 'advice-seen',
      run: ({ list }) => {
      for (const p of list) { try { if ((adviceKey(adviceOf(p.id)) !== '' && adviceSeen.changed(p.id, `${adviceKey(adviceOf(p.id))}|g${gymLegsKeyOf(records, p.id, dateKey(nowMs()), gymDoneDates(p.id))}`, true))) { coach.weekPlanChanged(p.id); gym.weekPlanChanged(p.id); } } catch { /* next scan */ } }
      },
    },
    {
      name: 'activities-seen',
      run: ({ list, runs, now }) => {
      // Never with a ride open (a ride becomes an activity only once it is closed), and only while coaches may plan.
      if (runs) for (const p of list) {
        try {
          const fresh = activitySeen.check(p.id, activitiesOf(p.id), now);
          if (fresh.length === 0) continue;
          coach.activityAdded(p.id); gym.activityAdded(p.id);
          weekReviews.set(p.id, [...(weekReviews.get(p.id) ?? []), ...fresh.map(activityData)]);
        } catch { /* next scan */ }
      }
      },
    },
    {
      name: 'week-review',
      run: ({ list, runs }) => {
      // The accepted week plan is never changed: the chat proposes the updated week, the rider takes it or keeps the old one.
      if (runs) for (const [id, acts] of weekReviews) {
        if (!list.some((p) => p.id === id)) { weekReviews.delete(id); continue; }
        void chat.reviewWeek(id, acts).then((r) => { if (r === 'done' && weekReviews.get(id) === acts) weekReviews.delete(id); if (r === 'done') mealsChanged([id]); }).catch((e) => log.error('chat week review', e)).finally(publish);
      }
      },
    },
    {
      name: 'prompts',
      run: ({ list, free, now }) => {
      if (free && scheduled()) for (const p of list) {
        try {
          const due = duePrompts({ id: p.id, records: { prefs: records.all(p.id, 'coachprefs'), weekplan: records.all(p.id, 'weekplan') }, nowMs: now, sent: sentPrompts, detail: (s) => detailOf(p.id, s) });
          if (due.evening) { chat.say(p.id, due.evening); mealsChanged([p.id]); }
          // The review goes first and the week conversation waits for a later scan, so it sees the review in the thread.
          const tried = startReview({
            id: p.id, prefs: prefsOf(records.all(p.id, 'coachprefs')), sportsKey: sportsKeyOf(goalOfProfile(records, p.id, dateKey(now))),
            gymDates: gymDoneDates(p.id), sent: sentPrompts, nowMs: now, tried: reviewTried, retryMs: WEEK_RETRY_MS, open: (id, reason, askPush) => chat.openReview(id, reason, askPush),
          });
          if (tried) void tried.then((wrote) => { if (wrote) mealsChanged([p.id]); }).catch((e) => log.error('chat month review', e)).finally(publish);
          if (due.week && !tried && now - (weekTried.get(p.id) ?? 0) >= WEEK_RETRY_MS) {
            weekTried.set(p.id, now);
            const monday = mondayOf(dateKey(now));
            void chat.openWeek(p.id).then((wrote) => { if (wrote) { sentPrompts.mark(p.id, 'week', monday); mealsChanged([p.id]); } }).catch((e) => log.error('chat open week', e)).finally(publish);
          } else if (!tried && !due.week && !due.evening) {
            // The push question comes alone: never in the same scan as the review, the week conversation or the evening message.
            const s = coach.state(p.id);
            if (pushAskDue({ goal: goalOfProfile(records, p.id, dateKey(now)), complaints: s.complaints ?? [], gymDates: gymDoneDates(p.id), sent: sentPrompts.get(p.id), ...(s.lastQuestionMs !== undefined ? { lastQuestionMs: s.lastQuestionMs } : {}), nowMs: now })) {
              chat.askPush(p.id);
              sentPrompts.mark(p.id, 'pushAsk', dateKey(now));
              coach.questionAsked(p.id);
              mealsChanged([p.id]);
            }
          }
        } catch { /* next scan */ }
      }
      },
    },
    {
      name: 'chat',
      run: ({ list, free }) => {
      // Chat answers: a message gets its answer even while scheduled runs pause. Never with a ride open.
      if (free) for (const p of list) { try { void chat.tick(p.id).then((wrote) => { if (wrote) mealsChanged([p.id]); }).catch((e) => log.error('chat tick', e)).finally(publish); } catch { /* next scan */ } }
      },
    },
    {
      name: 'weekly-mail',
      run: ({ list }) => {
      // Separate safeguard: a mail problem never reaches the coach loop; the mailer catches and logs once.
      if (weeklyMailer) for (const p of list) { try { void weeklyMailer.tick(p.id, contactOfProfile(records, p.id), weeklyMailOf(p.id)).catch((e) => log.error('weekly mail tick', e)); } catch { /* next scan */ } }
      },
    },
    {
      name: 'stats',
      run: ({ list, free, now }) => {
      // The stats record for every profile coached here, linked or not: written only when it changes, never with a ride open. Never throws.
      if (free) mealsChanged(exportStats({ store: records, profileIds: list.map((p) => p.id), coachHere, noOpenRide, nowMs: now, content: statsDue }));
      },
    },
    {
      name: 'health',
      run: ({ list, free }) => {
      // The health record and the weekly note on it: only on change and once per week, never with a ride open. Never throws.
      if (free) {
        mealsChanged(exportHealthNow(list.map((p) => p.id)));
        for (const p of list) { try { const body = healthContent(p.id); if (body) void healthText.tick(p.id, body).then((wrote) => { if (wrote) mealsChanged(exportHealthNow([p.id])); }).catch((e) => log.error('health text tick', e)); } catch { /* next scan */ } }
      }
      },
    },
    {
      name: 'day-text',
      run: ({ list, free, now }) => {
      // The coach sentence of the day, renewed after each finished training: only on change, at most four AI calls a day, never with a ride open or in quiet hours (`scheduled()`). Never throws.
      if (free) {
        mealsChanged(exportDayTextNow(list.map((p) => p.id)));
        if (scheduled()) for (const p of list) { try { if (!coachHere(p.id)) continue; const last = dayLooked.get(p.id); if (last !== undefined && now - last < DAY_LOOK_EVERY_MS && now >= last) continue; dayLooked.set(p.id, now); const input = dayInputOf(p.id, now); if (dayHasData(input)) void dayText.tick(p.id, input).then((wrote) => { if (wrote) mealsChanged(exportDayTextNow([p.id])); }).catch((e) => log.error('day look', e)); } catch { /* next scan */ } }
      }
      },
    },
    {
      name: 'activities-export',
      run: ({ list, free, now }) => {
      // All recent activities from every source for the web, only on change, never with a ride open. Never throws.
      if (free) mealsChanged(exportActivities({ store: records, profileIds: list.map((p) => p.id), coachHere, noOpenRide, nowMs: now, content: (id) => { try { return activityItems(activitiesOf(id), garminData(id)?.activities ?? []); } catch { return null; } } }));
      },
    },
    {
      name: 'tasks-settle',
      run: ({ list, free, now }) => {
      // A one-off task is done once its sport has a session after it. Never throws.
      if (free) for (const p of list) {
        try {
          const sessions = activitiesOf(p.id).flatMap((a) => { const k = kindOf(a); const sport: CoachId | null = k === 'kraft' ? 'gym' : k === 'rad' ? 'bike' : k === 'lauf' ? 'run' : null; return sport ? [{ sport, startMs: a.startMs }] : []; });
          tasks.settle(p.id, sessions, now);
        } catch { /* next scan */ }
      }
      },
    },
    {
      name: 'bike-export',
      run: ({ list, free, now }) => {
      // The bike plan and the counted rides for the web, only on change, never with a ride open. Never throws.
      if (free) mealsChanged(exportBike({ store: records, profileIds: list.map((p) => p.id), coachHere, noOpenRide, nowMs: now, state: (id) => { try { return coach.state(id); } catch { return null; } }, samples: (rideId) => cleanSamples(readRide(dir, rideId).samples).samples }));
      },
    },
    {
      name: 'account-sync',
      run: ({ all }) => {
      // Separate safeguard: the account sync must never disturb a ride or the coach, and is not awaited here.
      for (const p of all) { try { void accountSync.tick(p.id).finally(publish); } catch { /* try again on the next run */ } }
      },
    },
    {
      name: 'garmin-sync',
      run: ({ list }) => {
      // Separate safeguard: the fetch must never disturb the coach run.
      if (scheduled() && !heavyBusy()) for (const p of list) { try { garminSync.tick(p.id); } catch { /* try again on the next run */ } }
      },
    },
  ];

  return () => {
    try {
      const all = profiles();
      // Coach runs only for the profiles coached here; records sync for all.
      const list = all.filter((p) => coachHere(p.id));
      coach.scanRides(list);
      const free = noOpenRide();
      const runs = free && scheduled();
      const s: ScanRun = { all, list, free, runs, now: nowMs() };
      for (const step of steps) {
        try { step.run(s); } catch (e) { log.error(`scan step ${step.name}`, e); }
      }
      publish();
    } catch (e) {
      console.error('Coach-Lauf fehlgeschlagen', errorKind(e));
    }
  };
};
