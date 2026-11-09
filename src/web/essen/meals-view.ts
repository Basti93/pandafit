/**
 * Everything the Essen pages say in words, and the small rules behind it (which meal is next, what to preselect).
 * Pure: no React, no clock of its own. The pages build no sentence from parts; they take it from here.
 */
import type { TrackedRecord } from '../../shared/records';
import {
  addWeeks, dateOf, dayIndex, DAY_LONG, DAY_SHORT, eatersOf, mealKey, parseMealKey, readMealPlan, readMealState, reusesOf, shoppingList,
  SLOT_LABEL, SLOT_TIME, SLOTS, stateRecordId, weekOf,
  type Meal, type MealPlan, type MealState, type Slot,
} from '../../shared/meals';
import { localDayKey } from '../../shared/dates';
import { longDateLabel, longDayOfKey } from '../../tracking/ui/labels';
import { cap, numberWord } from '../../tracking/ui/week-path';

export type Week = { plan: MealPlan; state: MealState };
export type MealAt = { week: string; meal: string };
export type MealRef = { week: Week; meal: Meal; when: 'heute' | 'morgen' | 'später' };

/** The plan of the week `ms` lies in (any week, also the previous and the next) and the day index; null without a readable plan. */
export function mealDayOf(records: TrackedRecord[] | null, ms: number): { week: Week; day: number } | null {
  const w = weekOf(ms);
  const rec = (records ?? []).find((r) => r.id === `week-${w}` && !r.deleted);
  const plan = rec ? readMealPlan(rec.body) : null;
  if (!plan) return null;
  const stateRec = (records ?? []).find((r) => r.id === stateRecordId(w) && !r.deleted);
  return { week: { plan, state: readMealState(stateRec?.body) }, day: dayIndex(ms) };
}

/** The readable plans of this and next week, from the account's records. */
export function mealWeeks(records: TrackedRecord[] | null, now: number): Week[] {
  const current = weekOf(now);
  return [current, addWeeks(current, 1)].flatMap((w) => {
    const rec = (records ?? []).find((r) => r.id === `week-${w}` && !r.deleted);
    const plan = rec ? readMealPlan(rec.body) : null;
    if (!plan) return [];
    const stateRec = (records ?? []).find((r) => r.id === stateRecordId(w) && !r.deleted);
    return [{ plan, state: readMealState(stateRec?.body) }];
  });
}

