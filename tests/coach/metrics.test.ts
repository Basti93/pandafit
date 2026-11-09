import { cleanSamples, loadModel, summarizeRide, type RideSummary } from '../../src/coach/metrics';
import type { RideMeta } from '../../src/ride-format/read';
import type { Sample } from '../../src/shared/sample';

const meta: RideMeta = { rideId: 'r', profileId: 'p', sessionId: 's', startedAtMs: 0, status: 'finished' };
const samples = (powers: (number | null)[]): Sample[] => powers.map((p, i) => ({ seq: i, wallClockMs: i * 1000, rideElapsedS: i + 1, powerW: p, cadenceRpm: 90, speedKph: 30, hrBpm: p === null ? null : 130 + (i % 3), targetW: p, gradePct: null, gear: null }));
const summary = (powers: (number | null)[], plannedS = powers.length, m = meta) => summarizeRide({ meta: m, samples: samples(powers), ftpW: 200, plannedS });
const DAY = 86_400_000;
const ride = (dayMs: number, tss = 60): RideSummary => ({ ...summary([100]), startedAtMs: dayMs, tss });

test('constant 200 W at FTP 200 for 1 h is about 100 TSS', () => {
  const s = summary(Array(3600).fill(200));
  expect(s.intensityFactor).toBeCloseTo(1, 2);
  expect(s.tss).toBeCloseTo(100, 0);
});
test('null power seconds do not count as zero power', () => {
  expect(summary([200, null, 200, null]).avgPowerW).toBe(200);
});
test('ride without any power has null metrics and 0 TSS', () => {
  const s = summary([null, null]);
  expect([s.avgPowerW, s.normalizedPowerW, s.intensityFactor, s.bestMinutePowerW]).toEqual([null, null, null, null]);
  expect(s.tss).toBe(0);
});
test('best minute power finds the strongest 60 s', () => {
  expect(summary([...Array(120).fill(100), ...Array(60).fill(300), ...Array(120).fill(100)]).bestMinutePowerW).toBe(300);
});
test('aborted ride at half has completedFraction 0.5', () => {
  const s = summary(Array(50).fill(100), 100, { ...meta, status: 'aborted' });
  expect(s.completedFraction).toBe(0.5);
  expect(s.status).toBe('aborted');
});
test('fitness decays over weeks without riding', () => {
  const rides = Array.from({ length: 20 }, (_, i) => ride(i * DAY));
  const soon = loadModel(rides, 20 * DAY);
  const later = loadModel(rides, 60 * DAY);
  expect(later.fitness).toBeLessThan(soon.fitness);
  expect(later.daysSinceLastRide).toBe(41);
  expect(later.ridesLast28d).toBe(0);
});
test('hard block produces fatigue above fitness, so form is negative', () => {
  expect(loadModel(Array.from({ length: 7 }, (_, i) => ride(i * DAY, 120)), 7 * DAY).form).toBeLessThan(0);
});
test('no rides gives zero load and null daysSinceLastRide', () => {
  expect(loadModel([], DAY)).toEqual({ fitness: 0, fatigue: 0, form: 0, last7dTss: 0, last28dTss: 0, ridesLast28d: 0, daysSinceLastRide: null });
});

