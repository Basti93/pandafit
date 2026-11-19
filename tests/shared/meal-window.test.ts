process.env.TZ = 'Europe/Berlin'; // the clock-change case must cross a real change on any machine
import { describe, expect, it } from 'vitest';
import { addDays, listStart, mealOver, splitByWeek, windowMeals, type PlanWeek } from '../../src/shared/meal-window';
import type { Dish, Meal, Slot } from '../../src/shared/meals';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime(); // 19.11.2026 is a Thursday
const dish: Dish = { title: 'X', ingredients: [], steps: [], minutes: 5, proteinG: 20, keepsDays: 0, source: 'liste' };
const meal = (day: number, slot: Slot): Meal => ({ day, slot, dish, reuseOf: null, eaters: ['max'], takeAlong: false });
const pw = (week: string, meals: Meal[]): PlanWeek => ({ plan: { week, createdMs: 0, source: 'liste', people: [{ id: 'max', name: 'Max' }], meals, trainingDays: [] }, state: { eaters: {}, items: {} } });
const all = (day: number) => (['fruehstueck', 'mittag', 'abend'] as const).map((s) => meal(day, s));
const weeks = [pw('2026-11-16', [...all(3), ...all(4)]), pw('2026-11-23', [...all(0), ...all(1), ...all(2), ...all(3)])];

describe('meal window', () => {
  it('adds days across Sunday and across the end of summer time', () => {
    expect(addDays({ week: '2026-11-16', day: 6 }, 1)).toEqual({ week: '2026-11-23', day: 0 });
    expect(addDays({ week: '2026-10-19', day: 6 }, 1)).toEqual({ week: '2026-10-26', day: 0 });
    expect(addDays({ week: '2026-11-16', day: 3 }, 7)).toEqual({ week: '2026-11-23', day: 3 });
    expect(addDays({ week: '2026-10-19', day: 2 }, 7)).toEqual({ week: '2026-10-26', day: 2 });
  });
  it('splits a range into week parts', () => {
    expect(splitByWeek({ week: '2026-11-16', day: 4 }, { week: '2026-11-23', day: 3 }))
      .toEqual([{ week: '2026-11-16', fromDay: 4, toDay: 7 }, { week: '2026-11-23', fromDay: 0, toDay: 4 }]);
    expect(splitByWeek({ week: '2026-11-23', day: 1 }, { week: '2026-11-23', day: 0 })).toEqual([]);
  });
  it('a meal is over two hours after its time', () => {
    expect(mealOver('abend', at(19, 20, 59))).toBe(false);
    expect(mealOver('abend', at(19, 21))).toBe(true);
  });
  it('the list starts tomorrow once the last meal of today is over', () => {
    expect(listStart(weeks, at(19, 20))).toEqual({ week: '2026-11-16', day: 3 });
    expect(listStart(weeks, at(19, 21))).toEqual({ week: '2026-11-16', day: 4 });
    expect(listStart([], at(19, 21))).toEqual({ week: '2026-11-16', day: 4 });
  });
  it('window meals: today only what is not over, then six more days', () => {
    const keys = windowMeals(weeks, at(19, 16)).map((x) => `${x.at.week}/${x.meal.day}-${x.meal.slot}`);
    expect(keys[0]).toBe('2026-11-16/3-abend');
    expect(keys).toContain('2026-11-23/2-abend');
    expect(keys.some((k) => k.startsWith('2026-11-23/3-'))).toBe(false);
  });
});
