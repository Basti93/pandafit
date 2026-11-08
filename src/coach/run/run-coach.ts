import { ClaudeError } from '../claude-client';
import { crossSportCut, rateRun, type DayHardness, type DayRating } from '../day-load';
import type { GarminDb } from '../garmin-db';
import type { TrainingWeek } from '../all-training';
import type { Complaint } from '../motivation';
import type { RecordStore } from '../tracking/store';
import type { Profile } from '../../shared/profiles';
import type { TrackedRecord } from '../../shared/records';
import { addWeeks, dateKey, dateOf, dayIndex, weekOf } from '../../shared/meals';
import {
  readRunBody, runFp, runIdType, runReviewId, runSendId, runWeekId, weekFp, RUN_SETTINGS_ID, RUN_STATUS_ID,
  type PlannedRun, type RunBody, type RunFeel, type RunGarmin, type RunReviewBody, type RunSettingsBody, type RunStatusBody, type RunWeekBody,
} from '../../shared/run';
import { runCard } from './card';
import { RUN_REGION, runComplaintMode, type ComplaintMode } from './complaints';
import { garminRuns, type Run } from './garmin-runs';
import { checkRunWeek, type RunCheck } from './guardrails';
import type { WorkoutOps, WorkoutResult } from './garmin-workouts';
import { TEST_EVERY_DAYS, TEST_MAIN_MIN, TEST_WARM_MIN } from './limits';
import { bandFor, capFor, easyPaceAt, maxHrOf, runNumbers, suggestedDays } from './numbers';
import { buildRunPrompt, RUN_SYSTEM_PROMPT, runAnswerJsonSchema } from './prompt';
import { personalHint } from '../tracking/personal';
import { addNote, type ChangeNote } from '../../shared/change-notes';
import { feelHold, HOLD_REASON, phaseOf, ruleWeek, weekDates, type RuleWeek } from './rules';
import { manualRuns, mergeRuns } from './runs';
import { loadRunCache, saveRunCache, type RunCache } from './state';
import { readTasks, type GivenTask, type CoachId } from '../coach-tasks';

const DAY = 86_400_000;
const RETRY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
/** One window for every Garmin read: the pace cache is pruned by it, so it must never change between calls. */
const WINDOW_DAYS = 120;
/** Runs in the last 8 weeks suggest switching running on. */
const SUGGEST_DAYS = 56;
/** The statistics look back this far (9 weeks fit in it). */
const STATS_DAYS = 70;
/** The card shows the newest run of the last week. */
const CARD_DAYS = 7;
/** Reviews are caught up for at most this many finished weeks. */
const REVIEW_WEEKS = 4;
/** On Sunday from this hour the coming week is planned. */
const ANNOUNCE_HOUR = 18;
/** Warm-up and cool-down of an easy or long run: a sixth of it each, at most 5 minutes. */
const EDGE_MAX_S = 300;
/** Every workout we send carries it, so ours can be found again when their ids were lost. */
const WORKOUT_PREFIX = 'Pandafit · ';
const WORKOUT_NAMES: Record<PlannedRun['kind'], string> = { easy: 'Lauf ruhig', long: 'Langer Lauf', test: 'Testlauf 30 Minuten' };
const NO_GARMIN_SENT: RunGarmin = { status: 'none', reason: null, confirmedMs: null, sent: {} };

type Ask = (input: { prompt: string; systemPrompt: string; schema: object }) => Promise<unknown>;
export type RunDeps = {
  dir: string; store: RecordStore; nowMs: () => number; ask: Ask; noOpenRide: () => boolean;
  /** The accepted week plan as prompt text, or ''. */
  planHint?: (id: string) => string;
  /** Changes when the rider takes a new week plan; part of what makes a week plan again. */
  planKey?: (id: string, week: string) => string;
  /** Hands a task from this coach to another one. */
  giveTask?: (id: string, task: GivenTask) => void;
  profile: (id: string) => Profile | null;
  garminDb: (id: string) => Pick<GarminDb, 'runs' | 'activityFile' | 'body'> | null;
  days: (id: string, dates: string[]) => Record<string, DayRating>;
  weeks: (id: string) => TrainingWeek[];
  complaints: (id: string) => Complaint[];
  sleepS?: (id: string, date: string) => number | null;
  garmin: (id: string) => { connected: boolean; capable: boolean };
  /** Starts sending to Garmin; false when it cannot start now (ride open, busy). The result comes back through `sendResult`. */
  sendWorkouts?: (id: string, week: string, ops: WorkoutOps) => boolean;
  /** Records were written for this profile. */
  onExport?: (id: string) => void;
};

