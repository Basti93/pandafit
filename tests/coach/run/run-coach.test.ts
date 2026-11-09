import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { RunCoach, type RunDeps } from '../../../src/coach/run/run-coach';
import { RecordStore } from '../../../src/coach/tracking/store';
import type { GarminRun } from '../../../src/coach/garmin-db';
import type { Complaint } from '../../../src/coach/motivation';
import type { DayRating } from '../../../src/coach/day-load';
import type { Profile } from '../../../src/shared/profiles';
import { readRunBody, weekFp, type RunReviewBody, type RunSettingsBody, type RunStatusBody, type RunWeekBody } from '../../../src/shared/run';
import type { TrackedRecord } from '../../../src/shared/records';
import type { WorkoutOps, WorkoutResult } from '../../../src/coach/run/garmin-workouts';
import { initialRunCache, loadRunCache, saveRunCache } from '../../../src/coach/run/state';

const HOUR = 3_600_000;
/** Monday 2 November 2026, local time. */
const at = (day: number, hour = 9, minute = 0): number => new Date(2026, 10, 2 + day, hour, minute).getTime();
const W0 = '2026-11-02';
const W1 = '2026-11-09';

let dir: string;
let store: RecordStore;
let now: number;
let open: boolean;
let garmin: GarminRun[] | null;
let complaints: Complaint[];
let ask: ReturnType<typeof vi.fn>;

const run = (id: string, startMs: number, minutes = 30, km = 5): GarminRun => ({
  id, type: 'running', startMs, durationS: minutes * 60, distanceM: km * 1000, avgHr: null, maxHr: null, elevationGainM: null,
});
const days = (_id: string, dates: string[]): Record<string, DayRating> => Object.fromEntries(dates.map((d) => [d, { date: d, hardness: null, legs: false, minutes: 0 }]));

const make = (over: Partial<RunDeps> = {}): RunCoach => new RunCoach({
  dir: path.join(dir, 'run'), store, nowMs: () => now, ask: ask as RunDeps['ask'], noOpenRide: () => open,
  profile: (id) => (id === 'pa' ? ({ id: 'pa', name: 'A', ftpW: 200 } as Profile) : null),
  garminDb: () => (garmin === null ? null : { runs: (fromMs: number) => garmin!.filter((r) => r.startMs >= fromMs), activityFile: () => null, body: () => null }),
  days, weeks: () => [], complaints: () => complaints,
  garmin: () => ({ connected: false, capable: false }),
  ...over,
});

const settings = (body: Partial<RunSettingsBody>, updatedMs = now): void => {
  store.put('pa', { kind: 'run', id: 'settings', updatedMs, deleted: false, body: { type: 'settings', on: true, weekdays: null, answers: null, ...body } });
};
const rec = (id: string): TrackedRecord | undefined => store.all('pa', 'run').find((r) => r.id === id);
const week = (w: string): RunWeekBody | null => { const r = rec(`week-${w}`); return r && !r.deleted ? readRunBody(r.body) as RunWeekBody : null; };
const status = (): RunStatusBody | null => { const r = rec('status'); return r && !r.deleted ? readRunBody(r.body) as RunStatusBody : null; };
/** Claude gives back the rule week it was shown, with its own reason. */
const echo = (reason = 'Ruhig weiter.') => async (input: { prompt: string }) => {
  const m = /<regelwoche-nur-daten>\n(.*)\n<\/regelwoche-nur-daten>/.exec(input.prompt);
  const rule = JSON.parse(m![1]!) as { runs: { date: string; kind: string; minutes: number }[] };
  return { runs: rule.runs, reason };
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runcoach-'));
  store = new RecordStore({ dir: path.join(dir, 'tracking') });
  now = at(2);
  open = true;
  garmin = [];
  complaints = [];
  ask = vi.fn(echo());
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('without Garmin and without a settings record nothing is written and nothing is asked', async () => {
  garmin = null;
  await make().tick('pa');
  expect(store.all('pa', 'run')).toEqual([]);
  expect(ask).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(dir, 'run'))).toBe(false);
});

test('Garmin runs in the last 8 weeks write a status record with suggest true and no week', async () => {
  garmin = [run('g1', at(-20))];
  await make().tick('pa');
  expect(status()).toMatchObject({ on: false, suggest: true });
  expect(store.all('pa', 'run').filter((r) => r.id.startsWith('week-'))).toEqual([]);
  expect(ask).not.toHaveBeenCalled();
  // Runs older than 8 weeks suggest nothing.
  garmin = [run('g1', at(-60))];
  store = new RecordStore({ dir: path.join(dir, 'tracking2') });
  await make().tick('pa');
  expect(store.all('pa', 'run')).toEqual([]);
});

test('a settings record with on false removes the status record (tombstone) and plans nothing', async () => {
  garmin = [run('g1', at(-20))];
  const coach = make();
  await coach.tick('pa');
  expect(status()).not.toBeNull();
  settings({ on: false });
  now += HOUR;
  await coach.tick('pa');
  expect(rec('status')?.deleted).toBe(true);
  expect(store.all('pa', 'run').filter((r) => r.id.startsWith('week-'))).toEqual([]);
  expect(ask).not.toHaveBeenCalled();
});

test("switching on plans the rest of the current week from today with announce false; Claude's checked answer replaces the rule plan with source claude", async () => {
  settings({ weekdays: [0, 2, 4, 6] });
  await make().tick('pa');
  const w = week(W0)!;
  expect(w.announce).toBe(false);
  expect(w.runs.length).toBeGreaterThan(0);
  expect(w.runs.every((r) => r.date >= '2026-11-04')).toBe(true);
  expect(w.source).toBe('claude');
  expect(w.reason).toBe('Ruhig weiter.');
  expect(w.runs.every((r) => r.fp === JSON.stringify([r.date, r.kind, r.minutes, r.hrCap]) && r.done === null)).toBe(true);
  expect(w.garmin).toBeNull();
  expect(week(W1)).toBeNull();
  expect(status()).toMatchObject({ on: true, suggest: false });
});

