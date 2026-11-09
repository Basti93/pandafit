import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Coach } from '../../src/coach/coach';
import { bestPowers, loadSeries, summarizeRide, type RideSummary } from '../../src/coach/metrics';
import { rideProgress } from '../../src/coach/progress';
import type { RideMeta } from '../../src/ride-format/read';
import type { Sample } from '../../src/shared/sample';
import type { Session } from '../../src/shared/session';

const DAY = 86_400_000;
const meta: RideMeta = { rideId: 'r', profileId: 'p', sessionId: 's', startedAtMs: 0, status: 'finished' };
const samples = (powers: (number | null)[], targetW = 100): Sample[] => powers.map((powerW, i) => ({
  seq: i, wallClockMs: i * 1000, rideElapsedS: i + 1, powerW, cadenceRpm: 90, speedKph: null, hrBpm: null, targetW, gradePct: null, gear: null,
}));
const session = (durationS: number): Session => ({ id: 's', name: 'x', steps: [{ kind: 'erg', durationS, ftpFraction: 0.5, label: 'A' }] });
const summarize = (s: Sample[], withSession = true) => summarizeRide({ meta, samples: s, ftpW: 200, plannedS: s.length, ...(withSession ? { session: session(s.length) } : {}) });

describe('power curve', () => {
  test('holds the best mean power for each duration the ride is long enough for', () => {
    const { powerCurve } = summarize(samples([...Array(295).fill(100), ...Array(5).fill(400), ...Array(300).fill(100)]));
    expect(powerCurve).toEqual({ 5: 400, 60: 125, 300: 105 });
  });
  test('rides with many measurement errors do not count for the best values', () => {
    const rides = [
      { powerCurve: { 60: 200 } },
      { powerCurve: { 60: 900 }, suspectData: true },
      { powerCurve: { 60: 150, 300: 140 } },
      {},
    ] as unknown as RideSummary[];
    expect(bestPowers(rides)).toEqual({ 60: 200, 300: 140 });
  });
});

describe('time on target', () => {
  test('counts the seconds within 10 % of the target, without the 15 s after a change', () => {
    const powers = [...Array(115).fill(100), ...Array(100).fill(150)];
    expect(summarize(samples(powers)).onTargetPct).toBe(50);
  });
  test('a lost power signal is not the rider\'s fault', () => {
    expect(summarize(samples([...Array(100).fill(100), ...Array(100).fill(null)])).onTargetPct).toBe(100);
  });
  test('paused seconds do not count against the rider', () => {
    const s = samples(Array(100).fill(100));
    const paused = Array.from({ length: 50 }, (_, i): Sample => ({ ...s[99], seq: 100 + i, powerW: 0 }));
    expect(summarize([...s, ...paused]).onTargetPct).toBe(100);
  });
  test('is missing without a session or without power', () => {
    expect(summarize(samples(Array(100).fill(100)), false).onTargetPct).toBeUndefined();
    expect(summarize(samples(Array(100).fill(null))).onTargetPct).toBeUndefined();
  });
});

describe('load series', () => {
  const ride = (dayIndex: number, tss: number) => ({ startedAtMs: dayIndex * DAY, tss }) as RideSummary;
  test('has one point per day and ends with the values of the load model', () => {
    const series = loadSeries([ride(100, 70)], 102 * DAY, 84);
    expect(series.map((p) => p.dayMs)).toEqual([100 * DAY, 101 * DAY, 102 * DAY]);
    expect(series[0].fitness).toBeCloseTo(70 / 42);
    expect(series[0].fatigue).toBeCloseTo(10);
    expect(series[2].fatigue).toBeLessThan(series[0].fatigue);
  });
  test('shows only the last days but keeps counting the earlier ones', () => {
    const series = loadSeries([ride(0, 100)], 200 * DAY, 84);
    expect(series).toHaveLength(84);
    expect(series[0].dayMs).toBe(117 * DAY);
    expect(series[0].fitness).toBeGreaterThan(0);
  });
  test('is empty without rides', () => {
    expect(loadSeries([], 200 * DAY, 84)).toEqual([]);
  });
});

