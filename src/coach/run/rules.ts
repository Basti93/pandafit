import type { DayRating } from '../day-load';
import { addWeeks, dateKey, dateOf, dayIndex, weekOf } from '../../shared/meals';
import type { PlannedRun, RunAnswers, RunFeel, RunKind } from '../../shared/run';
import type { ComplaintMode } from './complaints';
import type { Run } from './garmin-runs';
import { capFor, startPoint } from './numbers';
import {
  ANSWER_MAX_RUNS, ANSWER_RUN_MAX_MIN, ANSWER_START_MAX_MIN, DEFAULT_MIN, MAX_RUN_STEP, DEFAULT_RUNS, FEEL_HOLD_COUNT, FEEL_WINDOW_DAYS, GAP_DAYS, HALF, LIGHT_EVERY, LIGHT_FACTOR, LONG_MORE_MIN, LONG_MORE_SHARE, LONG_SHARE, LONG_STEP_MIN, MAX_RAMP, MAX_RUNS, MAX_RUN_MIN,
  MIN_RUN_MIN, PHASE2_OF, PHASE2_RUNS, PHASE2_WEEKS, TEST_COOL_MIN, TEST_EVERY_DAYS, TEST_LOAD, TEST_MAIN_MIN, TEST_WARM_MIN,
} from './limits';

const DAY = 86_400_000;
/** The ramp compares with the mean of this many complete weeks before the planned one. */
const BASE_WEEKS = 3;
const TEST_MIN = TEST_WARM_MIN + TEST_MAIN_MIN + TEST_COOL_MIN;

export type Phase = { phase: 1 | 2; since: string };
export type RuleInput = {
  nowMs: number; week: string; fromDate: string; runs: Run[]; weekdays: number[]; answers: RunAnswers | null; maxHr: number | null;
  complaint: ComplaintMode; days: Record<string, DayRating>; crossCut: (minutes: number) => number;
  /** The last test run, or the switch-on time when there was none yet (Task 8); null plans no test. */
  lastTestMs: number | null;
  phase: Phase;
  /** The date a closed run complaint restarted the plan, for 28 days after it: no test before then, and later weeks ramp from that week on. */
  restartSince: string | null;
  /** When a test counts as due; defaults to nowMs. A week planned ahead passes the start of its first open day. */
  dueAtMs?: number;
  /** Dates of long runs planned before this plan (the week before, earlier days of this week): no test the day after. */
  longDates?: string[];
  /** The last runs felt hard (see `feelHold`): the week keeps its time, its number of runs and its longest run. */
  hold?: boolean;
};
export type RuleWeek = { runs: PlannedRun[]; reason: string; phase: 1 | 2; totalMinutes: number; maxRunMinutes: number; testDate: string | null; light?: boolean; held?: boolean;
  /** The week's heart-rate cap for easy runs (null without a max heart rate), and whether the counts text mentions the trend. */
  hrCap: number | null; hasTrend: boolean };

/** The seven local dates of a week, Monday first. Built from noon, so a daylight-saving change cannot skip or repeat a date. */
export const weekDates = (week: string): string[] => Array.from({ length: 7 }, (_, i) => dateKey(dateOf(week, i)));