test('Claude unavailable or refused twice: the rule plan stands with source rules', async () => {
  settings({ weekdays: [0, 2, 4, 6] });
  ask = vi.fn(async () => { throw new Error('not there'); });
  await make().tick('pa');
  expect(week(W0)).toMatchObject({ source: 'rules' });
  expect(week(W0)!.runs.length).toBeGreaterThan(0);

  store = new RecordStore({ dir: path.join(dir, 'tracking2') });
  settings({ weekdays: [0, 2, 4, 6] });
  ask = vi.fn(async () => ({ runs: [], reason: 'Weniger.' }));
  const second = make({ dir: path.join(dir, 'run2') });
  await second.tick('pa');
  expect(ask).toHaveBeenCalledTimes(2);
  expect(ask.mock.calls[1]![0].prompt).toContain('ablehnung-nur-daten');
  expect(week(W0)).toMatchObject({ source: 'rules' });
  // Settled: the next tick asks nothing more.
  now += HOUR;
  await second.tick('pa');
  expect(ask).toHaveBeenCalledTimes(2);
});

test('a failed ask is tried again after 10 minutes, at most three times', async () => {
  settings({ weekdays: [0, 2, 4, 6] });
  ask = vi.fn(async () => { throw new Error('not there'); });
  const coach = make();
  await coach.tick('pa');
  now += 5 * 60_000;
  await coach.tick('pa');
  expect(ask).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 4; i++) { now += 11 * 60_000; await coach.tick('pa'); }
  expect(ask).toHaveBeenCalledTimes(3);
  expect(week(W0)).toMatchObject({ source: 'rules' });
});

test('on Sunday at 18:00 the next week is planned with announce true; at 17:59 it is not', async () => {
  settings({ weekdays: [0, 2, 4, 6] }, at(0));
  now = at(6, 17, 59);
  const coach = make();
  await coach.tick('pa');
  expect(week(W1)).toBeNull();
  now = at(6, 18, 0);
  await coach.tick('pa');
  expect(week(W1)).toMatchObject({ announce: true, week: W1 });
  expect(week(W1)!.runs.map((r) => r.date).every((d) => d >= W1)).toBe(true);
});

test('on with no runs and no answers: status needsAnswers true and a default plan', async () => {
  now = at(0);
  settings({});
  await make().tick('pa');
  expect(status()).toMatchObject({ on: true, needsAnswers: true, suggestedDays: [1, 3, 5] });
  expect(week(W0)!.runs.map((r) => [r.date, r.minutes])).toEqual([['2026-11-03', 20], ['2026-11-05', 20]]);
  // With answers there is nothing more to ask.
  settings({ answers: { runsPerWeek: 2, usualMinutes: 25, pain: false } }, now + 1);
  await make().tick('pa');
  expect(status()!.needsAnswers).toBe(false);
});