describe('own progress', () => {
  const base = (rideId: string, day: number, over: Partial<RideSummary> = {}): RideSummary => ({
    rideId, startedAtMs: day * DAY, status: 'finished', sessionId: 'x', sessionName: 'Locker', ftpW: 200, durationS: 1800,
    avgPowerW: 130, normalizedPowerW: 133, intensityFactor: 0.66, tss: 30, avgHrBpm: 140, maxHrBpm: 150, bestMinutePowerW: 140, completedFraction: 1, ...over,
  });
  test('same session, same watts, fewer beats', () => {
    const p = rideProgress(base('now', 10, { avgHrBpm: 136 }), [base('old', 3), base('now', 10, { avgHrBpm: 136 })]);
    expect(p).toMatchObject({ kind: 'lower-hr', bpm: 4, sameSession: true, comparedRideId: 'old' });
  });
  test('compares with the most recent comparable ride only', () => {
    const p = rideProgress(base('now', 10, { avgHrBpm: 136 }), [base('older', 1, { avgHrBpm: 150 }), base('old', 3, { avgHrBpm: 137 })]);
    expect(p?.comparedRideId).toBe('old');
    expect(p?.kind).toBe('same');
  });
  test('a differently named ride with the same character counts as similar', () => {
    const p = rideProgress(base('now', 10, { avgHrBpm: 130, sessionName: 'Andere' }), [base('old', 3)]);
    expect(p).toMatchObject({ kind: 'lower-hr', sameSession: false });
  });
  test('more watts at the same heart rate', () => {
    const p = rideProgress(base('now', 10, { avgPowerW: 145, normalizedPowerW: 148 }), [base('old', 3)]);
    expect(p).toMatchObject({ kind: 'more-power', watts: 15 });
  });
  test('a higher heart rate stays a neutral fact', () => {
    expect(rideProgress(base('now', 10, { avgHrBpm: 145 }), [base('old', 3)])).toMatchObject({ kind: 'higher-hr', bpm: 5 });
  });
  test.each<[string, Partial<RideSummary>]>([
    ['much shorter', { durationS: 600 }],
    ['much harder', { avgPowerW: 180, normalizedPowerW: 183 }],
    ['intervals against a steady ride', { normalizedPowerW: 150 }],
    ['many measurement errors', { suspectData: true }],
    ['aborted early', { status: 'aborted' }],
    ['no heart rate', { avgHrBpm: null }],
  ])('does not compare a ride that was %s', (_name, over) => {
    expect(rideProgress(base('now', 10), [base('old', 3, over)])).toBeNull();
    expect(rideProgress(base('now', 10, over), [base('old', 3)])).toBeNull();
  });
  test('never compares with a later ride or itself', () => {
    expect(rideProgress(base('now', 10), [base('now', 10), base('later', 12)])).toBeNull();
  });
});

describe('rides from before these values existed', () => {
  const setup = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-'));
    const ridesDir = path.join(root, 'rides'); const coachDir = path.join(root, 'coach');
    const rideId = 'ride-1-a';
    const dir = path.join(ridesDir, rideId);
    fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(coachDir);
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ rideId, profileId: 'p', sessionId: 's', startedAtMs: 1000, status: 'finished' }));
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ session: session(1000), ftpW: 200 }));
    fs.writeFileSync(path.join(dir, 'samples.jsonl'), samples(Array(1000).fill(100)).map((s) => JSON.stringify(s)).join('\n'));
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
    const coach = new Coach({ ridesDir, coachDir, ask: async () => ({}), nowMs: () => 5000 });
    return { coach, rideId };
  };
  test('get them once, without asking for a rating again', () => {
    const { coach, rideId } = setup();
    const profile = { id: 'p', name: 'A', ftpW: 200 };
    coach.scanRides([profile]);
    const s = coach.state('p');
    delete s.summaries[0].powerCurve; delete s.summaries[0].onTargetPct;
    s.awaitingFeedback = null;
    coach.scanRides([profile]);
    expect(s.summaries[0]).toMatchObject({ rideId, powerCurve: { 5: 100, 60: 100, 300: 100 }, onTargetPct: 100 });
    expect(s.awaitingFeedback).toBeNull();
    expect(s.summaries).toHaveLength(1);
  });
});