type Own = { rec: TrackedRecord; body: RunBody };
type Target = { week: string; fromDate: string; announce: boolean };
type Ctx = {
  id: string; now: number; today: string; runs: Run[]; settings: RunSettingsBody; settingsMs: number; weekdays: number[];
  maxHr: number | null; mode: ComplaintMode; complaints: Complaint[]; weeks: Map<string, RunWeekBody>;
  /** The last runs with a feeling were hard: the plan does not grow. */
  hold: boolean;
};

/** The feelings the rider gave, by run id. A skipped question is null. */
const feelsOf = (own: Map<string, Own>): Map<string, RunFeel | null> => {
  const out = new Map<string, RunFeel | null>();
  for (const o of own.values()) if (o.body.type === 'feel') out.set(o.body.runId, o.body.feel);
  return out;
};
const startMsOf = (date: string): number => { const d = dateOf(date, 0); d.setHours(0, 0, 0, 0); return d.getTime(); };
const shift = (date: string, n: number): string => dateKey(dateOf(date, n));
const dateOfMs = (ms: number): string => dateKey(new Date(ms));
const round1 = (x: number): number => Math.round(x * 10) / 10;
/** A body as compared for a rewrite: the time it was made does not count. */
const sameBody = (a: unknown, b: unknown): boolean => JSON.stringify({ ...(a as object), atMs: 0 }) === JSON.stringify({ ...(b as object), atMs: 0 });

/**
 * The run coach. It reads runs (Garmin and manual), writes the profile's `status`, `week-*` and `review-*` records, and
 * asks Claude only within the guardrails. Runs with no ride open only; without settings and without Garmin it writes nothing.
 */
export class RunCoach {
  private caches = new Map<string, RunCache>();
  private running = new Map<string, Promise<void>>();
  private lastRuns = new Map<string, Run[]>();
  /** Checked answers that came back while a ride opened, per profile and week. */
  private held = new Map<string, { key: string; checked: RunCheck; retried: boolean }>();
  /** Sends under way, per profile and week: the fingerprint of each date as it was sent. */
  private pending = new Map<string, { atMs: number; fps: Record<string, string> }>();

  constructor(private deps: RunDeps) {}

  isThinking(id: string): boolean { return this.running.has(id); }
  /** The runs of the last tick, also while running is off. For mobility after a run. */
  runs(id: string): Run[] { return this.lastRuns.get(id) ?? []; }

  /**
   * Garmin and manual runs of the last 70 days, each once, rated with the planned kind of its date when a week record has one.
   * For the statistics: reads only the run list, no activity files, and writes nothing. Also with running switched off.
   */
  runsFor(id: string): { startMs: number; durationS: number; hardness: DayHardness }[] {
    const now = this.deps.nowMs();
    const fromMs = now - STATS_DAYS * DAY;
    const db = this.deps.garminDb(id);
    const fromGarmin: Run[] = db
      ? db.runs(fromMs).map((r) => ({ ...r, source: 'garmin', hasHr: r.avgHr !== null, easyPace: null, best30M: null, tempC: null }))
      : [];
    const runs = mergeRuns(fromGarmin, manualRuns(this.deps.store.all(id, 'run'), null)).filter((r) => r.startMs >= fromMs && r.startMs <= now);
    const planned = new Map<string, PlannedRun['kind']>();
    for (const [recId, o] of this.own(id)) {
      if (o.body.type !== 'week' || recId !== runWeekId(o.body.week)) continue;
      for (const p of o.body.runs) planned.set(p.date, p.kind);
    }
    return runs.map((r) => ({ startMs: r.startMs, durationS: r.durationS, hardness: rateRun({ durationS: r.durationS, planned: planned.get(dateOfMs(r.startMs)) ?? null }) }));
  }

  tick(id: string): Promise<void> {
    const active = this.running.get(id);
    if (active) return active;
    const run: Promise<void> = this.plan(id).finally(() => { if (this.running.get(id) === run) this.running.delete(id); });
    this.running.set(id, run);
    return run;
  }

  private cache(id: string): RunCache {
    let c = this.caches.get(id);
    if (!c) { c = loadRunCache(this.deps.dir, id); this.caches.set(id, c); }
    return c;
  }
  private saveCache(id: string): void { saveRunCache(this.deps.dir, this.cache(id)); }

