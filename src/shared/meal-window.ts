/**
 * The rolling window of days over the per-week plan records. Pure day arithmetic, by date keys and never by "+ 24 h",
 * so a week edge or a night with a clock change cannot skip or repeat a day. Shared by the coach and the web app.
 */
import { addWeeks, dateKey, dateOf, dayIndex, SLOT_TIME, SLOTS, weekOf, type Meal, type MealPlan, type MealState, type Slot } from './meals';

export type DayRef = { week: string; day: number };
export type PlanWeek = { plan: MealPlan; state: MealState };

/** Bo keeps the days through `today + FILL_DAYS` planned. */
export const FILL_DAYS = 7;
/** A meal of today counts as "dran" until two hours after its time. */
export const MEAL_OVER_MS = 2 * 3_600_000;

export const dayRefOf = (ms: number): DayRef => ({ week: weekOf(ms), day: dayIndex(ms) });

export function addDays(ref: DayRef, n: number): DayRef {
  const total = ref.day + n;
  const weeks = Math.floor(total / 7);
  return { week: weeks === 0 ? ref.week : addWeeks(ref.week, weeks), day: total - weeks * 7 };
}

export const dayKeyOf = (ref: DayRef): string => dateKey(dateOf(ref.week, ref.day));
export const cmpRef = (a: DayRef, b: DayRef): number => a.week.localeCompare(b.week) || a.day - b.day;

export function mealOver(slot: Slot, nowMs: number): boolean {
  const [h, m] = SLOT_TIME[slot].split(':').map(Number);
  const at = new Date(nowMs);
  at.setHours(h!, m!, 0, 0);
  return nowMs >= at.getTime() + MEAL_OVER_MS;
}

/** `to` is inclusive, `toDay` is exclusive. Empty when `from` lies after `to`. */
export function splitByWeek(from: DayRef, to: DayRef): { week: string; fromDay: number; toDay: number }[] {
  const out: { week: string; fromDay: number; toDay: number }[] = [];
  if (cmpRef(from, to) > 0) return out;
  for (let week = from.week; week <= to.week; week = addWeeks(week, 1)) {
    out.push({ week, fromDay: week === from.week ? from.day : 0, toDay: week === to.week ? to.day + 1 : 7 });
  }
  return out;
}

/** Today until its last planned meal is over (without a meal today: until dinner is over), then tomorrow. */
export function listStart(weeks: PlanWeek[], nowMs: number): DayRef {
  const today = dayRefOf(nowMs);
  const meals = weeks.find((w) => w.plan.week === today.week)?.plan.meals.filter((m) => m.day === today.day) ?? [];
  const last = SLOTS.filter((s) => meals.some((m) => m.slot === s)).pop() ?? 'abend';
  return mealOver(last, nowMs) ? addDays(today, 1) : today;
}

export function windowMeals(weeks: PlanWeek[], nowMs: number, days = 7): { week: PlanWeek; meal: Meal; at: DayRef }[] {
  const start = listStart(weeks, nowMs);
  const end = addDays(start, days - 1);
  const today = dayRefOf(nowMs);
  const out: { week: PlanWeek; meal: Meal; at: DayRef }[] = [];
  for (const week of weeks) {
    for (const meal of week.plan.meals) {
      const at = { week: week.plan.week, day: meal.day };
      if (cmpRef(at, start) < 0 || cmpRef(at, end) > 0) continue;
      if (cmpRef(at, today) === 0 && mealOver(meal.slot, nowMs)) continue;
      out.push({ week, meal, at });
    }
  }
  return out.sort((a, b) => cmpRef(a.at, b.at) || SLOTS.indexOf(a.meal.slot) - SLOTS.indexOf(b.meal.slot));
}