export const listAnd = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}` : names[0] ?? '');

// ---- Which meal is next ----

/** A meal of today counts as "dran" until two hours after its time. */
export const MEAL_OVER_MS = 2 * 3_600_000;

export function isOver(slot: Slot, nowMs: number): boolean {
  const [h, m] = SLOT_TIME[slot].split(':').map(Number);
  const at = new Date(nowMs);
  at.setHours(h!, m!, 0, 0);
  return nowMs >= at.getTime() + MEAL_OVER_MS;
}

const inSlotOrder = (meals: Meal[]): Meal[] => [...meals].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));

export function todayMeals(weeks: Week[], nowMs: number): { week: Week; meal: Meal; over: boolean }[] {
  const week = weeks.find((w) => w.plan.week === weekOf(nowMs));
  if (!week) return [];
  const day = dayIndex(nowMs);
  return inSlotOrder(week.plan.meals.filter((m) => m.day === day)).map((meal) => ({ week, meal, over: isOver(meal.slot, nowMs) }));
}

/** The day after `nowMs` as a week key and a day index; by key arithmetic, so a night with a clock change cannot skip or repeat a day. */
function tomorrowOf(nowMs: number): { week: string; day: number } {
  const week = weekOf(nowMs);
  const day = dayIndex(nowMs) + 1;
  return day > 6 ? { week: addWeeks(week, 1), day: 0 } : { week, day };
}

export function nextMeal(weeks: Week[], nowMs: number): MealRef | null {
  const now = todayMeals(weeks, nowMs).find((t) => !t.over);
  if (now) return { week: now.week, meal: now.meal, when: 'heute' };
  // Look forward day by day through the planned weeks; the first day with a meal wins ("morgen" only for the next day).
  const t = tomorrowOf(nowMs);
  const ahead = weeks
    .filter((w) => w.plan.week >= t.week)
    .flatMap((w) => w.plan.meals.map((meal) => ({ week: w, meal })))
    .filter(({ week, meal }) => week.plan.week > t.week || meal.day >= t.day)
    .sort((a, b) => a.week.plan.week.localeCompare(b.week.plan.week) || a.meal.day - b.meal.day || SLOTS.indexOf(a.meal.slot) - SLOTS.indexOf(b.meal.slot))[0];
  if (!ahead) return null;
  return { ...ahead, when: ahead.week.plan.week === t.week && ahead.meal.day === t.day ? 'morgen' : 'später' };
}

// ---- Times of day ----

export const slotHour = (slot: Slot): string => `${Number(SLOT_TIME[slot].split(':')[0])} Uhr`;
export const slotAt = (slot: Slot): string => `um ${slotHour(slot)}`;
export const slotKicker = (slot: Slot): string => `${SLOT_LABEL[slot]} · ${slotHour(slot)}`;
export const SLOT_TO: Record<Slot, string> = { fruehstueck: 'zum Frühstück', mittag: 'zum Mittagessen', abend: 'zum Abendessen' };
export const SLOT_WHEN: Record<Slot, string> = { fruehstueck: 'früh', mittag: 'mittags', abend: 'abends' };

// ---- The head of Essen ----

export const NEXT_PLAN = 'Der nächste Plan kommt am Samstagmorgen.';

export const headKicker = (nowMs: number, trainingDay: boolean): string => `${longDateLabel(nowMs)}${trainingDay ? ' · Trainingstag' : ''}`;

export function headSentence(today: { meal: Meal; over: boolean }[], next: MealRef | null): string {
  const nothing = today.length === 0 ? 'Heute ist nichts geplant.' : 'Für heute steht nichts mehr an.';
  if (!next) return `${nothing} ${NEXT_PLAN}`;
  const what = `um ${slotHour(next.meal.slot)} ${next.meal.dish.title}`;
  if (next.when === 'morgen') return `${nothing} Morgen gibt es ${what}.`;
  if (next.when === 'später') return `${nothing} Am ${DAY_LONG[next.meal.day]} gibt es ${what}.`;
  const over = today.filter((t) => t.over).map((t) => `das ${SLOT_LABEL[t.meal.slot]}`);
  const behind = over.length === 0 ? '' : `${cap(listAnd(over))} ${over.length > 1 ? 'liegen' : 'liegt'} hinter dir. `;
  return `${behind}Als Nächstes gibt es ${what}.`;
}

export const mealKicker = (r: MealRef): string =>
  `${r.when === 'heute' ? 'Jetzt dran' : r.when === 'morgen' ? 'Morgen' : DAY_LONG[r.meal.day]} · ${SLOT_LABEL[r.meal.slot]} ${slotAt(r.meal.slot)}`;

export function mealPageKicker(week: Week, meal: Meal, nowMs: number): string {
  const key = localDayKey(dateOf(week.plan.week, meal.day).getTime());
  const t = tomorrowOf(nowMs);
  const day = key === localDayKey(nowMs) ? 'heute' : key === localDayKey(dateOf(t.week, t.day).getTime()) ? 'morgen' : DAY_LONG[meal.day]!;
  return `${SLOT_LABEL[meal.slot]} · ${day} ${slotAt(meal.slot)}`;
}

// ---- A meal in words ----

const keepsText = (days: number): string => (days === 1 ? 'einen Tag' : `${numberWord(days)} Tage`);
const minutesText = (n: number): string => (n === 1 ? 'In 1 Minute' : `In ${n} Minuten`);
/** The days of the meals that eat the rest of `meal`, once each, in week order. */
const restDays = (week: Week, meal: Meal): string[] =>
  [...new Set(reusesOf(week.plan, mealKey(meal.day, meal.slot)).map((m) => m.day))].sort((a, b) => a - b).map((d) => DAY_LONG[d]!);

export function mealSentence(week: Week, meal: Meal): string {
  const source = meal.reuseOf ? parseMealKey(meal.reuseOf) : null;
  if (source) return source.day === meal.day ? 'Das kochst du schon vorher mit.' : `Das ist der Rest von ${DAY_LONG[source.day]}.`;
  const rest = restDays(week, meal);
  return `${minutesText(meal.dish.minutes)} fertig`
    + (meal.takeAlong ? ' und gut zum Mitnehmen' : '')
    + (rest.length > 0 ? `, und es reicht auch für ${listAnd(rest)}` : '')
    + (meal.dish.keepsDays > 0 ? `, und es hält sich ${keepsText(meal.dish.keepsDays)}` : '')
    + '.';
}

export const askedSentence = (week: Week, meal: Meal): string | null => {
  if (!meal.askedBy) return null;
  const name = week.plan.people.find((p) => p.id === meal.askedBy)?.name;
  return name ? `Auf Wunsch von ${name}.` : null;
};

export function rowSentence(week: Week, meal: Meal): string {
  const source = meal.reuseOf ? parseMealKey(meal.reuseOf) : null;
  if (source) return `Rest von ${DAY_LONG[source.day]}.`;
  const rest = restDays(week, meal);
  return rest.length > 0 ? `Reicht auch für ${listAnd(rest)}.` : `Etwa ${meal.dish.minutes} ${meal.dish.minutes === 1 ? 'Minute' : 'Minuten'}.`;
}

export const pastSentence = (slot: Slot): string => `War heute ${SLOT_WHEN[slot]} dran.`;

export const eatersLine = (names: string[]): string =>
  names.length === 0 ? 'Niemand isst mit' : names.length === 1 ? `${names[0]} isst mit` : `${listAnd(names)} essen mit`;

/** Who eats a meal, by name, for `eatersLine`. */
export const eaterNames = (week: Week, meal: Meal): string[] => {
  const ids = eatersOf(week.plan, week.state, mealKey(meal.day, meal.slot));
  return week.plan.people.filter((p) => ids.includes(p.id)).map((p) => p.name);
};

// ---- The week ----

export type DayRow = { week: Week; day: number; lead: string; dateLong: string; meal: Meal | null };

function dayRow(week: Week, day: number): DayRow {
  const date = dateOf(week.plan.week, day);
  const on = week.plan.meals.filter((m) => m.day === day);
  const meal = (['abend', 'mittag', 'fruehstueck'] as const).map((s) => on.find((m) => m.slot === s)).find(Boolean) ?? null;
  return { week, day, lead: `${DAY_SHORT[day]} ${date.getDate()}.`, dateLong: longDayOfKey(localDayKey(date.getTime())), meal };
}

export function restOfWeek(weeks: Week[], nowMs: number): DayRow[] {
  const week = weeks.find((w) => w.plan.week === weekOf(nowMs));
  if (!week) return [];
  return Array.from({ length: 6 - dayIndex(nowMs) }, (_, i) => dayRow(week, dayIndex(nowMs) + 1 + i));
}

export function nextWeekRows(weeks: Week[], nowMs: number): DayRow[] {
  const week = weeks.find((w) => w.plan.week === addWeeks(weekOf(nowMs), 1));
  return week ? Array.from({ length: 7 }, (_, i) => dayRow(week, i)) : [];
}

// ---- Shopping and the tiles ----

/** The week the shopping list shows first: from Saturday the next one if it exists, else the current one, else the first. */
export function shoppingWeek(weeks: Week[], nowMs: number): Week | undefined {
  const current = weekOf(nowMs);
  return (dayIndex(nowMs) >= 5 && weeks.find((w) => w.plan.week !== current)) || weeks.find((w) => w.plan.week === current) || weeks[0];
}

export function openCount(week: Week): number {
  const list = shoppingList(week.plan, week.state);
  return list.open + list.own.filter((o) => o.state === 'offen').length;
}

export const favSentence = (n: number): string => (n === 0 ? 'Alle Rezepte durchsuchen' : n === 1 ? '1 Favorit' : `${n} Favoriten`);
export const openSentence = (n: number): string => (n === 0 ? 'Alles ist erledigt' : n === 1 ? '1 Ding offen' : `${n} Dinge offen`);
export const shoppingSentence = (people: number): string =>
  `Die Liste reicht für die ganze Woche und für ${people === 1 ? 'eine Person' : `${numberWord(people)} Personen`}.`;

// ---- In den Plan ----

/** Dinner today; once it is over, dinner tomorrow (also Monday of next week); without that plan, today. Null without any plan. */
export function placeDefault(weeks: Week[], nowMs: number): { week: string; day: number; slot: Slot } | null {
  const current = weekOf(nowMs);
  const today = { week: current, day: dayIndex(nowMs), slot: 'abend' as const };
  const t = tomorrowOf(nowMs);
  const candidates = isOver('abend', nowMs) ? [{ ...t, slot: 'abend' as const }, today] : [today];
  return candidates.find((c) => weeks.some((w) => w.plan.week === c.week)) ?? null;
}

export const placeButton = (day: number, slot: Slot, today: boolean): string =>
  today ? `Heute ${SLOT_TO[slot]} eintragen` : `Am ${DAY_LONG[day]} ${SLOT_TO[slot]} eintragen`;

/** Where the recipe already stands in the plan, from today on; the first place only. */
export function placedSentence(weeks: Week[], recipeId: string, nowMs: number): string | null {
  const current = weekOf(nowMs);
  const today = dayIndex(nowMs);
  const hits = weeks
    .filter((w) => w.plan.week >= current)
    .flatMap((w) => w.plan.meals.filter((m) => m.dish.recipeId === recipeId && (w.plan.week > current || m.day >= today)).map((m) => ({ w, m })))
    .sort((a, b) => a.w.plan.week.localeCompare(b.w.plan.week) || a.m.day - b.m.day || SLOTS.indexOf(a.m.slot) - SLOTS.indexOf(b.m.slot));
  const hit = hits[0];
  if (!hit) return null;
  const isToday = hit.w.plan.week === current && hit.m.day === today;
  return `Steht schon im Plan: ${isToday ? 'heute, ' : ''}${DAY_LONG[hit.m.day]}, ${SLOT_TO[hit.m.slot]}.`;
}

// ---- A recipe ----

export function recipeSentence(d: { minutes: number; proteinG: number | null; keepsDays: number }): string {
  return `${minutesText(d.minutes)} fertig`
    + (d.proteinG !== null && d.proteinG >= 20 ? ', mit viel Eiweiß' : '')
    + (d.keepsDays > 0 ? `, und es hält sich ${keepsText(d.keepsDays)}.` : ', am besten frisch.');
}
