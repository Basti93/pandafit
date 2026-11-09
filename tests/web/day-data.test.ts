import { describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { mealDayOf } from '../../src/web/MealsScreen';

const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
const dish = { title: 'Linsen', ingredients: [], steps: [], minutes: 20, proteinG: 20, keepsDays: 1, source: 'liste' };
const week = (monday: string): TrackedRecord => ({ kind: 'mealplan', id: `week-${monday}`, updatedMs: 1, deleted: false, body: { week: monday, createdMs: 1, source: 'liste', people: [], trainingDays: [], meals: [{ day: 0, slot: 'mittag', dish, reuseOf: null, eaters: [] }] } });

describe('mealDayOf', () => {
  const dayBefore = (ms: number) => { const d = new Date(ms); d.setDate(d.getDate() - 1); return d.getTime(); };
  const dayAfter = (ms: number) => { const d = new Date(ms); d.setDate(d.getDate() + 1); return d.getTime(); };
  it('finds last week for yesterday on a Monday', () => {
    const monday = at(9, 12); // Monday 9 Nov 2026
    expect(new Date(monday).getDay()).toBe(1);
    const r = mealDayOf([week('2026-11-02'), week('2026-11-09')], dayBefore(monday))!;
    expect(r.week.plan.week).toBe('2026-11-02');
    expect(r.day).toBe(6);
    expect(mealDayOf([week('2026-11-09')], dayBefore(monday))).toBeNull();
  });
  it('finds next week for tomorrow on a Sunday', () => {
    const sunday = at(8, 12); // Sunday 8 Nov 2026
    expect(new Date(sunday).getDay()).toBe(0);
    const r = mealDayOf([week('2026-11-02'), week('2026-11-09')], dayAfter(sunday))!;
    expect(r.week.plan.week).toBe('2026-11-09');
    expect(r.day).toBe(0);
    expect(mealDayOf([week('2026-11-02')], dayAfter(sunday))).toBeNull();
  });
  it('is null without a record', () => {
    expect(mealDayOf(null, at(4, 12))).toBeNull();
    expect(mealDayOf([], at(4, 12))).toBeNull();
  });
});