  /** Run records whose id and body type agree; anything else is ignored. */
  private own(id: string): Map<string, Own> {
    const out = new Map<string, Own>();
    for (const rec of this.deps.store.all(id, 'run')) {
      if (rec.deleted) continue;
      const body = readRunBody(rec.body);
      if (body && runIdType(rec.id) === body.type) out.set(rec.id, { rec, body });
    }
    return out;
  }
  private stored(id: string, recId: string): TrackedRecord | undefined {
    return this.deps.store.all(id, 'run').find((r) => r.id === recId);
  }
  private put(id: string, records: TrackedRecord[]): void {
    if (records.length === 0) return;
    this.deps.store.putMany(id, records);
    try { this.deps.onExport?.(id); } catch { /* a listener never stops the coach */ }
  }
  /** Written only when the body changed, always newer than the stored version. */
  private write(id: string, recId: string, body: RunBody | null, now: number): void {
    const old = this.stored(id, recId);
    if (body === null ? !old || old.deleted : old && !old.deleted && sameBody(old.body, body)) return;
    this.put(id, [{ kind: 'run', id: recId, updatedMs: Math.max(now, (old?.updatedMs ?? 0) + 1), deleted: body === null, body }]);
  }

  private async plan(id: string): Promise<void> {
    if (!this.deps.noOpenRide()) return;
    const profile = this.deps.profile(id);
    if (!profile) return;
    const now = this.deps.nowMs();
    const own = this.own(id);
    const settingsOwn = own.get(RUN_SETTINGS_ID);
    const settings = settingsOwn?.body.type === 'settings' ? settingsOwn.body : null;
    const db = this.deps.garminDb(id);
    if (!settings && !db) {
      this.lastRuns.delete(id);
      this.write(id, RUN_STATUS_ID, null, now);
      return;
    }
    const cache = this.cache(id);
    const on = settings?.on === true;
    if (on && cache.onSinceMs === null) cache.onSinceMs = Math.min(now, settingsOwn!.rec.updatedMs);
    if (!on) cache.onSinceMs = null;

    // One read for the highest heart rate, then the runs with the band it gives.
    const fromMs = now - WINDOW_DAYS * DAY;
    const seen = db ? [db.body()?.maxHrSeen ?? null, ...db.runs(fromMs).map((r) => r.maxHr)].filter((x): x is number => x !== null && Number.isFinite(x)) : [];
    const maxHr = maxHrOf(seen.length > 0 ? Math.max(...seen) : null, [], profile);
    const band = bandFor(maxHr);
    const fromGarmin = db ? garminRuns(db, fromMs, band, cache.paceCache) : [];
    const runs = mergeRuns(fromGarmin, manualRuns(this.deps.store.all(id, 'run'), band)).filter((r) => r.startMs <= now);
    this.saveCache(id);
    this.lastRuns.set(id, runs);
    const complaints = this.deps.complaints(id);
    const mode = runComplaintMode(complaints, now);

    if (on && settings) {
      const weeks = new Map<string, RunWeekBody>();
      for (const [recId, o] of own) if (o.body.type === 'week' && recId === runWeekId(o.body.week)) weeks.set(o.body.week, o.body);
      const today = dateOfMs(now);
      const current = weekOf(now);
      const ctx: Ctx = {
        id, now, today, runs, settings, settingsMs: settingsOwn!.rec.updatedMs, weekdays: settings.weekdays ?? suggestedDays(runs, now),
        maxHr, mode, complaints, weeks, hold: feelHold(runs, feelsOf(own), now),
      };
      // A run already done today keeps today as it is: the replan starts tomorrow.
      const ranToday = runs.some((r) => dateOfMs(r.startMs) === today);
      const targets: Target[] = [{ week: current, fromDate: ranToday ? shift(today, 1) : today, announce: false }];
      const d = new Date(now);
      if (dayIndex(now) === 6 && d.getHours() >= ANNOUNCE_HOUR) targets.push({ week: addWeeks(current, 1), fromDate: addWeeks(current, 1), announce: true });
      // The week before only gets its runs matched (a Sunday-night run is read on Monday).
      this.matchDone(ctx, addWeeks(current, -1));
      for (const t of targets) {
        await this.planWeek(ctx, t);
        // Nothing more is written once a ride opened during the Claude call.
        if (!this.deps.noOpenRide()) return;
        this.syncGarmin(ctx, t.week);
      }
      for (let k = REVIEW_WEEKS; k >= 1; k--) this.review(ctx, addWeeks(current, -k));
    }

    const recentGarmin = fromGarmin.some((r) => r.startMs > now - SUGGEST_DAYS * DAY && r.startMs <= now);
    const suggest = settings === null && recentGarmin;
    this.write(id, RUN_STATUS_ID, on || suggest ? this.status(id, on, suggest, settings, runs, maxHr, mode, now) : null, now);
  }

