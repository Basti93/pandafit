import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '../../src/shared/activities';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';
import type { PlanDay } from '../../src/shared/week-plan';
import { complaintsOpenIn, finisherOf, FINISHER_WINDOW_MS, latestFinishedStrength } from '../../src/tracking/ui/finisher';

const NOON = new Date(2026, 10, 8, 12).getTime();
const MIN = 60_000;
const w = (over: Partial<LoggedWorkout> = {}): LoggedWorkout => ({ id: 'w', title: 'Beine', startMs: NOON - 50 * MIN, endMs: NOON, source: 'pandafit', exercises: [], ...over });
const base = (over: Record<string, unknown> = {}) => ({ workout: w(), nowMs: NOON + MIN, today: null as PlanDay | null, activities: [] as ActivityItem[], complaintsOpen: false, ...over });
const act = (kind: ActivityItem['kind'], startMs: number): ActivityItem => ({ key: `${kind}-${startMs}`, kind, title: null, sport: null, startMs, minutes: 30, distanceM: null, avgHr: null, ref: null });
const day = (over: Partial<PlanDay> = {}): PlanDay => ({ date: '2026-11-08', sport: 'gym', hardness: 'moderate', fixed: false, ...over });

describe('finisherOf', () => {
  it('is null for an open workout and after the window', () => {
    expect(finisherOf(base({ workout: w({ endMs: null }) }))).toBeNull();
    expect(finisherOf(base({ nowMs: NOON + FINISHER_WINDOW_MS + MIN }))).toBeNull();
    expect(finisherOf(base({ nowMs: NOON + FINISHER_WINDOW_MS }))).not.toBeNull();
  });
  it('plain case: cardio and stretching, no reason', () => {
    expect(finisherOf(base())).toEqual({ cardio: true, stretch: true, reason: null });
  });
  it('a ride or run today drops the cardio', () => {
    for (const k of ['rad', 'lauf'] as const) expect(finisherOf(base({ activities: [act(k, NOON + 30 * MIN)] }))).toEqual({ cardio: false, stretch: true, reason: 'Heute reicht Dehnen.' });
  });
  it('an activity of yesterday does not count', () => {
    expect(finisherOf(base({ activities: [act('rad', NOON - 24 * 3_600_000)] }))?.cardio).toBe(true);
  });
  it('a kraft activity does not count', () => {
    expect(finisherOf(base({ activities: [act('kraft', NOON - 50 * MIN)] }))?.cardio).toBe(true);
  });
  it('cardio in the plan for today drops the cardio', () => {
    expect(finisherOf(base({ today: day({ also: { sport: 'run', hardness: 'easy' } }) }))?.cardio).toBe(false);
    expect(finisherOf(base({ today: day({ sport: 'bike' }) }))?.cardio).toBe(false);
    expect(finisherOf(base({ today: day() }))?.cardio).toBe(true);
  });
  it('an open complaint drops the cardio', () => {
    expect(finisherOf(base({ complaintsOpen: true }))?.cardio).toBe(false);
  });
  it('a long workout drops the cardio', () => {
    expect(finisherOf(base({ workout: w({ startMs: NOON - 80 * MIN }) }))?.cardio).toBe(false);
    expect(finisherOf(base({ workout: w({ startMs: NOON - 75 * MIN }) }))?.cardio).toBe(false);
    expect(finisherOf(base({ workout: w({ startMs: NOON - 74 * MIN }) }))?.cardio).toBe(true);
  });
});

const rec = (id: string, body: Partial<LoggedWorkout>, deleted = false): TrackedRecord => ({ kind: 'workout', id, updatedMs: 1, deleted, body: w(body) });
describe('latestFinishedStrength', () => {
  it('takes the newest of two finished today', () => {
    expect(latestFinishedStrength([rec('a', { endMs: NOON - 3_600_000 }), rec('b', { endMs: NOON })], NOON + MIN)?.id).toBe('b');
  });
  it('ignores deleted, open and yesterday', () => {
    const list = [rec('d', { endMs: NOON }, true), rec('o', { endMs: null }), rec('y', { endMs: NOON - 24 * 3_600_000 }), rec('ok', { endMs: NOON - 3_600_000 })];
    expect(latestFinishedStrength(list, NOON + MIN)?.id).toBe('ok');
    expect(latestFinishedStrength(list.slice(0, 3), NOON + MIN)).toBeNull();
    expect(latestFinishedStrength(null, NOON)).toBeNull();
  });
});

describe('complaintsOpenIn', () => {
  const c = (status: string, deleted = false): TrackedRecord => ({ kind: 'complaint', id: status, updatedMs: 1, deleted, body: { text: 'Knie', status } });
  it('is true for a complaint that is not over', () => {
    expect(complaintsOpenIn([c('over')])).toBe(false);
    expect(complaintsOpenIn([c('active', true)])).toBe(false);
    expect(complaintsOpenIn([c('active')])).toBe(true);
    expect(complaintsOpenIn(null)).toBe(false);
  });
});
