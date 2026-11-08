import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '../../src/shared/activities';
import type { TrackedRecord } from '../../src/shared/records';
import { activitiesOn } from '../../src/web/today/day-data';
import { mealDayOf } from '../../src/web/MealsScreen';

const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
const item = (key: string, startMs: number): ActivityItem => ({ key, kind: 'rad', title: null, sport: null, startMs, minutes: 30, distanceM: null, avgHr: null, ref: null });
const dish = { title: 'Linsen', ingredients: [], steps: [], minutes: 20, proteinG: 20, keepsDays: 1, source: 'liste' };
const week = (monday: string): TrackedRecord => ({ kind: 'mealplan', id: `week-${monday}`, updatedMs: 1, deleted: false, body: { week: monday, createdMs: 1, source: 'liste', people: [], trainingDays: [], meals: [{ day: 0, slot: 'mittag', dish, reuseOf: null, eaters: [] }] } });

describe('activitiesOn', () => {
  it('keeps only the date, oldest first', () => {
    const merged = { known: true, items: [item('b', at(3, 18)), item('x', at(4, 8)), item('a', at(3, 7))] };
    expect(activitiesOn(merged, '2026-11-03')!.map((i) => i.key)).toEqual(['a', 'b']);
  });
  it('is empty when known and nothing happened, null when unknown', () => {
    expect(activitiesOn({ known: true, items: [] }, '2026-11-03')).toEqual([]);
    expect(activitiesOn({ known: false, items: [item('x', at(4, 8))] }, '2026-11-03')).toBeNull();
    expect(activitiesOn({ known: false, items: [item('a', at(3, 8))] }, '2026-11-03')!.length).toBe(1);
  });
});

describe('mealDayOf', () => {
  it('finds last week for yesterday on a Monday', () => {
    const r = mealDayOf([week('2026-11-02'), week('2026-11-09')], at(8, 12))!; // Sunday 8 Nov is in week 2026-11-02
    expect(r.week.plan.week).toBe('2026-11-02');
    expect(r.day).toBe(6);
    const mon = mealDayOf([week('2026-11-02')], at(2, 12) - 86_400_000 * 0 - 86_400_000)!; // Sunday 1 Nov
    expect(mon).toBeNull();
    expect(mealDayOf([week('2026-10-26')], at(1, 12))!.week.plan.week).toBe('2026-10-26');
  });
  it('finds next week for tomorrow on a Sunday', () => {
    const r = mealDayOf([week('2026-11-09')], at(9, 12))!;
    expect(r.week.plan.week).toBe('2026-11-09');
    expect(r.day).toBe(0);
  });
  it('is null without a record', () => {
    expect(mealDayOf(null, at(4, 12))).toBeNull();
    expect(mealDayOf([], at(4, 12))).toBeNull();
  });
});