test('a missed run replans the rest of the week without adding its minutes', async () => {
  now = at(0);
  settings({ weekdays: [0, 2, 4], answers: { runsPerWeek: 3, usualMinutes: 30, pain: false } });
  const coach = make();
  await coach.tick('pa');
  const before = week(W0)!;
  expect(before.runs.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-04', '2026-11-06']);
  const perRun = before.runs[2]!.minutes;
  now = at(3);
  await coach.tick('pa');
  const after = week(W0)!;
  // Monday and Wednesday stay as they were; Friday gets no more than it had.
  expect(after.runs.slice(0, 2)).toEqual(before.runs.slice(0, 2));
  expect(after.runs.filter((r) => r.date > '2026-11-05').reduce((a, r) => a + r.minutes, 0)).toBeLessThanOrEqual(perRun);
  expect(ask).toHaveBeenCalledTimes(2);
});

test('a complaint change replans; an active knee complaint leaves no runs and the status says pause', async () => {
  settings({ weekdays: [0, 2, 4, 6] });
  const coach = make();
  await coach.tick('pa');
  expect(week(W0)!.runs.length).toBeGreaterThan(0);
  complaints = [{ id: 'c1', text: 'Das Knie zieht', status: 'active', startedMs: now, updatedMs: now }];
  now += HOUR;
  await coach.tick('pa');
  expect(week(W0)!.runs.filter((r) => r.date >= '2026-11-04')).toEqual([]);
  expect(status()!.complaint).toBe('pause');
});

test("a run at 23:30 on Sunday matches that Sunday's plan", async () => {
  now = at(0);
  settings({ weekdays: [2, 6] });
  const coach = make();
  await coach.tick('pa');
  const sunday = week(W0)!.runs.find((r) => r.date === '2026-11-08');
  expect(sunday).toBeDefined();
  garmin = [run('g-sun', at(6, 23, 30), 30)];
  now = at(7, 8);
  await coach.tick('pa');
  expect(week(W0)!.runs.find((r) => r.date === '2026-11-08')!.done).toBe('g-sun');
  expect(status()!.card).toMatchObject({ runId: 'g-sun', date: '2026-11-08', kind: sunday!.kind });
});

test('a run on an unplanned day counts in the weekly numbers as unplanned', async () => {
  now = at(0);
  settings({ weekdays: [0, 2, 4] });
  const coach = make();
  await coach.tick('pa');
  garmin = [run('g-tue', at(1, 18), 40, 6)];
  now = at(2, 8);
  await coach.tick('pa');
  const s = status()!;
  expect(s.card).toMatchObject({ runId: 'g-tue', kind: 'unplanned' });
  expect(s.numbers.weeks.at(-1)).toMatchObject({ week: W0, km: 6, minutes: 40 });
  expect(week(W0)!.runs.every((r) => r.done === null)).toBe(true);
});

test('with a ride open tick does nothing', async () => {
  settings({ weekdays: [0, 2, 4, 6] });
  garmin = [run('g1', at(-3))];
  open = false;
  await make().tick('pa');
  expect(store.all('pa', 'run').map((r) => r.id)).toEqual(['settings']);
  expect(ask).not.toHaveBeenCalled();
});

test('after a week ended its review record is written once with a next-week focus', async () => {
  now = at(0);
  settings({ weekdays: [0, 2, 4] });
  garmin = [run('g1', at(0, 18), 30, 5), run('g2', at(4, 18), 35, 6)];
  const coach = make();
  await coach.tick('pa');
  expect(rec(`review-${W0}`)).toBeUndefined();
  now = at(7, 9);
  await coach.tick('pa');
  const r = rec(`review-${W0}`)!;
  const body = readRunBody(r.body) as RunReviewBody;
  expect(body).toMatchObject({ type: 'review', week: W0, km: 11, minutes: 65, runs: 2, longestKm: 6 });
  expect(body.focus.length).toBeGreaterThan(10);
  expect(body.focus).not.toMatch(/rekord|serie|streak|musst|pflicht/i);
  now = at(7, 12);
  await coach.tick('pa');
  expect(rec(`review-${W0}`)!.updatedMs).toBe(r.updatedMs);
  // A fresh cache does not write it again either.
  await make({ dir: path.join(dir, 'other') }).tick('pa');
  expect(rec(`review-${W0}`)!.updatedMs).toBe(r.updatedMs);
});

test('a settings record from the phone changes the weekdays at the next tick', async () => {
  now = at(0);
  const answers = { runsPerWeek: 3, usualMinutes: 30, pain: false };
  settings({ weekdays: [0, 2, 4], answers });
  const coach = make();
  await coach.tick('pa');
  expect(week(W0)!.runs.map((r) => r.date)).toEqual(['2026-11-02', '2026-11-04', '2026-11-06']);
  now = at(0, 10);
  settings({ weekdays: [1, 3, 5], answers }, now);
  await coach.tick('pa');
  expect(week(W0)!.runs.filter((r) => r.date >= '2026-11-03').map((r) => r.date)).toEqual(['2026-11-03', '2026-11-05', '2026-11-07']);
});

test('a replan never changes past dates of the week', async () => {
  now = at(0);
  settings({ weekdays: [0, 2, 4, 6] });
  garmin = [run('g-mon', at(0, 7), 25)];
  const coach = make();
  await coach.tick('pa');
  now = at(3);
  await coach.tick('pa');
  const before = week(W0)!.runs.filter((r) => r.date < '2026-11-05');
  complaints = [{ id: 'c1', text: 'Wade', status: 'healing', startedMs: now, updatedMs: now }];
  now = at(3, 10);
  await coach.tick('pa');
  expect(week(W0)!.runs.filter((r) => r.date < '2026-11-05')).toEqual(before);
});

describe('test runs and restarts', () => {
  /** Two 60-minute runs a week, Tuesday and Saturday, in weeks `from` to `to` relative to W0. */
  const history = (from: number, to: number): GarminRun[] => {
    const out: GarminRun[] = [];
    for (let w = from; w <= to; w++) out.push(run(`g${w}a`, at(7 * w + 1, 18), 60, 9), run(`g${w}b`, at(7 * w + 5, 10), 60, 9));
    return out;
  };
  const tests = (w: string) => (week(w)?.runs ?? []).filter((r) => r.kind === 'test');
  const weekKey = (n: number) => { const d = new Date(2026, 10, 2 + 7 * n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  describe('what changed ("Zuletzt geändert")', () => {
    const steady = (): GarminRun[] => Array.from({ length: 5 }, (_, i) => [1, 3, 5].map((d) => run(`s${i}${d}`, at(7 * (i - 5) + d, 18), 40, 6))).flat();
    test('a phase change gets one note with its reason, the first plan none, and the same plan again adds none', async () => {
      garmin = steady();
      settings({ weekdays: [0, 2, 4, 6] }, at(-60));
      const first = make();
      await first.tick('pa');
      expect(first.changeNotes('pa').filter((n) => n.text.startsWith('Lauf: Phase'))).toEqual([]);
      // The coach had planned in phase 1 before.
      saveRunCache(path.join(dir, 'run'), { ...loadRunCache(path.join(dir, 'run'), 'pa'), lastPhase: 1, planKey: {} });
      now += HOUR;
      const coach = make();
      await coach.tick('pa');
      const phase = coach.changeNotes('pa').filter((n) => n.text.startsWith('Lauf: Phase'));
      expect(phase).toEqual([{ atMs: now, coach: 'run', text: 'Lauf: Phase 2', reason: 'drei Läufe pro Woche in 4 von 5 Wochen' }]);
      saveRunCache(path.join(dir, 'run'), { ...loadRunCache(path.join(dir, 'run'), 'pa'), planKey: {} });
      now += HOUR;
      const again = make();
      await again.tick('pa');
      expect(again.changeNotes('pa').filter((n) => n.text.startsWith('Lauf: Phase'))).toEqual(phase);
    });
    test('a test week gets a note, and the notes keep at most 20', async () => {
      garmin = history(-11, -1);
      settings({ weekdays: [0, 2, 4, 6] }, at(-60));
      now = at(6, 8);
      const coach = make();
      await coach.tick('pa');
      garmin = [...history(-11, -1), run('g-sun', at(6, 9), 60, 9)];
      now = at(6, 18);
      await coach.tick('pa');
      expect(coach.changeNotes('pa').map((n) => n.text)).toEqual(expect.arrayContaining(['Lauf: leichtere Woche', 'Lauf: Testlauf in dieser Woche']));
      const cache = { ...loadRunCache(path.join(dir, 'run'), 'pa') };
      expect(cache.changeNotes.length).toBeLessThanOrEqual(20);
    });
  });

  test('a test is offered 28 days after switch-on', async () => {
    garmin = history(-1, 3);
    // Switched on on Sunday evening; the coach ticks every Monday morning and every Sunday evening, as the runtime would.
    now = at(-1, 20);
    settings({ weekdays: [0, 2, 4, 6] });
    const coach = make();
    await coach.tick('pa');
    for (let w = 0; w < 4; w++) {
      now = at(7 * w, 8);
      await coach.tick('pa');
      now = at(7 * w + 6, 18);
      await coach.tick('pa');
    }
    for (let w = 0; w < 4; w++) expect(tests(weekKey(w))).toEqual([]);
    // The 28 days end before week 4 starts: its Sunday plan has the test, and Monday keeps it.
    expect(tests(weekKey(4))).toHaveLength(1);
    now = at(28, 8);
    await coach.tick('pa');
    expect(tests(weekKey(4))).toHaveLength(1);
  });

  test('a skipped test is not re-offered the next week', async () => {
    garmin = history(-1, 4);
    now = at(0, 8);
    settings({ weekdays: [0, 2, 4, 6] });
    const coach = make();
    await coach.tick('pa');
    now = at(28, 8);
    await coach.tick('pa');
    expect(tests(weekKey(4))).toHaveLength(1);
    // No run on the test day; the next week comes without a test.
    garmin = garmin.filter((r) => r.startMs < at(28));
    garmin.push(...history(4, 4));
    now = at(35, 8);
    await coach.tick('pa');
    expect(week(weekKey(5))!.runs.length).toBeGreaterThan(0);
    expect(tests(weekKey(5))).toEqual([]);
  });

  test('no test in the first 28 days after a run complaint closed, also after the 7-day restart window', async () => {
    garmin = history(-10, -1);
    settings({ weekdays: [0, 2, 4, 6] }, at(-60));
    now = at(0, 8);
    // Without the complaint the test is due (switched on 60 days ago).
    await make().tick('pa');
    expect(tests(W0)).toHaveLength(1);

    store = new RecordStore({ dir: path.join(dir, 'tracking2') });
    settings({ weekdays: [0, 2, 4, 6] }, at(-60));
    complaints = [{ id: 'c1', text: 'Knie', status: 'over', startedMs: at(-20), updatedMs: at(-9) }];
    await make({ dir: path.join(dir, 'run2') }).tick('pa');
    expect(status()!.complaint).toBeNull();
    expect(week(W0)!.runs.length).toBeGreaterThan(0);
    expect(tests(W0)).toEqual([]);
  });

  test("no test the day after last week's long run", async () => {
    const plan = async (sundayLong: boolean, sub: string): Promise<string[]> => {
      store = new RecordStore({ dir: path.join(dir, `tracking-${sub}`) });
      // Eleven weeks of history: the planned week is not a light week.
      garmin = history(-11, -1);
      settings({ weekdays: [0, 2, 4, 6] }, at(-60));
      now = at(6, 8);
      const coach = make({ dir: path.join(dir, `run-${sub}`) });
      await coach.tick('pa');
      if (sundayLong) {
        // Sunday's run of this week is a planned long run.
        const r = rec(`week-${W0}`)!;
        const body = r.body as RunWeekBody;
        const runs = body.runs.map((x) => (x.date === '2026-11-08' ? { ...x, kind: 'long' as const, fp: JSON.stringify([x.date, 'long', x.minutes, x.hrCap]) } : x));
        expect(runs.some((x) => x.kind === 'long')).toBe(true);
        store.put('pa', { ...r, updatedMs: r.updatedMs + 1, body: { ...body, runs } });
      }
      garmin = [...history(-11, -1), run('g-sun', at(6, 9), 60, 9)];
      now = at(6, 18);
      await coach.tick('pa');
      return tests(W1).map((r) => r.date);
    };
    expect(await plan(false, 'a')).toEqual(['2026-11-09']);
    const after = await plan(true, 'b');
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe('2026-11-09');
  });

  test('a day that became hard in the bike or gym plan moves the test off it', async () => {
    garmin = history(-10, -1);
    settings({ weekdays: [0, 2, 4, 6] }, at(-60));
    now = at(0, 8);
    const hard = new Set<string>();
    const coach = make({ days: (_id, dates) => Object.fromEntries(dates.map((d) => [d, { date: d, hardness: hard.has(d) ? 'hard' : null, legs: false, minutes: 0 }])) });
    await coach.tick('pa');
    expect(tests(W0).map((r) => r.date)).toEqual(['2026-11-02']);
    hard.add('2026-11-02');
    now = at(0, 9);
    await coach.tick('pa');
    expect(tests(W0).map((r) => r.date)).not.toContain('2026-11-02');
    expect(ask).toHaveBeenCalledTimes(2);
    // A new day alone, or a change on a day that has passed, replans nothing.
    now = at(1, 9);
    await coach.tick('pa');
    hard.delete('2026-11-02');
    now = at(1, 10);
    await coach.tick('pa');
    expect(ask).toHaveBeenCalledTimes(2);
  });

  test('the week after a restart ramps from the restart week', async () => {
    // Running before the complaint, a pause of two weeks, then two runs of 30 minutes in the restart week.
    garmin = [...history(-7, -3), run('r1', at(1, 18), 30, 5), run('r2', at(3, 18), 30, 5)];
    complaints = [{ id: 'c1', text: 'Knie', status: 'over', startedMs: at(-20), updatedMs: at(0, 8) }];
    settings({ weekdays: [1, 3, 5] }, at(0, 9));
    now = at(6, 18);
    await make().tick('pa');
    expect(status()!.complaint).toBe('restart');
    const next = week(W1)!;
    // Ramped from 60 restart-week minutes (66, halved for the restart), not from the mean over the pause.
    expect(next.runs.reduce((a, r) => a + r.minutes, 0)).toBeGreaterThan(25);
    expect(next.runs).toHaveLength(2);
  });
});

describe('the run cache', () => {
  test('a saved cache loads again, and a broken file starts fresh', () => {
    const d = path.join(dir, 'cache');
    const c = { ...initialRunCache('pa'), attempts: 2, planKey: { [W0]: 'k' }, onSinceMs: 5 };
    saveRunCache(d, c);
    expect(loadRunCache(d, 'pa')).toEqual(c);
    fs.writeFileSync(path.join(d, 'pa.json'), '{nope');
    expect(loadRunCache(d, 'pa')).toEqual(initialRunCache('pa'));
    fs.writeFileSync(path.join(d, 'pa.json'), '[]');
    expect(loadRunCache(d, 'pa')).toEqual(initialRunCache('pa'));
  });

  test('switching off clears the switch-on time; switching on again starts a new one', async () => {
    now = at(0);
    settings({ weekdays: [0, 2, 4] });
    const coach = make();
    await coach.tick('pa');
    expect(loadRunCache(path.join(dir, 'run'), 'pa').onSinceMs).toBe(at(0));
    now = at(1);
    settings({ on: false });
    await coach.tick('pa');
    expect(loadRunCache(path.join(dir, 'run'), 'pa').onSinceMs).toBeNull();
    now = at(2);
    settings({ weekdays: [0, 2, 4] });
    await coach.tick('pa');
    expect(loadRunCache(path.join(dir, 'run'), 'pa').onSinceMs).toBe(at(2));
  });
});

describe('fix round 1', () => {
  test('a record whose id and body type disagree is ignored', async () => {
    now = at(0);
    settings({ weekdays: [0, 2, 4] });
    // A week body under a manual-run id must not count as a plan for Tuesday.
    store.put('pa', { kind: 'run', id: 'manual-x', updatedMs: now, deleted: false, body: { type: 'week', week: W0, announce: false, atMs: now, phase: 1, source: 'rules', reason: 'x', note: null,
      runs: [{ date: '2026-11-03', kind: 'long', minutes: 50, hrCap: null, counts: 'x', note: null, fp: 'f', done: null }], garmin: null } });
    // A settings body under the status id is no settings record.
    store.put('pa', { kind: 'run', id: 'status', updatedMs: 1, deleted: false, body: { type: 'settings', on: true, weekdays: [1], answers: null } });
    const coach = make();
    await coach.tick('pa');
    garmin = [run('g-tue', at(1, 18), 40, 6)];
    now = at(2, 8);
    await coach.tick('pa');
    const s = status()!;
    expect(s.card).toMatchObject({ runId: 'g-tue', kind: 'unplanned' });
    expect(s.numbers.weeks.at(-1)!.plannedMinutes).toBe(week(W0)!.runs.reduce((a, r) => a + r.minutes, 0));
    expect(rec('manual-x')!.body).toMatchObject({ type: 'week' });
  });

  test('with running off or never on, Garmin runs still reach the coach for mobility and load', async () => {
    garmin = [run('g1', at(1, 18))];
    const coach = make();
    await coach.tick('pa');
    expect(coach.runs('pa').map((r) => r.id)).toEqual(['g1']);
    settings({ on: false });
    await coach.tick('pa');
    expect(coach.runs('pa').map((r) => r.id)).toEqual(['g1']);
    settings({ on: true }, now + 1);
    await coach.tick('pa');
    expect(coach.runs('pa').map((r) => r.id)).toEqual(['g1']);
  });

  test('the switch-on time is when the settings say, not when the coach first sees them', async () => {
    settings({ weekdays: [0, 2, 4] }, at(0, 7));
    now = at(3);
    await make().tick('pa');
    expect(loadRunCache(path.join(dir, 'run'), 'pa').onSinceMs).toBe(at(0, 7));
  });

  test('a suggest status is removed once Garmin is gone and no settings exist', async () => {
    garmin = [run('g1', at(-10))];
    const coach = make();
    await coach.tick('pa');
    expect(status()).toMatchObject({ suggest: true });
    garmin = null;
    now += HOUR;
    await coach.tick('pa');
    expect(rec('status')!.deleted).toBe(true);
  });

  test("a ride opened while Claude thinks: nothing is written, and Claude's answer is written after the ride", async () => {
    settings({ weekdays: [0, 2, 4, 6] });
    const answer = echo('Nach der Fahrt.');
    ask = vi.fn(async (input: { prompt: string }) => { open = false; return answer(input); });
    const coach = make();
    await coach.tick('pa');
    expect(week(W0)).toMatchObject({ source: 'rules' });
    expect(rec('status')).toBeUndefined();
    open = true;
    now += 30 * 60_000;
    await coach.tick('pa');
    expect(week(W0)).toMatchObject({ source: 'claude', reason: 'Nach der Fahrt.' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(status()).not.toBeNull();
  });

  test('two profiles side by side keep their own plans and runs', async () => {
    const runsOf: Record<string, GarminRun[]> = { pa: [run('a1', at(1, 18))], pb: [run('b1', at(1, 7), 50, 8)] };
    const coach = make({
      profile: (id) => ({ id, name: id, ftpW: 200 }) as Profile,
      garminDb: (id) => ({ runs: (fromMs: number) => runsOf[id]!.filter((r) => r.startMs >= fromMs), activityFile: () => null, body: () => null }),
    });
    store.put('pa', { kind: 'run', id: 'settings', updatedMs: now, deleted: false, body: { type: 'settings', on: true, weekdays: [2, 4], answers: null } });
    store.put('pb', { kind: 'run', id: 'settings', updatedMs: now, deleted: false, body: { type: 'settings', on: true, weekdays: [3, 5], answers: null } });
    await Promise.all([coach.tick('pa'), coach.tick('pb')]);
    const weekOf = (p: string) => readRunBody(store.all(p, 'run').find((r) => r.id === `week-${W0}`)!.body) as RunWeekBody;
    const statusOf = (p: string) => readRunBody(store.all(p, 'run').find((r) => r.id === 'status')!.body) as RunStatusBody;
    expect(weekOf('pa').runs.map((r) => r.date)).toEqual(['2026-11-04', '2026-11-06']);
    expect(weekOf('pb').runs.map((r) => r.date)).toEqual(['2026-11-05', '2026-11-07']);
    expect(statusOf('pa').card!.runId).toBe('a1');
    expect(statusOf('pb').card!.runId).toBe('b1');
    expect(coach.runs('pa').map((r) => r.id)).toEqual(['a1']);
    expect(coach.runs('pb').map((r) => r.id)).toEqual(['b1']);
  });

  test('every finished week since the last review gets its review, up to 4 weeks back', async () => {
    now = at(0);
    settings({ weekdays: [0, 2, 4] });
    const coach = make();
    await coach.tick('pa');
    now = at(6, 18);
    await coach.tick('pa');
    expect(week(W1)).not.toBeNull();
    // Offline for the whole of week 1.
    now = at(14, 9);
    await coach.tick('pa');
    expect(rec(`review-${W0}`)).toBeDefined();
    expect(rec(`review-${W1}`)).toBeDefined();
  });
});

describe('sending to Garmin after confirmation', () => {
  type Sent = { id: string; week: string; ops: WorkoutOps };
  let sends: Sent[];
  let link: { connected: boolean; capable: boolean };
  const garminCoach = (over: Partial<RunDeps> = {}) => make({
    garmin: () => link,
    sendWorkouts: (id, w, ops) => { sends.push({ id, week: w, ops }); return true; },
    profile: (id) => (id === 'pa' ? ({ id: 'pa', name: 'A', ftpW: 200, hrMaxBpm: 190 } as Profile) : null),
    ...over,
  });
  const confirm = (fp: string, atMs = now, updatedMs = now): void => {
    store.put('pa', { kind: 'run', id: `send-${W0}`, updatedMs, deleted: false, body: { type: 'send', week: W0, fp, atMs } });
  };
  const fpNow = (): string => weekFp(week(W0)!.runs);
  /** Every create comes back with ids made from its date. */
  const okFor = (ops: WorkoutOps): WorkoutResult => ({
    status: 'ok', reason: null, deleted: ops.delete.map((d) => d.workoutId),
    created: ops.create.map((c) => ({ date: c.date, workoutId: `w${c.date}`, scheduleId: `s${c.date}` })),
  });

  beforeEach(() => {
    sends = [];
    link = { connected: true, capable: true };
    settings({ weekdays: [0, 2, 4, 6] });
  });

  test('the status says whether Garmin sending is possible, and follows a disconnect', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    expect(status()!.garmin).toBe(true);
    link = { connected: false, capable: true };
    now += HOUR;
    await coach.tick('pa');
    expect(status()!.garmin).toBe(false);
    link = { connected: true, capable: false };
    now += HOUR;
    await coach.tick('pa');
    expect(status()!.garmin).toBe(false);
  });

  test('no Garmin login: week.garmin is null and a send record starts nothing', async () => {
    link = { connected: false, capable: true };
    const coach = garminCoach();
    await coach.tick('pa');
    expect(week(W0)!.garmin).toBeNull();
    confirm(fpNow());
    now += HOUR;
    await coach.tick('pa');
    expect(sends).toEqual([]);
    expect(week(W0)!.garmin).toBeNull();
  });

  test('a library without workout support: week.garmin is null', async () => {
    link = { connected: true, capable: false };
    await garminCoach().tick('pa');
    expect(week(W0)!.garmin).toBeNull();
  });

  test('with login and support the week offers sending, and nothing goes without a send record', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    expect(week(W0)!.garmin).toEqual({ status: 'none', reason: null, confirmedMs: null, sent: {} });
    now += HOUR;
    await coach.tick('pa');
    expect(sends).toEqual([]);
  });

  test('a send record with the current fingerprint starts one run with deletes before creates', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm(fpNow());
    await coach.tick('pa');
    expect(sends).toHaveLength(1);
    const runs = week(W0)!.runs;
    expect(sends[0]!.ops).toEqual({
      delete: [],
      create: runs.map((r) => expect.objectContaining({ date: r.date, hrLow: 114, hrHigh: r.hrCap })),
      // Workouts of ours with lost ids in the rest of the week are removed first.
      sweep: { from: '2026-11-04', to: '2026-11-08', prefix: 'Pandafit · ', keep: [] },
    });
    expect(week(W0)!.garmin).toMatchObject({ status: 'sending', confirmedMs: now });
    const easy = sends[0]!.ops.create.find((c) => runs.find((r) => r.date === c.date)!.kind === 'easy')!;
    expect(easy.name).toBe('Pandafit · Lauf ruhig');
    expect(easy.warmupS + easy.mainS + easy.cooldownS).toBe(runs.find((r) => r.date === easy.date)!.minutes * 60);
    coach.sendResult('pa', W0, okFor(sends[0]!.ops));
    const firstDates = runs.map((r) => r.date);

    // The plan changes: the sent runs are marked changed and nothing goes until a new confirmation.
    now += HOUR;
    settings({ weekdays: [1, 3, 5] });
    await coach.tick('pa');
    expect(week(W0)!.garmin!.status).toBe('changed');
    expect(sends).toHaveLength(1);
    confirm(fpNow());
    await coach.tick('pa');
    expect(sends).toHaveLength(2);
    const ops = sends[1]!.ops;
    // Old dates that are no longer planned are deleted; the new ones created.
    expect(ops.delete.map((d) => d.workoutId).sort()).toEqual(firstDates.map((d) => `w${d}`));
    expect(firstDates.some((d) => week(W0)!.runs.some((r) => r.date === d))).toBe(false);
    expect(ops.delete[0]!.scheduleId).toMatch(/^s/);
    expect(ops.create.map((c) => c.date)).toEqual(week(W0)!.runs.map((r) => r.date));
    coach.sendResult('pa', W0, okFor(ops));
    expect(Object.keys(week(W0)!.garmin!.sent).sort()).toEqual(week(W0)!.runs.map((r) => r.date));
    expect(week(W0)!.garmin!.status).toBe('sent');
  });

  test('an unchanged sent run stays, a changed one is deleted and then created again', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm(fpNow());
    await coach.tick('pa');
    coach.sendResult('pa', W0, okFor(sends[0]!.ops));
    // One sent run's fingerprint no longer matches (as after a replan of that day).
    const r = rec(`week-${W0}`)!;
    const body = r.body as RunWeekBody;
    const first = body.runs[0]!;
    store.put('pa', { ...r, updatedMs: r.updatedMs + 1, body: { ...body, garmin: { ...body.garmin!, sent: { ...body.garmin!.sent, [first.date]: { ...body.garmin!.sent[first.date]!, fp: 'alt' } } } } });
    now += HOUR;
    confirm(fpNow());
    await coach.tick('pa');
    expect(sends).toHaveLength(2);
    expect(sends[1]!.ops.delete).toEqual([{ workoutId: `w${first.date}`, scheduleId: `s${first.date}` }]);
    expect(sends[1]!.ops.create.map((c) => c.date)).toEqual([first.date]);
    // The sweep keeps every sent workout that is not being deleted.
    expect(sends[1]!.ops.sweep!.keep.sort()).toEqual(body.runs.slice(1).map((r) => `w${r.date}`).sort());
  });

  test('a plan that changes while a send runs: the result keeps the fingerprints that were sent', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm(fpNow());
    await coach.tick('pa');
    const sentFps = Object.fromEntries(week(W0)!.runs.map((r) => [r.date, r.fp]));
    // One run gets longer while the send is under way.
    const r = rec(`week-${W0}`)!;
    const body = r.body as RunWeekBody;
    const first = body.runs[0]!;
    const longer = { ...first, minutes: first.minutes + 5 };
    store.put('pa', { ...r, updatedMs: r.updatedMs + 1, body: { ...body, runs: [{ ...longer, fp: JSON.stringify([longer.date, longer.kind, longer.minutes, longer.hrCap]) }, ...body.runs.slice(1)] } });
    coach.sendResult('pa', W0, okFor(sends[0]!.ops));
    const g = week(W0)!.garmin!;
    expect(g.sent[first.date]!.fp).toBe(sentFps[first.date]);
    expect(g.status).toBe('changed');
  });

  test('past dates are never created or deleted', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    const r = rec(`week-${W0}`)!;
    const body = r.body as RunWeekBody;
    // A planned run on Monday (past) and a sent one on Tuesday (past) that is no longer planned.
    const monday = { ...body.runs[0]!, date: '2026-11-02' };
    const runs = [{ ...monday, fp: JSON.stringify([monday.date, monday.kind, monday.minutes, monday.hrCap]) }, ...body.runs];
    store.put('pa', { ...r, updatedMs: r.updatedMs + 1, body: { ...body, runs, garmin: { status: 'none', reason: null, confirmedMs: null, sent: { '2026-11-03': { workoutId: 'w-tue', scheduleId: 's-tue', fp: 'alt' } } } } });
    confirm(weekFp(runs));
    await coach.tick('pa');
    expect(sends).toHaveLength(1);
    expect(sends[0]!.ops.create.map((c) => c.date)).not.toContain('2026-11-02');
    expect(sends[0]!.ops.delete).toEqual([]);
    expect(sends[0]!.ops.sweep!.keep).toEqual(['w-tue']);
  });

  test("today's run already done: no workout for today", async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    expect(week(W0)!.runs[0]!.date).toBe('2026-11-04');
    garmin = [run('g-today', at(2, 7))];
    now += HOUR;
    await coach.tick('pa');
    confirm(fpNow());
    await coach.tick('pa');
    expect(sends).toHaveLength(1);
    expect(sends[0]!.ops.create.map((c) => c.date)).not.toContain('2026-11-04');
    expect(sends[0]!.ops.sweep!.from).toBe('2026-11-05');
  });

  test('a newer send record while a send runs waits for its result, and then sends only what is missing', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm(fpNow());
    await coach.tick('pa');
    now += 60_000;
    confirm(fpNow());
    await coach.tick('pa');
    expect(sends).toHaveLength(1);
    expect(week(W0)!.garmin!.status).toBe('sending');
    coach.sendResult('pa', W0, okFor(sends[0]!.ops));
    now += 60_000;
    await coach.tick('pa');
    // The newer confirmation is handled now: everything is on the watch already.
    expect(sends).toHaveLength(1);
    expect(week(W0)!.garmin).toMatchObject({ status: 'sent', confirmedMs: now - 60_000 });
  });

  test('an old fingerprint marks stale and sends nothing', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm('alt');
    await coach.tick('pa');
    expect(sends).toEqual([]);
    expect(week(W0)!.garmin).toMatchObject({ status: 'stale', confirmedMs: now });
    // A stale confirmation is used up: it never sends later either.
    now += HOUR;
    await coach.tick('pa');
    expect(sends).toEqual([]);
  });

  test('a ride open waits: nothing is sent, and it goes once the ride is closed', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm(fpNow());
    open = false;
    await coach.tick('pa');
    expect(sends).toEqual([]);
    expect(week(W0)!.garmin!.status).toBe('none');
    // The bridge itself refuses during a ride too: the confirmation is kept for later.
    open = true;
    const refusing = garminCoach({ sendWorkouts: () => false });
    await refusing.tick('pa');
    expect(week(W0)!.garmin).toMatchObject({ status: 'none', confirmedMs: null });
    now += HOUR;
    await coach.tick('pa');
    expect(sends).toHaveLength(1);
  });

  test('a send record is handled once, also when written by two devices with the same atMs', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    const atMs = now;
    confirm(fpNow(), atMs);
    await coach.tick('pa');
    // Still sending: another tick starts nothing.
    now += 60_000;
    await coach.tick('pa');
    expect(sends).toHaveLength(1);
    coach.sendResult('pa', W0, okFor(sends[0]!.ops));
    // The second device's record: same atMs, written later.
    confirm(fpNow(), atMs, now + 5);
    now += HOUR;
    await coach.tick('pa');
    expect(sends).toHaveLength(1);
    expect(week(W0)!.garmin!.status).toBe('sent');
  });

  test('the result keeps workout and schedule ids in the week record', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm(fpNow());
    await coach.tick('pa');
    coach.sendResult('pa', W0, okFor(sends[0]!.ops));
    const w = week(W0)!;
    expect(w.garmin!.status).toBe('sent');
    expect(w.garmin!.reason).toBeNull();
    for (const r of w.runs) expect(w.garmin!.sent[r.date]).toEqual({ workoutId: `w${r.date}`, scheduleId: `s${r.date}`, fp: r.fp });
  });

  test('a partial failure keeps the ids that were created and says failed', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm(fpNow());
    await coach.tick('pa');
    const [first] = sends[0]!.ops.create;
    coach.sendResult('pa', W0, { status: 'failed', reason: 'reauth', deleted: [], created: [{ date: first!.date, workoutId: 'w1', scheduleId: null }] });
    const g = week(W0)!.garmin!;
    expect(g).toMatchObject({ status: 'failed', reason: 'reauth' });
    expect(g.sent).toEqual({ [first!.date]: { workoutId: 'w1', scheduleId: null, fp: week(W0)!.runs.find((r) => r.date === first!.date)!.fp } });
    // A new confirmation sends only what is missing.
    now += HOUR;
    confirm(fpNow());
    await coach.tick('pa');
    expect(sends[1]!.ops.create.map((c) => c.date)).not.toContain(first!.date);
    expect(sends[1]!.ops.delete).toEqual([]);
  });

  test('a send cut off by a restart counts as failed and can be confirmed again', async () => {
    await garminCoach().tick('pa');
    confirm(fpNow());
    await garminCoach().tick('pa');
    expect(week(W0)!.garmin!.status).toBe('sending');
    // A new coach (process) never gets that result.
    now += HOUR;
    await garminCoach().tick('pa');
    expect(week(W0)!.garmin).toMatchObject({ status: 'failed', reason: 'failed' });
  });

  test('a paused week with workouts on the watch says changed, and its confirmation only deletes them', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    confirm(fpNow());
    await coach.tick('pa');
    coach.sendResult('pa', W0, okFor(sends[0]!.ops));
    const sentIds = Object.values(week(W0)!.garmin!.sent).map((s) => s.workoutId).sort();
    expect(sentIds.length).toBeGreaterThan(0);
    complaints = [{ id: 'c1', text: 'Das Knie zieht', status: 'active', startedMs: now, updatedMs: now }];
    now += HOUR;
    await coach.tick('pa');
    expect(week(W0)!.runs.filter((r) => r.date >= '2026-11-04')).toEqual([]);
    expect(week(W0)!.garmin!.status).toBe('changed');
    expect(sends).toHaveLength(1);
    // The phone confirms the removal with the paused week's fingerprint.
    now += 60_000;
    confirm(fpNow());
    await coach.tick('pa');
    expect(sends).toHaveLength(2);
    expect(sends[1]!.ops.create).toEqual([]);
    expect(sends[1]!.ops.delete.map((d) => d.workoutId).sort()).toEqual(sentIds);
    coach.sendResult('pa', W0, okFor(sends[1]!.ops));
    expect(week(W0)!.garmin).toMatchObject({ status: 'sent', sent: {} });
  });

  test('a test run is named so and its main step has no target', async () => {
    const coach = garminCoach();
    await coach.tick('pa');
    // A planned test run in the week record.
    const r = rec(`week-${W0}`)!;
    const body = r.body as RunWeekBody;
    const test = { ...body.runs[0]!, kind: 'test' as const, minutes: 45, hrCap: null };
    const runs = [{ ...test, fp: JSON.stringify([test.date, test.kind, test.minutes, test.hrCap]) }, ...body.runs.slice(1)];
    store.put('pa', { ...r, updatedMs: r.updatedMs + 1, body: { ...body, runs } });
    confirm(weekFp(runs));
    await coach.tick('pa');
    const c = sends[0]!.ops.create.find((x) => x.date === test.date)!;
    expect(c).toEqual({ date: test.date, name: 'Pandafit · Testlauf 30 Minuten', warmupS: 600, mainS: 1800, cooldownS: 300, hrLow: null, hrHigh: null });
  });
});