  private status(id: string, on: boolean, suggest: boolean, settings: RunSettingsBody | null, runs: Run[], maxHr: number | null, mode: ComplaintMode, now: number): RunStatusBody {
    const weeks = [...this.own(id).values()].flatMap((o) => (o.body.type === 'week' ? [o.body] : []));
    const newest = runs.filter((r) => r.startMs > now - CARD_DAYS * DAY).sort((a, b) => b.startMs - a.startMs)[0];
    let card: RunStatusBody['card'] = null;
    if (on && newest) {
      const date = dateOfMs(newest.startMs);
      const planned = weeks.flatMap((w) => w.runs).find((r) => r.date === date) ?? null;
      const before = shift(date, -1);
      card = runCard(newest, planned, {
        trendNow: easyPaceAt(runs.filter((r) => r.id !== newest.id), newest.startMs),
        dayBefore: this.deps.days(id, [before])[before] ?? null,
        sleepS: this.deps.sleepS?.(id, date) ?? null,
      });
    }
    const recent = runs.some((r) => r.startMs > now - SUGGEST_DAYS * DAY);
    const link = this.deps.garmin(id);
    return {
      type: 'status', atMs: now, on, suggest, needsAnswers: on && settings?.answers === null && !recent,
      garmin: link.connected && link.capable && !!this.deps.sendWorkouts,
      suggestedDays: suggestedDays(runs, now), hrCap: capFor(maxHr), complaint: mode, numbers: runNumbers(runs, weeks, now), card,
    };
  }

  /** The id of the run on a date: the longest one that day. */
  private doneOn(runs: Run[], date: string): string | null {
    const onDay = runs.filter((r) => dateOfMs(r.startMs) === date).sort((a, b) => b.durationS - a.durationS);
    return onDay[0]?.id ?? null;
  }

  private matchDone(ctx: Ctx, week: string): void {
    const w = ctx.weeks.get(week);
    if (!w) return;
    const body: RunWeekBody = { ...w, runs: w.runs.map((r) => ({ ...r, done: this.doneOn(ctx.runs, r.date) })), garmin: this.garminOf(ctx.id, week, w.garmin) };
    this.write(ctx.id, runWeekId(week), body, ctx.now);
    ctx.weeks.set(week, body);
  }

