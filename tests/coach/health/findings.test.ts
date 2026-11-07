import { describe, expect, it } from 'vitest';
import { daysOf, weeksOf } from '../../../src/coach/health/aggregate';
import { findingsOf } from '../../../src/coach/health/findings';
import type { GarminDay } from '../../../src/shared/garmin';
import { addDays, mondayOf } from '../../../src/shared/week-plan';
import { dateKey } from '../../../src/shared/day-rating';
import { policyRule } from '../../../src/shared/training-policy';

// Wed 4 Nov 2026, noon local. The last complete ISO week starts on Mon 26 Oct.
const NOW = new Date(2026, 10, 4, 12).getTime();
const TODAY = dateKey(NOW);
const day = (date: string, over: Partial<GarminDay> = {}): GarminDay => ({
  date, restingHrBpm: null, hrvMs: null, sleepS: null, deepS: null, remS: null, sleepScore: null, bodyBatteryMax: null, stressAvg: null,
  vo2max: null, steps: null, readinessScore: null, acuteLoad: null, recoveryHours: null, intensityMin: null, ...over,
});
/** `n` days ending `endBack` days before today, each with the pulse from `rhr(i)` (i = 0 is the oldest). */
const pulses = (n: number, rhr: (i: number) => number, endBack = 0): GarminDay[] =>
  Array.from({ length: n }, (_, i) => day(addDays(TODAY, -(n - 1 - i) - endBack), { restingHrBpm: rhr(i) }));
const none: { birthDate: string | null } = { birthDate: null };
const run = (days: GarminDay[], profile: { birthDate: string | null } = none, workouts: { startMs: number }[] = []) => findingsOf(days, weeksOf(days, workouts, NOW), profile, NOW);
const rules = (days: GarminDay[], profile?: { birthDate: string | null }, workouts?: { startMs: number }[]) => run(days, profile, workouts).map((f) => f.rule);

describe('resting pulse findings', () => {
  const calm = (n: number) => pulses(n, () => 55);
  it('raised on 2 days in a row, not on 1', () => {
    const two = [...pulses(30, () => 55), ...pulses(2, () => 60)].map((d, i, all) => ({ ...d, date: addDays(TODAY, -(all.length - 1 - i)) }));
    const one = [...pulses(31, () => 55), ...pulses(1, () => 60)].map((d, i, all) => ({ ...d, date: addDays(TODAY, -(all.length - 1 - i)) }));
    expect(rules(two)).toContain('health.rhr-raised');
    expect(rules(one)).not.toContain('health.rhr-raised');
    expect(run(two)[0]!.text).not.toMatch(/du hast/i);
  });
  it('persists: 7 days at +10 gives the doctor tone, 6 days does not', () => {
    const make = (high: number) => [...pulses(30, () => 55), ...pulses(high, () => 65)].map((d, i, all) => ({ ...d, date: addDays(TODAY, -(all.length - 1 - i)) }));
    const f = run(make(7)).find((x) => x.rule === 'health.rhr-persist')!;
    expect(f.tone).toBe('arzt');
    expect(f.text).toContain('ärztlich abklären');
    expect(rules(make(6))).not.toContain('health.rhr-persist');
    // +9 on all 7 days is below the line
    const nine = [...pulses(30, () => 55), ...pulses(7, () => 64)].map((d, i, all) => ({ ...d, date: addDays(TODAY, -(all.length - 1 - i)) }));
    expect(rules(nine)).not.toContain('health.rhr-persist');
  });
  it('persist needs a baseline and a full week of data', () => {
    expect(rules(pulses(7, () => 90))).not.toContain('health.rhr-persist');
    const gap = [...pulses(30, () => 55), ...pulses(7, () => 70)].map((d, i, all) => ({ ...d, date: addDays(TODAY, -(all.length - 1 - i)) })).filter((d) => d.date !== addDays(TODAY, -3));
    expect(rules(gap)).not.toContain('health.rhr-persist');
  });
  it('high: over 100 on 3 of the last 7 days, 2 do not count, exactly 100 does not count', () => {
    const make = (values: number[]) => calm(20).concat(values.map((v) => day('', { restingHrBpm: v }))).map((d, i, all) => ({ ...d, date: addDays(TODAY, -(all.length - 1 - i)) }));
    const three = run(make([101, 55, 102, 55, 55, 103, 55])).find((f) => f.rule === 'health.rhr-high')!;
    expect(three.tone).toBe('arzt');
    expect(three.text).toContain('ärztlich abklären');
    expect(rules(make([101, 55, 102, 55, 55, 55, 55]))).not.toContain('health.rhr-high');
    expect(rules(make([100, 100, 100, 55, 55, 55, 55]))).not.toContain('health.rhr-high');
  });
  it('old data gives no current finding', () => {
    expect(rules(pulses(10, () => 120, 5))).not.toContain('health.rhr-high');
  });
  it('long-term trend as a sentence only with enough months and a 3 bpm change', () => {
    const monthly = (from: number, to: number) => Array.from({ length: 30 }, (_, i) => day(addDays(TODAY, -i * 7), { restingHrBpm: Math.round(to + ((from - to) * i) / 29) }));
    const down = run(monthly(62, 55)).find((f) => f.rule === 'health.rhr-longterm')!;
    expect(down.text).toContain('gesunken');
    expect(run(monthly(55, 62)).find((f) => f.rule === 'health.rhr-longterm')!.text).toContain('gestiegen');
    expect(rules(monthly(57, 55))).not.toContain('health.rhr-longterm');
    expect(rules(monthly(62, 55).slice(0, 10))).not.toContain('health.rhr-longterm');
  });
});