const series = (powers: (number | null)[]) => powers.map((powerW, i) => ({ seq: i, wallClockMs: i * 1000, rideElapsedS: i + 1, powerW, cadenceRpm: 80, speedKph: 30, hrBpm: 140, targetW: 150, gradePct: null, gear: null }));
test('sensor faults are ignored, real zeros and sprints stay', () => {
  const faulty = series([...Array(120).fill(150), 3000, 1800, ...Array(120).fill(150)]);
  const r = summarizeRide({ meta: { rideId: 'r', profileId: 'p', sessionId: 's', startedAtMs: 0, status: 'finished' }, samples: faulty, ftpW: 200, plannedS: 242 });
  expect(r.bestMinutePowerW).toBe(150);
  const real = cleanSamples(series([...Array(30).fill(150), ...Array(20).fill(900), 0, 0, ...Array(30).fill(150)]));
  expect(real.removed).toBe(0);
  expect(real.samples[50].powerW).toBe(0);
});
test('ride with many faults is marked, intervals are counted against the plan', () => {
  const meta = { rideId: 'r', profileId: 'p', sessionId: 's', startedAtMs: 0, status: 'finished' as const };
  expect(summarizeRide({ meta, samples: series(Array(100).fill(9999)), ftpW: 200, plannedS: 100 }).suspectData).toBe(true);
  const session = { id: 's', name: 's', steps: [
    { kind: 'erg' as const, durationS: 60, ftpFraction: 0.5, label: 'W' },
    { kind: 'erg' as const, durationS: 60, ftpFraction: 1, label: 'H' },
    { kind: 'erg' as const, durationS: 60, ftpFraction: 1, label: 'H' },
  ] };
  const r = summarizeRide({ meta, samples: series([...Array(120).fill(200), ...Array(60).fill(120)]), ftpW: 200, plannedS: 180, session });
  expect(r).toMatchObject({ intervalsPlanned: 2, intervalsDone: 1 });
});


describe('heart rate in the summary', () => {
  const samples = (seconds: number, hr: (i: number) => number, power = 100): Sample[] => Array.from({ length: seconds }, (_, i) => ({ seq: i, wallClockMs: i * 1000, rideElapsedS: i + 1, powerW: power, cadenceRpm: 80, speedKph: 25, hrBpm: hr(i), targetW: power, gradePct: null, gear: null }));
  const meta = { rideId: 'r', profileId: 'p', sessionId: 's', startedAtMs: 0, status: 'finished' as const };
  const steady = { id: 's', name: 'x', steps: [{ kind: 'erg' as const, durationS: 1200, ftpFraction: 0.5, label: 'A' }] };
  test('counts minutes per zone and time in the target zone', () => {
    const r = summarizeRide({ meta, samples: samples(1200, () => 130), ftpW: 200, plannedS: 1200, session: steady, hrMaxBpm: 200 });
    expect(r.hrZoneMinutes).toEqual([0, 20, 0, 0, 0]);
    expect(r.hrTargetPct).toBe(100);
  });
  test('shows the heart rate rising at equal power', () => {
    const r = summarizeRide({ meta, samples: samples(1200, (i) => (i < 660 ? 120 : 132)), ftpW: 200, plannedS: 1200, session: steady, hrMaxBpm: 200 });
    expect(r.hrDriftPct).toBe(10);
  });
  test('short or changing rides have no drift value', () => {
    const r = summarizeRide({ meta, samples: samples(300, () => 130), ftpW: 200, plannedS: 300, session: { ...steady, steps: [{ ...steady.steps[0], durationS: 300 }] }, hrMaxBpm: 200 });
    expect(r.hrDriftPct).toBeUndefined();
  });
  test('measures how far the heart drops in the minute after a hard section', () => {
    const session = { id: 's', name: 'x', steps: [{ kind: 'erg' as const, durationS: 120, ftpFraction: 0.95, label: 'Hart' }, { kind: 'erg' as const, durationS: 120, ftpFraction: 0.4, label: 'Ruhe' }] };
    const r = summarizeRide({ meta, samples: samples(240, (i) => (i < 120 ? 170 : 170 - Math.min(i - 120, 60) / 2)), ftpW: 200, plannedS: 240, session, hrMaxBpm: 200 });
    expect(r.hrRecoveryBpm).toBe(30);
  });
  test('without a maximum there are no zones, the rest stays', () => {
    const r = summarizeRide({ meta, samples: samples(1200, () => 130), ftpW: 200, plannedS: 1200, session: steady });
    expect(r.hrZoneMinutes).toBeUndefined();
    expect(r.avgHrBpm).toBe(130);
  });
});