  private async planWeek(ctx: Ctx, t: Target): Promise<void> {
    const { id, now } = ctx;
    const cache = this.cache(id);
    const existing = ctx.weeks.get(t.week) ?? null;
    const missed = (existing?.runs ?? []).filter((r) => r.date < ctx.today && this.doneOn(ctx.runs, r.date) === null).map((r) => r.date);
    const key = JSON.stringify([ctx.settingsMs, ctx.weekdays, ctx.mode, missed, ctx.settings.answers, ctx.hold, ...(this.deps.planKey ? [this.deps.planKey(id, t.week)] : [])]);
    const dates = Array.from({ length: 9 }, (_, i) => dateKey(dateOf(t.week, i - 1)));
    const days = this.deps.days(id, dates);
    const ratings = Object.fromEntries(dates.map((d) => [d, `${days[d]?.hardness ?? '-'}${days[d]?.legs ? ' legs' : ''}`]));
    // A bike or gym plan that changed a day still ahead replans, so a test or long run leaves a day that became hard.
    // Days that have passed do not count: what was actually ridden there never moves the rest of the week.
    const madeWith = cache.planDays[t.week];
    const daysChanged = madeWith !== undefined && dates.some((d) => d >= t.fromDate && madeWith[d] !== undefined && madeWith[d] !== ratings[d]);
    if (existing && cache.planKey[t.week] === key && !daysChanged) {
      if (!madeWith) { cache.planDays[t.week] = ratings; this.saveCache(id); }
      this.matchDone(ctx, t.week);
      return;
    }
    cache.planDays = Object.fromEntries([...Object.entries(cache.planDays).filter(([w]) => w >= addWeeks(t.week, -2)), [t.week, ratings]]);

    const allowedDates = weekDates(t.week).filter((d, i) => ctx.weekdays.includes(i) && d >= t.fromDate);
    const rule = ruleWeek({
      nowMs: now, week: t.week, fromDate: t.fromDate, runs: ctx.runs, weekdays: ctx.weekdays, answers: ctx.settings.answers, maxHr: ctx.maxHr,
      complaint: ctx.mode, days, crossCut: (m) => crossSportCut(this.deps.weeks(id), m),
      lastTestMs: this.lastTestMs(ctx, t.fromDate), dueAtMs: Math.max(now, startMsOf(t.fromDate)), phase: phaseOf(ctx.runs, this.complaintWeeks(ctx), now), restartSince: this.restartSince(ctx),
      longDates: this.longDatesBefore(ctx, t.fromDate), hold: ctx.hold,
    });
    this.noteChanges(id, t.week, rule, now);
    const save = (planned: PlannedRun[], source: 'rules' | 'claude', reason: string, note: string | null): void => {
      const body = this.weekBody(ctx, t, existing, rule, planned, source, reason, note);
      this.write(id, runWeekId(t.week), body, now);
      ctx.weeks.set(t.week, body);
    };
    const settle = (): void => { cache.planKey[t.week] = key; cache.attempts = 0; this.saveCache(id); };

    // The rule plan stands first, so a missing or slow Claude never leaves the week empty.
    save(rule.runs, 'rules', rule.reason, null);
    const heldKey = `${id}|${t.week}`;
    const held = this.held.get(heldKey);
    this.held.delete(heldKey);
    if (rule.runs.length === 0) { settle(); return; }
    const resumed = held && held.key === key ? held : null;
    if (!resumed) {
      if (cache.attempts >= MAX_ATTEMPTS) { settle(); return; }
      if (cache.attempts > 0 && cache.lastAttemptMs !== null && now - cache.lastAttemptMs < RETRY_MS) return;
      cache.attempts += 1;
      cache.lastAttemptMs = now;
      this.saveCache(id);
    }

    const numbers = runNumbers(ctx.runs, [...ctx.weeks.values()], now);
    const ask = async (rejection?: string): Promise<unknown> => {
      const raw = await this.deps.ask({
        prompt: buildRunPrompt({ rule, runs: ctx.runs, numbers, complaint: ctx.mode, days, nowMs: now, allowedDates, ...(rejection ? { rejection } : {}) }) + (this.deps.planHint?.(id) ?? '') + personalHint(this.deps.store, id, 'run', dateKey(new Date(now))),
        systemPrompt: RUN_SYSTEM_PROMPT, schema: runAnswerJsonSchema,
      });
      // Tasks for the other coaches; never in the way of the run plan.
      try { for (const t of readTasks((raw as { tasks?: unknown } | null)?.tasks)) this.deps.giveTask?.(id, t); } catch { /* a task is a bonus */ }
      return raw;
    };
    // A ride that opened while Claude was thinking: the answer is held and written after the ride, without asking again.
    const rideOpened = (checked: RunCheck, retried: boolean): boolean => {
      if (this.deps.noOpenRide()) return false;
      this.held.set(heldKey, { key, checked, retried });
      return true;
    };
    try {
      let checked = resumed ? resumed.checked : checkRunWeek(await ask(), rule, allowedDates, days);
      if (!resumed && rideOpened(checked, false)) return;
      if (!checked.ok && !resumed?.retried) {
        // Exactly one second attempt with the reason; after that the rule plan stands.
        try { checked = checkRunWeek(await ask(checked.reason), rule, allowedDates, days); } catch { /* the first answer decides */ }
        if (rideOpened(checked, true)) return;
      }
      if (checked.ok) save(checked.runs, 'claude', checked.reason, checked.note);
      cache.lastError = checked.ok ? null : 'invalid';
      settle();
    } catch (e) {
      cache.lastError = e instanceof ClaudeError ? e.kind : 'failed';
      this.saveCache(id);
    }
  }