describe('runs for the statistics', () => {
  const manual = (id: string, startMs: number, minutes: number): void => {
    store.put('pa', { kind: 'run', id, updatedMs: now, deleted: false, body: { type: 'manual', startMs, durationS: minutes * 60, distanceM: 5000, avgHr: null, runType: 'running' } });
  };
  const plannedWeek = (date: string, kind: 'easy' | 'long' | 'test'): void => {
    const p = { date, kind, minutes: 40, hrCap: null, counts: 'x', note: null };
    store.put('pa', { kind: 'run', id: `week-${W0}`, updatedMs: now, deleted: false, body: {
      type: 'week', week: W0, announce: false, atMs: now, phase: 1, source: 'rules', reason: 'x', note: null,
      runs: [{ ...p, fp: JSON.stringify([p.date, p.kind, p.minutes, p.hrCap]), done: null }], garmin: null,
    } });
  };

  test('a manual run in the window comes with its hardness, Garmin and manual merged, nothing older than 70 days', () => {
    garmin = [run('g1', at(-1), 80), run('g-old', at(-80), 30)];
    manual('manual-a', at(1, 7), 30);
    // The same run as the Garmin one: counts once.
    manual('manual-b', at(-1), 80);
    expect(make().runsFor('pa')).toEqual([
      { startMs: at(-1), durationS: 4800, hardness: 'moderate' },
      { startMs: at(1, 7), durationS: 1800, hardness: 'easy' },
    ]);
  });

  test('the planned kind of that date from the week record rates the run', () => {
    garmin = null;
    manual('manual-a', at(1, 7), 30);
    plannedWeek('2026-11-03', 'test');
    expect(make().runsFor('pa')).toEqual([{ startMs: at(1, 7), durationS: 1800, hardness: 'hard' }]);
  });

  test('a run later than now is not counted', () => {
    garmin = null;
    manual('manual-a', at(5), 30);
    expect(make().runsFor('pa')).toEqual([]);
  });
});

