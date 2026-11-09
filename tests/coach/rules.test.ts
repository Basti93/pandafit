import { checkSession, type CoachContext } from '../../src/coach/session-limits';
import type { RideSummary } from '../../src/coach/metrics';
import { adjustSession, ftpFromRamp, rampTest, ruleBasedSession } from '../../src/coach/rules';
import type { Session } from '../../src/shared/session';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const past = (daysAgo: number, over: Partial<RideSummary> = {}): RideSummary => ({
  rideId: `r${daysAgo}`, startedAtMs: NOW - daysAgo * DAY, status: 'finished', sessionId: 's', ftpW: 200, durationS: 3600,
  avgPowerW: 130, normalizedPowerW: 140, intensityFactor: 0.7, tss: 60, avgHrBpm: 130, maxHrBpm: 150, bestMinutePowerW: 180, completedFraction: 1, ...over,
});
const ctx = (summaries: RideSummary[]): CoachContext => ({ ftpW: 200, summaries, nowMs: NOW });
const scenarios: [string, RideSummary[]][] = [
  ['no history', []],
  ['hard yesterday', [past(0.5, { intensityFactor: 0.95, tss: 90 })]],
  ['30 day break', [past(30)]],
  ['ridden daily', Array.from({ length: 14 }, (_, i) => past(i + 1))],
  ['heavy load', Array.from({ length: 10 }, (_, i) => past(i + 1, { tss: 120, intensityFactor: 0.84 }))],
  ['rested and fit', Array.from({ length: 12 }, (_, i) => past(i * 2 + 3))],
  ['weak short rides', [past(2, { tss: 5 })]],
];
test.each(scenarios)('rule session is always accepted by the guardrails: %s', (_n, s) => {
  const c = ctx(s);
  const r = checkSession(ruleBasedSession(c).session, c);
  expect(r).toMatchObject({ ok: true });
});
test.each(scenarios)('rule reasons never blame missed days: %s', (_n, s) => {
  expect(ruleBasedSession(ctx(s)).reason).not.toMatch(/verpasst|nachhol|versäum/i);
});
test('hard yesterday leads to something easy, rested leads to intervals', () => {
  const maxF = (x: Session) => Math.max(...x.steps.map((st) => (st.kind === 'erg' ? st.ftpFraction : 0)));
  expect(maxF(ruleBasedSession(ctx(scenarios[1][1])).session)).toBeLessThanOrEqual(0.75);
  expect(maxF(ruleBasedSession(ctx(scenarios[5][1])).session)).toBeGreaterThan(0.85);
});
test('ramp starts at 50 % FTP, rises 1 min per step and ends at 150 %', () => {
  const r = rampTest(200);
  expect(r.id).toBe('ramp-test');
  const ramp = r.steps.slice(1);
  const f = ramp.map((s) => (s.kind === 'erg' ? s.ftpFraction : 0));
  expect(f[0]).toBe(0.5);
  expect(f.at(-1)).toBeCloseTo(1.5);
  expect(ramp.every((s) => s.durationS === 60)).toBe(true);
  expect(f.every((x, i) => i === 0 || x > f[i - 1])).toBe(true);
});
test('ftp from ramp is 75 % of best minute', () => {
  expect(ftpFromRamp(past(1, { bestMinutePowerW: 240, completedFraction: 0.6 }))).toEqual({ ftpW: 180, hitCeiling: false });
});
test('reaching the top of the ramp is reported', () => {
  expect(ftpFromRamp(past(1, { bestMinutePowerW: 300, completedFraction: 1 })).hitCeiling).toBe(true);
});
test('ramp without power gives no new value', () => {
  expect(ftpFromRamp(past(1, { bestMinutePowerW: null })).ftpW).toBeNull();
});
const rested = ctx(scenarios[5][1]);
const base = ruleBasedSession(rested).session;
const mainF = (s: Session) => s.steps.filter((x, i) => i > 0 && x.kind === 'erg').map((x) => (x.kind === 'erg' ? x.ftpFraction : 0));
const total = (s: Session) => s.steps.reduce((a, b) => a + b.durationS, 0);
test('easier lowers the work and stays valid', () => {
  const e = adjustSession(base, 'easier', rested);
  expect(Math.max(...mainF(e))).toBeLessThan(Math.max(...mainF(base)));
  expect(checkSession(e, rested).ok).toBe(true);
});
test('harder raises the work and stays valid', () => {
  const h = adjustSession(base, 'harder', rested);
  expect(Math.max(...mainF(h))).toBeGreaterThan(Math.max(...mainF(base)));
  expect(checkSession(h, rested).ok).toBe(true);
});
test('shorter trims total time and keeps the warmup', () => {
  const s = adjustSession(base, 'shorter', rested);
  expect(total(s)).toBeLessThan(total(base));
  expect(s.steps[0]).toEqual(base.steps[0]);
  expect(checkSession(s, rested).ok).toBe(true);
});
test('harder stops at the guardrails', () => {
  let s = base;
  for (let i = 0; i < 20; i++) s = adjustSession(s, 'harder', rested);
  expect(checkSession(s, rested).ok).toBe(true);
});
test('ramp test cannot be adjusted', () => {
  expect(adjustSession(rampTest(200), 'easier', rested).id).toBe('ramp-test');
  expect(adjustSession(rampTest(200), 'easier', rested).steps).toHaveLength(rampTest(200).steps.length);
});

test('a beginner with only one ride gets no intervals', () => {
  const s = ruleBasedSession(ctx([past(2.5, { sessionId: 'ramp-test', intensityFactor: 0.75, tss: 30, durationS: 900 })]));
  expect(s.session.steps.every((x) => x.kind === 'erg' && x.ftpFraction <= 0.75)).toBe(true);
});

test('ramp test starts with a five minute warmup', () => {
  const s = rampTest(200);
  expect(s.steps[0]).toMatchObject({ kind: 'erg', durationS: 300, label: 'Warmup' });
  expect(s.steps[1].label).toBe('Rampe 50 %');
});