  /** A phase change, a light week or a test week gets one note, replaced when the same week is planned again. */
  private noteChanges(id: string, week: string, rule: RuleWeek, now: number): void {
    try {
      const cache = this.cache(id);
      const before = JSON.stringify(cache.changeNotes);
      const was = cache.lastPhase;
      const put = (key: string, text: string, reason: string): void => { cache.changeNotes = addNote(cache.changeNotes, { atMs: now, coach: 'run', text, reason, key }, now); };
      if (cache.lastPhase !== null && cache.lastPhase !== rule.phase) {
        put(`phase:${rule.phase}`, `Lauf: Phase ${rule.phase}`, rule.phase === 2 ? 'drei Läufe pro Woche in 4 von 5 Wochen' : 'nach einer Pause oder mit Beschwerden zurück zu ruhigen Läufen');
      }
      cache.lastPhase = rule.phase;
      if (rule.light && rule.runs.length > 0) put(`light:${week}`, 'Lauf: leichtere Woche', 'damit Erholung Platz hat');
      if (rule.held && rule.runs.length > 0) put(`hold:${week}`, 'Lauf: Woche bleibt gleich', HOLD_REASON);
      if (rule.testDate !== null) put(`test:${week}`, 'Lauf: Testlauf in dieser Woche', 'als Messpunkt für deinen Fortschritt');
      if (JSON.stringify(cache.changeNotes) !== before || was !== rule.phase) this.saveCache(id);
    } catch { /* a note is a bonus */ }
  }
  /** What the run coach changed, newest last. */
  changeNotes(id: string): ChangeNote[] { return this.cache(id).changeNotes.map(({ key: _k, ...n }) => n); }

  private weekBody(ctx: Ctx, t: Target, existing: RunWeekBody | null, rule: RuleWeek, planned: PlannedRun[], source: 'rules' | 'claude', reason: string, note: string | null): RunWeekBody {
    // Past dates stay as they were; only the open days take the new plan.
    const past = (existing?.runs ?? []).filter((r) => r.date < t.fromDate).map((r) => ({ ...r, done: this.doneOn(ctx.runs, r.date) }));
    const fresh = planned.filter((r) => r.date >= t.fromDate).map((r) => ({ ...r, fp: runFp(r), done: this.doneOn(ctx.runs, r.date) }));
    const runs = [...past, ...fresh].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return {
      type: 'week', week: t.week, announce: existing?.announce ?? t.announce, atMs: ctx.now, phase: rule.phase, source, reason, note, runs,
      garmin: this.garminAfter(this.garminOf(ctx.id, t.week, existing?.garmin ?? null), runs),
    };
  }

  /** A run already sent whose plan changed needs a new confirmation: nothing is sent, the week says so. */
  private garminAfter(g: RunGarmin | null, runs: { date: string; fp: string }[]): RunGarmin | null {
    if (!g) return null;
    const changed = Object.entries(g.sent).some(([date, s]) => runs.find((r) => r.date === date)?.fp !== s.fp);
    return changed ? { ...g, status: 'changed' } : g;
  }

  /** The Garmin part as stored now: a send result may have arrived while a plan was being made. */
  private garminOf(id: string, week: string, fallback: RunGarmin | null): RunGarmin | null {
    const rec = this.stored(id, runWeekId(week));
    const body = rec && !rec.deleted ? readRunBody(rec.body) : null;
    return body?.type === 'week' ? body.garmin : fallback;
  }

  /**
   * Offers sending only with a Garmin login and a library that can do it. A `send-<week>` record newer than the last one handled
   * sends once, and only when its fingerprint is the current plan's. Called with no ride open only.
   */
  private syncGarmin(ctx: Ctx, week: string): void {
    const w = ctx.weeks.get(week);
    if (!w) return;
    const { id } = ctx;
    const key = `${id}|${week}`;
    const { connected, capable } = this.deps.garmin(id);
    let g = this.garminAfter(this.garminOf(id, week, w.garmin), w.runs);
    if (!connected || !capable || !this.deps.sendWorkouts) {
      // Nothing is offered. Ids already sent stay, so a later send can still remove them.
      g = g && Object.keys(g.sent).length > 0 ? g : null;
    } else {
      g = g ?? NO_GARMIN_SENT;
      // A send cut off by a restart never reports back.
      if (g.status === 'sending' && !this.pending.has(key)) g = { ...g, status: 'failed', reason: 'failed' };
      const send = this.own(id).get(runSendId(week))?.body;
      if (send?.type === 'send' && send.week === week && send.atMs > (g.confirmedMs ?? -1) && !this.pending.has(key)) {
        if (send.fp !== weekFp(w.runs)) {
          g = { ...g, status: 'stale', reason: null, confirmedMs: send.atMs };
        } else {
          const ops = this.opsFor(ctx, w, g);
          if (ops.delete.length + ops.create.length === 0) {
            g = { ...g, status: 'sent', reason: null, confirmedMs: send.atMs };
          } else {
            this.pending.set(key, { atMs: send.atMs, fps: Object.fromEntries(w.runs.map((r) => [r.date, r.fp])) });
            const started = this.deps.sendWorkouts(id, week, ops);
            if (!this.pending.has(key)) {
              // The result came at once (a login that does not open) and is written already.
              const fresh = this.garminOf(id, week, null);
              ctx.weeks.set(week, { ...w, garmin: fresh });
              return;
            }
            // Not started (a ride opened, or still busy): the confirmation stays for the next tick.
            if (started) g = { ...g, status: 'sending', reason: null, confirmedMs: send.atMs };
            else this.pending.delete(key);
          }
        }
      }
    }
    const body: RunWeekBody = { ...w, garmin: g };
    this.write(id, runWeekId(week), body, ctx.now);
    ctx.weeks.set(week, body);
  }