const shift = (date: string, days: number): string => dateKey(dateOf(date, days));
/** A run is long when it is at least 10 minutes or 20 % longer than the easy runs. */
export const isLongerThanEasy = (minutes: number, easy: number): boolean => minutes >= Math.min(easy + LONG_MORE_MIN, easy * (1 + LONG_MORE_SHARE));
const weekdayOf = (date: string): number => dayIndex(dateOf(date, 0).getTime());
/** Local midnight at the start of a date. */
const startMsOf = (date: string): number => {
  const d = dateOf(date, 0);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * Phase 1 ("wieder fit") until at least 3 runs a week in 4 of the last 5 complete weeks, with no active run complaint in a
 * week that counts; then phase 2 ("Distanz") from that Monday. 21 days without a run start phase 1 again, from that day.
 */
export const phaseOf = (runs: Run[], activeComplaintWeeks: Set<string>, nowMs: number): Phase => {
  const current = weekOf(nowMs);
  const times = runs.map((r) => r.startMs).filter((t) => t <= nowMs).sort((a, b) => a - b);
  if (times.length === 0) return { phase: 1, since: current };
  const perWeek = new Map<string, number>();
  for (const t of times) perWeek.set(weekOf(t), (perWeek.get(weekOf(t)) ?? 0) + 1);
  const counts = (w: string): boolean => (perWeek.get(w) ?? 0) >= PHASE2_RUNS && !activeComplaintWeeks.has(w);

  const gap = GAP_DAYS * DAY;
  const resets: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i]! - times[i - 1]! >= gap) resets.push(times[i - 1]! + gap);
  const last = times[times.length - 1]!;
  if (nowMs - last >= gap) resets.push(last + gap);

  let phase: 1 | 2 = 1;
  let since = weekOf(times[0]!);
  let next = 0;
  const applyResets = (untilMs: number): void => {
    for (; next < resets.length && resets[next]! <= untilMs; next++) {
      phase = 1;
      since = dateKey(new Date(resets[next]!));
    }
  };
  for (let w = addWeeks(weekOf(times[0]!), 1); w <= current; w = addWeeks(w, 1)) {
    applyResets(startMsOf(w));
    if (phase === 2) continue;
    let good = 0;
    for (let k = 1; k <= PHASE2_OF; k++) if (counts(addWeeks(w, -k))) good++;
    if (good >= PHASE2_WEEKS) {
      phase = 2;
      since = w;
    }
  }
  applyResets(nowMs);
  return { phase, since };
};

/** Every fourth week of a phase, counted from the week the phase began. */
const isLight = (week: string, since: string): boolean => {
  const idx = Math.round((dateOf(week, 0).getTime() - dateOf(weekOf(dateOf(since, 0).getTime()), 0).getTime()) / (7 * DAY));
  return idx >= 0 && idx % LIGHT_EVERY === LIGHT_EVERY - 1;
};

/** Which number counts today, said before the run. */
export const countsText = (kind: RunKind, minutes: number, hrCap: number | null, hasTrend: boolean): string => {
  if (kind === 'test') {
    return `Lauf dich ${TEST_WARM_MIN} Minuten ein. Dann läufst du ${TEST_MAIN_MIN} Minuten gleichmäßig zügig und ${TEST_COOL_MIN} Minuten locker aus. `
      + `Heute zählt die Strecke in den ${TEST_MAIN_MIN} Minuten.`;
  }
  const calm = hrCap !== null ? `mit Puls unter ${hrCap}` : 'so, dass du dich noch unterhalten kannst';
  const trend = hasTrend && hrCap !== null ? ' Über die Wochen zeigt sich dein Fortschritt im Tempo bei gleichem Puls.' : '';
  if (kind === 'long') return `Lauf ${minutes} Minuten lang und ruhig, ${calm}. Heute zählt die Zeit, nicht das Tempo.${trend}`;
  return `Lauf ${minutes} Minuten ruhig, ${calm}.${trend}`;
};

export const TEST_NOTE = 'Der Testlauf ist ein Angebot. Wenn du dich heute nicht frisch fühlst, lauf einfach ruhig.';

type Slot = { date: string; kind: RunKind; minutes: number };
const byDate = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/**
 * The week by rules alone, safe without Claude. In order: base, ramp, light week, complaint, cross-sport cut, then the
 * minutes are spread over the chosen weekdays from `fromDate` on.
 */