describe('how the runs felt', () => {
  const feel = (runId: string, f: 'easy' | 'right' | 'hard' | null) => store.put('pa', { kind: 'run', id: `run-feel-${runId}`, updatedMs: now, deleted: false, body: { type: 'feel', runId, feel: f, atMs: now } });
  const total = (w: RunWeekBody | null) => w!.runs.reduce((a, r) => a + r.minutes, 0);
  const steady = () => { garmin = [run('g1', at(-20), 30), run('g2', at(-18), 30), run('g3', at(-13), 30), run('g4', at(-11), 30), run('g5', at(-6), 30), run('g6', at(-4), 30), run('g7', at(-2), 30), run('g8', at(-1), 30)]; };

  test('two hard runs in a row hold the week, with the reason; two easy ones change nothing', async () => {
    now = at(0, 9);
    steady();
    settings({ weekdays: [0, 1, 2, 3, 4, 5, 6] }, at(-30));
    ask = vi.fn(async () => { throw new Error('rules only'); });
    await make().tick('pa');
    const free = week(W0)!;
    expect(free.reason).not.toMatch(/schwer/);

    store = new RecordStore({ dir: path.join(dir, 'tracking-easy') });
    settings({ weekdays: [0, 1, 2, 3, 4, 5, 6] }, at(-30));
    feel('g7', 'easy'); feel('g8', 'easy');
    await make({ dir: path.join(dir, 'run-easy') }).tick('pa');
    expect(week(W0)!.runs).toEqual(free.runs);
    expect(week(W0)!.reason).toBe(free.reason);

    store = new RecordStore({ dir: path.join(dir, 'tracking-hard') });
    settings({ weekdays: [0, 1, 2, 3, 4, 5, 6] }, at(-30));
    feel('g7', 'hard'); feel('g8', 'hard');
    await make({ dir: path.join(dir, 'run-hard') }).tick('pa');
    const held = week(W0)!;
    expect(held.reason).toContain('weil sich die letzten Läufe schwer angefühlt haben');
    expect(total(held)).toBeLessThan(total(free));
    expect(Math.max(...held.runs.map((r) => r.minutes))).toBeLessThanOrEqual(30);
  });

  test('one hard run, a hard run between two others, or a skipped question hold nothing', async () => {
    now = at(0, 9);
    steady();
    settings({ weekdays: [0, 1, 2, 3, 4, 5, 6] }, at(-30));
    ask = vi.fn(async () => { throw new Error('rules only'); });
    feel('g7', 'hard'); feel('g8', null);
    await make().tick('pa');
    // g8 was skipped, so g6 and g7 are the last two with a feeling: g6 has none yet, so only one hard run counts.
    expect(week(W0)!.reason).not.toMatch(/schwer/);
  });
});