  /**
   * From today on (tomorrow once today's run is done): new dates are created, changed ones deleted and created again, dates no
   * longer planned deleted. Earlier dates are never touched.
   */
  private opsFor(ctx: Ctx, w: RunWeekBody, g: RunGarmin): WorkoutOps {
    const band = bandFor(ctx.maxHr);
    const from = this.doneOn(ctx.runs, ctx.today) !== null ? shift(ctx.today, 1) : ctx.today;
    const planned = w.runs.filter((r) => r.date >= from);
    const del: WorkoutOps['delete'] = [];
    for (const [date, s] of Object.entries(g.sent)) {
      if (date < from) continue;
      if (planned.find((r) => r.date === date)?.fp !== s.fp) del.push({ workoutId: s.workoutId, scheduleId: s.scheduleId });
    }
    const create: WorkoutOps['create'] = [];
    for (const r of planned) {
      if (g.sent[r.date]?.fp === r.fp) continue;
      const total = r.minutes * 60;
      let warmupS: number;
      let mainS: number;
      let cooldownS: number;
      if (r.kind === 'test') {
        warmupS = TEST_WARM_MIN * 60;
        mainS = TEST_MAIN_MIN * 60;
        cooldownS = Math.max(0, total - warmupS - mainS);
      } else {
        warmupS = cooldownS = Math.min(EDGE_MAX_S, Math.round(total / 6));
        mainS = total - warmupS - cooldownS;
      }
      // A heart-rate range only with a known max heart rate, and never for a test run.
      const hr = r.kind !== 'test' && band !== null && r.hrCap !== null && r.hrCap >= band.fromBpm;
      create.push({ date: r.date, name: `${WORKOUT_PREFIX}${WORKOUT_NAMES[r.kind]}`, warmupS, mainS, cooldownS, hrLow: hr ? band!.fromBpm : null, hrHigh: hr ? r.hrCap : null });
    }
    const deleted = new Set(del.map((d) => d.workoutId));
    const keep = Object.values(g.sent).map((s) => s.workoutId).filter((id) => !deleted.has(id));
    return { delete: del, create, sweep: { from, to: weekDates(w.week)[6]!, prefix: WORKOUT_PREFIX, keep } };
  }

  /** What the bridge did: deleted ids leave `sent`, created ones join it, also after a failure part way. */
  sendResult(id: string, week: string, r: WorkoutResult): void {
    const key = `${id}|${week}`;
    const p = this.pending.get(key);
    this.pending.delete(key);
    const rec = this.stored(id, runWeekId(week));
    const body = rec && !rec.deleted ? readRunBody(rec.body) : null;
    if (body?.type !== 'week') return;
    const g0 = body.garmin ?? NO_GARMIN_SENT;
    const sent = Object.fromEntries(Object.entries(g0.sent).filter(([, s]) => !r.deleted.includes(s.workoutId)));
    for (const c of r.created) {
      sent[c.date] = { workoutId: c.workoutId, scheduleId: c.scheduleId, fp: p?.fps[c.date] ?? body.runs.find((x) => x.date === c.date)?.fp ?? '' };
    }
    const g = this.garminAfter({
      status: r.status === 'ok' ? 'sent' : 'failed', reason: r.status === 'ok' ? null : r.reason ?? 'failed', confirmedMs: p?.atMs ?? g0.confirmedMs, sent,
    }, body.runs);
    this.write(id, runWeekId(week), { ...body, garmin: g }, this.deps.nowMs());
  }