export const ruleWeek = (input: RuleInput): RuleWeek => {
  const { phase } = input.phase;
  const hold = input.hold === true;
  const chosen = weekDates(input.week).filter((d) => input.weekdays.includes(weekdayOf(d)));
  const open = chosen.filter((d) => d >= input.fromDate);

  // Base: the mean of the last complete weeks since the first run (and since a restart), else the answers, else 2 × 20.
  const past = input.runs.filter((r) => r.startMs <= input.nowMs);
  const firstRun = past.reduce<number | null>((m, r) => (m === null || r.startMs < m ? r.startMs : m), null);
  const restartWeek = input.restartSince !== null ? weekOf(startMsOf(input.restartSince)) : null;
  const fromWeek = [firstRun !== null ? weekOf(firstRun) : null, restartWeek !== null && restartWeek < input.week ? restartWeek : null]
    .reduce<string | null>((m, w) => (w !== null && (m === null || w > m) ? w : m), null);
  const baseWeeks = Array.from({ length: BASE_WEEKS }, (_, i) => addWeeks(input.week, i - BASE_WEEKS)).filter((w) => fromWeek === null || w >= fromWeek);
  const recent = past.filter((r) => baseWeeks.includes(weekOf(r.startMs)));
  const a = input.answers;
  const answered = a !== null && a.runsPerWeek > 0 && a.usualMinutes > 0;
  const startRuns = answered ? Math.min(a.runsPerWeek, ANSWER_MAX_RUNS) : DEFAULT_RUNS;
  const startMin = answered ? Math.min(a.usualMinutes, ANSWER_RUN_MAX_MIN) : DEFAULT_MIN;
  const start = Math.min(startRuns * startMin, ANSWER_START_MAX_MIN);
  let base: number | null = null;
  let total: number;
  let longest: number;
  let typical: number;
  let desired: number;
  if (recent.length > 0) {
    base = recent.reduce((s, r) => s + r.durationS / 60, 0) / Math.max(1, baseWeeks.length);
    // Ramp in whole minutes, rounded down (the epsilon keeps 100 × 1.1 at 110); a few short runs never plan less than a gentle start.
    total = Math.max(Math.floor(base * (hold ? 1 : 1 + MAX_RAMP) + 1e-9), Math.min(start, DEFAULT_RUNS * DEFAULT_MIN));
    longest = Math.max(...recent.map((r) => r.durationS / 60));
    const sorted = recent.map((r) => r.durationS / 60).sort((x, y) => x - y);
    typical = sorted[Math.floor((sorted.length - 1) / 2)]!;
    const lastWeek = addWeeks(input.week, -1);
    desired = Math.min(input.weekdays.length, Math.max(hold ? 1 : 0, past.filter((r) => weekOf(r.startMs) === lastWeek).length + (hold ? 0 : MAX_RUN_STEP)));
  } else {
    total = start;
    longest = startMin;
    typical = startMin;
    desired = startRuns;
  }

  const light = isLight(input.week, input.phase.since);
  if (light) total *= LIGHT_FACTOR;
  const mode: ComplaintMode = input.complaint ?? (a?.pain ? 'half' : null);
  if (mode === 'pause') total = 0;
  else if (mode !== null) total *= HALF;
  if (total > 0) total = Math.max(0, total - input.crossCut(total));
  const held = hold && base !== null && mode === null;
  const rising = !held && base !== null && total > base;
  // Switched on or replanned mid-week: only the share of the open days, so missed minutes never move to later days.
  if (chosen.length > 0) total *= open.length / chosen.length;

  // No run longer than 10 minutes over the longest recent one (none longer than it when the week is held).
  const cap = Math.min(MAX_RUN_MIN, Math.max(MIN_RUN_MIN, Math.floor(longest + (hold ? 0 : LONG_STEP_MIN))));
  // In phase 2 only the long run grows; a week without one keeps its runs at the usual recent length.
  const easyCap = phase === 2 ? Math.min(cap, Math.max(MIN_RUN_MIN, Math.floor(typical))) : cap;
  const hard = (d: string): number => (input.days[d]?.hardness === 'hard' ? 1 : 0);
  const afterLegs = (d: string): boolean => input.days[shift(d, -1)]?.legs === true;
  const prefer = (ds: string[]): string[] => [...ds].sort((x, y) => hard(x) - hard(y) || byDate(x, y));
  const n = Math.min(desired, open.length, MAX_RUNS, Math.floor(total / MIN_RUN_MIN));
  const picked = prefer(open).slice(0, n).sort(byDate);

  // Phase 2: the long run on the latest picked day that is not hard and not after legs; without one, no long run.
  const longDate = phase === 2 && picked.length >= 2 ? [...picked].reverse().find((d) => hard(d) === 0 && !afterLegs(d)) ?? null : null;

  // A test run: 28 days after the later of the last test and the start of the phase or restart; not in a light week, not
  // with a complaint or pain; on a fresh day that is neither the long-run day nor the day before; with room for one more run.
  const anchor = input.lastTestMs === null ? null
    : Math.max(input.lastTestMs, startMsOf(input.phase.since), input.restartSince !== null ? startMsOf(input.restartSince) : 0);
  const due = anchor !== null && (input.dueAtMs ?? input.nowMs) - anchor >= TEST_EVERY_DAYS * DAY;
  // A long run the day before, planned or run, leaves no fresh day either.
  const longDays = new Set([...(input.longDates ?? []), ...past.filter((r) => isLongerThanEasy(r.durationS / 60, typical)).map((r) => dateKey(new Date(r.startMs)))]);
  const fresh = (d: string): boolean => {
    const own = input.days[d]?.hardness ?? null;
    const before = input.days[shift(d, -1)];
    const after = input.days[shift(d, 1)];
    return (own === null || own === 'easy') && !before?.legs && before?.hardness !== 'hard' && after?.hardness !== 'hard' && !longDays.has(shift(d, -1));
  };
  let testDate: string | null = null;
  if (due && !light && mode === null && picked.length >= 2 && total >= TEST_LOAD * TEST_MIN + MIN_RUN_MIN) {
    const nearLong = longDate !== null ? [longDate, shift(longDate, -1)] : [];
    testDate = picked.find((d) => !nearLong.includes(d) && fresh(d)) ?? null;
  }

  /** The long run would not have been clearly longer than the others. */
  let tooEven = false;
  const place = (budget: number, ds: string[]): Slot[] => {
    const order = longDate !== null && ds.includes(longDate) ? [longDate, ...prefer(ds.filter((d) => d !== longDate))] : prefer(ds);
    for (let k = Math.min(ds.length, Math.floor(budget / MIN_RUN_MIN)); k > 0; k--) {
      const use = order.slice(0, k).sort(byDate);
      if (longDate !== null && k >= 2 && use.includes(longDate)) {
        const long = Math.floor(Math.min(Math.max(budget * LONG_SHARE, budget / k), cap));
        const each = Math.floor(Math.min((budget - long) / (k - 1), long));
        // A long run that is not clearly longer is none: then the days get easy runs.
        if (each >= MIN_RUN_MIN && isLongerThanEasy(long, each)) return use.map((date) => (date === longDate ? { date, kind: 'long', minutes: long } : { date, kind: 'easy', minutes: each }));
        const easy = Math.floor(Math.min(budget / k, easyCap));
        if (each >= MIN_RUN_MIN && easy >= MIN_RUN_MIN) { tooEven = true; return use.map((date) => ({ date, kind: 'easy', minutes: easy })); }
      } else {
        const each = Math.floor(Math.min(budget / k, easyCap));
        if (each >= MIN_RUN_MIN) return use.map((date) => ({ date, kind: 'easy', minutes: each }));
      }
    }
    return [];
  };
  const slots = place(testDate ? total - TEST_LOAD * TEST_MIN : total, picked.filter((d) => d !== testDate));
  if (testDate) slots.push({ date: testDate, kind: 'test', minutes: TEST_MIN });
  slots.sort((x, y) => byDate(x.date, y.date));

  const hrCap = capFor(input.maxHr);
  const hasTrend = startPoint(input.runs, input.nowMs).easyPace !== null;
  const runs: PlannedRun[] = slots.map((s) => {
    const cap = s.kind === 'test' ? null : hrCap;
    return { date: s.date, kind: s.kind, minutes: s.minutes, hrCap: cap, counts: countsText(s.kind, s.minutes, cap, hasTrend), note: s.kind === 'test' ? TEST_NOTE : null };
  });

  return {
    runs,
    reason: reasonText(phase, {
      mode, light, held, noDay: open.length === 0, tooFew: open.length > 0 && runs.length === 0, rising,
      long: runs.some((r) => r.kind === 'long') ? 'placed' : longDate === null ? 'noDay' : testDate !== null && !tooEven ? 'test' : 'short',
      test: testDate !== null,
    }),
    phase,
    totalMinutes: runs.reduce((s, r) => s + r.minutes * (r.kind === 'test' ? TEST_LOAD : 1), 0),
    maxRunMinutes: runs.reduce((m, r) => Math.max(m, r.minutes), 0),
    testDate,
    light,
    held,
    hrCap,
    hasTrend,
  };
};

