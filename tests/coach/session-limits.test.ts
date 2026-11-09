import { checkSession, tssCap, type CoachContext } from '../../src/coach/session-limits';
import type { RideSummary } from '../../src/coach/metrics';
import type { Session, Step } from '../../src/shared/session';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const past = (daysAgo: number, over: Partial<RideSummary> = {}): RideSummary => ({
  rideId: `r${daysAgo}`, startedAtMs: NOW - daysAgo * DAY, status: 'finished', sessionId: 's', ftpW: 200, durationS: 3600,
  avgPowerW: 130, normalizedPowerW: 140, intensityFactor: 0.7, tss: 60, avgHrBpm: 130, maxHrBpm: 150, bestMinutePowerW: 180, completedFraction: 1, ...over,
});
const ctx = (summaries: RideSummary[] = [past(3), past(6)]): CoachContext => ({ ftpW: 200, summaries, nowMs: NOW });
const warm: Step = { kind: 'erg', durationS: 600, ftpFraction: 0.5, label: 'Warmup' };
const session = (...steps: Step[]): Session => ({ id: 'x', name: 'x', steps });
const erg = (min: number, f: number): Step => ({ kind: 'erg', durationS: min * 60, ftpFraction: f, label: 'A' });
const interval = session(warm, ...Array.from({ length: 4 }, () => [erg(4, 0.95), erg(3, 0.5)]).flat());

test('accepts a sensible session', () => expect(checkSession(interval, ctx()).ok).toBe(true));
test.each([
  ['no warmup', session(erg(30, 0.9))],
  ['warmup too short', session(erg(2, 0.5), erg(30, 0.6))],
  ['200 % FTP', session(warm, erg(1, 2))],
  ['5 minutes above 105 %', session(warm, erg(5, 1.1))],
  ['20 minutes above 95 %', session(warm, erg(20, 0.97))],
  ['3 hours', session(warm, erg(170, 0.5))],
  ['under 10 minutes', session({ ...warm, durationS: 300 }, erg(1, 0.5))],
  ['40 minutes above 90 %', session(warm, erg(19, 0.92), erg(2, 0.5), erg(19, 0.92), erg(2, 0.5), erg(2, 0.92))],
  ['grade 25 %', session(warm, { kind: 'grade', durationS: 600, gradePct: 25, scale: 1, label: 'B' })],
  ['scale 3', session(warm, { kind: 'grade', durationS: 600, gradePct: 5, scale: 3, label: 'B' })],
])('rejects %s', (_name, s) => expect(checkSession(s, ctx()).ok).toBe(false));
test('rejects malformed input instead of throwing', () => {
  expect(checkSession({ steps: 'x' }, ctx()).ok).toBe(false);
  expect(checkSession(null, ctx()).ok).toBe(false);
});
test('the reserved ramp id is refused from outside', () => {
  expect(checkSession({ ...interval, id: 'ramp-test' }, ctx()).ok).toBe(false);
});
test('after a hard ride yesterday only easy sessions pass', () => {
  const c = ctx([past(0.5, { intensityFactor: 0.9 })]);
  expect(checkSession(interval, c).ok).toBe(false);
  expect(checkSession(session(warm, erg(30, 0.7)), c).ok).toBe(true);
});
test('first ride without history allows only gentle sessions', () => {
  const c = ctx([]);
  expect(checkSession(interval, c).ok).toBe(false);
  expect(checkSession(session(warm, erg(60, 0.6)), c).ok).toBe(false);
  expect(checkSession(session(warm, erg(30, 0.65)), c).ok).toBe(true);
});
test('after a 14 day break only gentle sessions pass', () => {
  expect(checkSession(interval, ctx([past(20)])).ok).toBe(false);
});
test('estimated load may not exceed 1.5 times the strongest recent ride', () => {
  const c = ctx([past(2, { tss: 40 })]);
  expect(checkSession(session(warm, erg(100, 0.7)), c).ok).toBe(false);
});

test('climbs count as hard work, weekly load and 48 hours are enforced', () => {
  const steep: Session = { id: 's', name: 'S', steps: [
    { kind: 'erg', durationS: 300, ftpFraction: 0.5, label: 'W' },
    { kind: 'grade', durationS: 1200, gradePct: 12, scale: 1, label: 'Wand' },
  ] };
  const ride = (hoursAgo: number, over: object = {}) => past(hoursAgo / 24, over as Partial<RideSummary>);
  const regular = { ftpW: 200, nowMs: NOW, summaries: [ride(24 * 3, { intensityFactor: 0.6, tss: 30 })] };
  expect(checkSession(steep, regular).ok).toBe(false);
  const easy: Session = { ...steep, steps: [steep.steps[0], { kind: 'grade', durationS: 1200, gradePct: 7, scale: 1, label: 'Berg' }] };
  expect(checkSession(easy, { ...regular, summaries: [ride(40, { intensityFactor: 0.9, tss: 30 })] }).ok).toBe(false);
  expect(tssCap({ ...regular, summaries: [ride(24, { tss: 290, intensityFactor: 0.6 })] })).toBe(25);
});