  /** Long runs planned before `fromDate` in any stored week, among them last week's. */
  private longDatesBefore(ctx: Ctx, fromDate: string): string[] {
    return [...ctx.weeks.values()].flatMap((w) => w.runs).filter((r) => r.kind === 'long' && r.date < fromDate).map((r) => r.date);
  }

  /** The later of the last planned test date before `fromDate` (done or skipped) and the switch-on time. */
  private lastTestMs(ctx: Ctx, fromDate: string): number | null {
    const tests = [...ctx.weeks.values()].flatMap((w) => w.runs).filter((r) => r.kind === 'test' && r.date < fromDate).map((r) => startMsOf(r.date));
    const all = [...tests, ...(this.cache(ctx.id).onSinceMs !== null ? [this.cache(ctx.id).onSinceMs!] : [])];
    return all.length > 0 ? Math.max(...all) : null;
  }

  /**
   * The local date the newest run complaint closed, for the 28 days after it: no test in that time, and the ramp counts from
   * that week on. The restart mode itself lasts only its first 7 days.
   */
  private restartSince(ctx: Ctx): string | null {
    const closed = ctx.complaints.filter((c) => c.status === 'over' && RUN_REGION.test(c.text) && ctx.now - c.updatedMs < TEST_EVERY_DAYS * DAY);
    return closed.length > 0 ? dateOfMs(Math.max(...closed.map((c) => c.updatedMs))) : null;
  }

  /** Weeks with a run complaint: an active one up to now, an older one up to its last change. */
  private complaintWeeks(ctx: Ctx): Set<string> {
    const out = new Set<string>();
    for (const c of ctx.complaints) {
      if (!RUN_REGION.test(c.text)) continue;
      const end = c.status === 'active' ? ctx.now : c.updatedMs;
      for (let w = weekOf(c.startedMs); w <= weekOf(end); w = addWeeks(w, 1)) out.add(w);
    }
    return out;
  }

  /** Once per finished week that had a plan: what happened, and the focus of the coming week. */
  private review(ctx: Ctx, week: string): void {
    const cache = this.cache(ctx.id);
    const plan = ctx.weeks.get(week);
    if (!plan || cache.reviewed.includes(week)) return;
    const recId = runReviewId(week);
    if (!this.stored(ctx.id, recId)) {
      const endMs = startMsOf(addWeeks(week, 1)) - 1;
      const inWeek = ctx.runs.filter((r) => weekOf(r.startMs) === week);
      const longest = inWeek.filter((r) => r.distanceM !== null).map((r) => r.distanceM!);
      const pace = easyPaceAt(ctx.runs, endMs);
      const test = plan.runs.find((r) => r.kind === 'test' && r.done !== null);
      const testRun = test ? inWeek.find((r) => r.id === test.done) : undefined;
      const body: RunReviewBody = {
        type: 'review', week, atMs: ctx.now,
        km: round1(inWeek.reduce((a, r) => a + (r.distanceM ?? 0), 0) / 1000),
        minutes: Math.round(inWeek.reduce((a, r) => a + r.durationS, 0) / 60),
        plannedMinutes: plan.runs.reduce((a, r) => a + r.minutes, 0),
        runs: inWeek.length,
        longestKm: longest.length > 0 ? round1(Math.max(...longest) / 1000) : null,
        easyPace: pace === null ? null : { now: pace, weeks4: easyPaceAt(ctx.runs, endMs - 28 * DAY) },
        testM: testRun?.best30M ?? null,
        focus: focusText(ctx.mode, phaseOf(ctx.runs, this.complaintWeeks(ctx), ctx.now).phase, ctx.hold),
      };
      this.write(ctx.id, recId, body, ctx.now);
    }
    cache.reviewed = [...cache.reviewed, week].slice(-20);
    this.saveCache(ctx.id);
  }
}

/** The coming week's focus, calm and without pressure. */
export const focusText = (mode: ComplaintMode, phase: 1 | 2, hold = false): string => {
  if (mode === 'pause') return 'Nächste Woche ruht das Laufen. Sobald es wieder passt, geht es sanft weiter.';
  if (mode !== null) return 'Nächste Woche bleibt der Plan sanft, mit halber Zeit.';
  if (hold) return `Nächste Woche bleibt der Plan, wie er ist, ${HOLD_REASON}.`;
  if (phase === 1) return 'Nächste Woche gibt es ruhige Läufe, und die Zeit auf den Beinen wächst behutsam.';
  return 'Nächste Woche wächst der lange Lauf Schritt für Schritt, die anderen Läufe bleiben ruhig.';
};