/** Phase 2: the long run was placed, no day could take it, the test took its place, or the time was too short. */
export type LongFact = 'placed' | 'noDay' | 'test' | 'short';
export type ReasonFacts = { mode: ComplaintMode; light: boolean; held?: boolean; noDay: boolean; tooFew: boolean; rising: boolean; long: LongFact; test: boolean };

/** One calm sentence that names the phase. */
export const reasonText = (phase: 1 | 2, w: ReasonFacts): string => {
  const name = phase === 1 ? 'Phase „wieder fit“' : 'Phase „Distanz“';
  if (w.mode === 'pause') return `${name}: Diese Woche pausiert das Laufen.`;
  if (w.mode !== null) return `${name}: Diese Woche ist der Plan sanft, mit halber Zeit.`;
  if (w.noDay) return `${name}: Für diese Woche ist kein Lauftag mehr frei.`;
  if (w.tooFew) return `${name}: Für den Rest dieser Woche bleibt zu wenig Zeit für einen ganzen Lauf, weiter geht es nächste Woche.`;
  if (w.held) return `${name}: Die Woche bleibt, wie sie ist, weil sich die letzten Läufe schwer angefühlt haben.`;
  if (w.light) return `${name}: Diese Woche ist leichter, damit Erholung Platz hat.`;
  const test = w.test ? ', dazu kommt ein Testlauf als Messpunkt' : '';
  if (phase === 1) return `${name}: Diese Woche gibt es ruhige Läufe, und die Wochenzeit ${w.rising ? 'steigt' : 'bleibt'} behutsam${test}.`;
  if (w.long === 'placed') return `${name}: Diese Woche gibt es einen langen ruhigen Lauf, die anderen Läufe bleiben ruhig${test}.`;
  if (w.long === 'test') return `${name}: Diese Woche gibt es einen Testlauf statt des langen Laufs, die anderen Läufe bleiben ruhig.`;
  if (w.long === 'noDay') return `${name}: Diese Woche gibt es nur ruhige Läufe, für den langen Lauf passt kein Tag${test}.`;
  return `${name}: Diese Woche gibt es nur ruhige Läufe, für einen langen Lauf reicht die Zeit nicht${test}.`;
};

/** The reason that goes into change notes and the focus text when a hard-feeling streak holds the plan. */
export const HOLD_REASON = 'weil sich die letzten Läufe schwer angefühlt haben';

/**
 * True when the last `FEEL_HOLD_COUNT` runs of the window that have a feeling were all hard. A skipped question (null) is no
 * feeling. Fewer such runs hold nothing.
 */
export const feelHold = (runs: readonly Run[], feels: ReadonlyMap<string, RunFeel | null>, nowMs: number): boolean => {
  const last = runs
    .filter((r) => r.startMs <= nowMs && nowMs - r.startMs <= FEEL_WINDOW_DAYS * DAY && feels.get(r.id) != null)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(-FEEL_HOLD_COUNT);
  return last.length === FEEL_HOLD_COUNT && last.every((r) => feels.get(r.id) === 'hard');
};