describe('VO2max trend', () => {
  const series = (weeksBack: number, start: number, end: number) => Array.from({ length: weeksBack + 1 }, (_, i) =>
    day(addDays(TODAY, -(weeksBack - i) * 7), { vo2max: i < weeksBack / 2 ? start : end }));
  it('needs 8 weeks and 2 ml/kg/min', () => {
    expect(run(series(8, 50, 52)).find((f) => f.rule === 'health.vo2-trend')!.tone).toBe('gut');
    expect(run(series(8, 52, 50)).find((f) => f.rule === 'health.vo2-trend')!.text).toContain('gesunken');
    expect(rules(series(8, 50, 51.8))).not.toContain('health.vo2-trend');
    expect(rules(series(5, 50, 54))).not.toContain('health.vo2-trend');
  });
  it('never states an absolute assessment', () => {
    for (const f of run(series(8, 40, 44))) expect(f.text).not.toMatch(/ml\/kg|sehr gut|schlecht|VO/);
  });
});

describe('daily life: steps and WHO minutes', () => {
  // The last complete week is Mon 26 Oct to Sun 1 Nov.
  const week = (steps: number | null, intensity: number | null, count = 7) => Array.from({ length: count }, (_, i) => day(addDays('2026-10-26', i), { steps, intensityMin: intensity === null ? null : Math.round(intensity / count) }));
  const stepsOf = (days: GarminDay[], profile = none) => run(days, profile).find((f) => f.rule === 'health.steps-band');
  it('compares to the under-60 band without age and to the 60+ band with age', () => {
    expect(stepsOf(week(7000, null))!.tone).toBe('info');
    expect(stepsOf(week(7000, null))!.text).toContain('8.000 bis 10.000');
    expect(stepsOf(week(7000, null), { birthDate: '1960-01-01' })!.tone).toBe('gut');
    expect(stepsOf(week(7000, null), { birthDate: '1960-01-01' })!.text).toContain('6.000 bis 8.000');
    expect(stepsOf(week(7000, null), { birthDate: '1990-05-05' })!.tone).toBe('info');
  });
  it('praises nothing above the band, and the band edges are inside', () => {
    expect(stepsOf(week(9000, null))!.tone).toBe('gut');
    expect(stepsOf(week(8000, null))!.tone).toBe('gut');
    expect(stepsOf(week(10000, null))!.tone).toBe('gut');
    expect(stepsOf(week(12000, null))).toBeUndefined();
  });
  it('needs enough measured days in the week', () => {
    expect(stepsOf(week(3000, null, 3))).toBeUndefined();
  });
  it('counts WHO minutes (vigorous already doubled in the day)', () => {
    const low = run(week(null, 140)).find((f) => f.text.includes('Minuten'))!;
    expect(low.tone).toBe('info');
    expect(low.text).toContain('weniger ist trotzdem sinnvoll');
    expect(run(week(null, 154)).find((f) => f.text.includes('Minuten'))!.tone).toBe('gut');
  });
  it('counts strength days from the workouts, once per day', () => {
    const at = (date: string, h = 18) => ({ startMs: new Date(`${date}T${String(h).padStart(2, '0')}:00:00`).getTime() });
    const one = run(week(8500, 160), none, [at('2026-10-27'), at('2026-10-27', 20)]);
    expect(one.find((f) => f.text.includes('Muskel'))!.text).toContain('war es ein Tag');
    const two = run(week(8500, 160), none, [at('2026-10-27'), at('2026-10-29')]);
    expect(two.find((f) => f.text.includes('Muskel'))!.tone).toBe('gut');
    expect(run(week(8500, 160)).find((f) => f.text.includes('Muskel'))!.text).toContain('keinen');
  });
  it('says nothing about strength without other data for the week', () => {
    expect(run([], none, [{ startMs: new Date('2026-10-27T18:00:00').getTime() }])).toEqual([]);
  });
});

describe('general', () => {
  it('missing data gives no finding at all', () => {
    expect(run([])).toEqual([]);
    expect(run([day(TODAY)])).toEqual([]);
  });
  it('puts the doctor tone first and never diagnoses, never uses Body Battery or stress', () => {
    const days = [...pulses(30, () => 55), ...pulses(7, () => 105)].map((d, i, all) => ({ ...d, date: addDays(TODAY, -(all.length - 1 - i)), bodyBatteryMax: 3, stressAvg: 99 }));
    const f = run(days);
    expect(f[0]!.tone).toBe('arzt');
    for (const x of f) {
      expect(x.text).not.toMatch(/du hast|Diagnose|Erkrankung|Infektion|Herzrhythmus|Body Battery|Stress/i);
      expect(() => policyRule(x.rule)).not.toThrow();
      expect(policyRule(x.rule).sourceIds.length).toBeGreaterThan(0);
    }
  });
  it('aggregates 52 ISO weeks and 28 days', () => {
    const days = Array.from({ length: 400 }, (_, i) => day(addDays(TODAY, -i), { restingHrBpm: 50 + (i % 3), steps: 1000, sleepS: 7 * 3600 }));
    const weeks = weeksOf(days, [], NOW);
    expect(weeks).toHaveLength(52);
    expect(weeks.at(-1)!.week).toBe(mondayOf(TODAY));
    expect(weeks[0]!.week).toBe(addDays(mondayOf(TODAY), -51 * 7));
    expect(weeks[10]!).toMatchObject({ steps: 1000, sleepH: 7, strengthDays: 0 });
    expect(daysOf(days, NOW)).toHaveLength(28);
  });
});
