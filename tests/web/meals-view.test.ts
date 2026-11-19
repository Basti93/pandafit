process.env.TZ = 'Europe/Berlin'; // the clock-change test must cross a real change on any machine
import { describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../src/shared/records';
import { windowShoppingList } from '../../src/shared/meal-list';
import { addWeeks, canonName, type Dish, type Meal, type Slot } from '../../src/shared/meals';
import {
  askedSentence, comingDays, NO_PLAN, eatersLine, favSentence, headSentence, lastWeekRows, mealSentence, nextMeal, openCount, openSentence, pastDaysRows, placeButton, placeDefault, placedSentence,
  mealKicker, mealWeeks, recipeSentence, rowSentence, shoppingSentence, slotKicker, todayMeals, type Week,
} from '../../src/web/essen/meals-view';

const MO = 0, MI = 2, SA = 5, SO = 6;
const THIS = '2026-11-09'; // a Monday
const NEXT = addWeeks(THIS, 1);
const at = (day: number, h: number, m = 0, week = THIS) => { const [y, mo, d] = week.split('-').map(Number); return new Date(y!, mo! - 1, d! + day, h, m).getTime(); };

const dish = (title: string, o: Partial<Dish> = {}): Dish => ({ title, ingredients: [], steps: [], minutes: 5, proteinG: 25, keepsDays: 0, source: 'liste', ...o });
const meal = (day: number, slot: Slot, title: string, o: Partial<Meal> = {}, d: Partial<Dish> = {}): Meal =>
  ({ day, slot, dish: dish(title, d), reuseOf: null, eaters: ['pa', 'pb'], takeAlong: false, ...o });
const people = [{ id: 'pa', name: 'Max' }, { id: 'pb', name: 'Lena' }];
const week = (key: string, meals: Meal[]): Week => ({ plan: { week: key, createdMs: 0, source: 'liste', people, meals, trainingDays: [] }, state: { eaters: {}, items: {} } });

const skyr = meal(MO, 'mittag', 'Skyr mit Nüssen', { takeAlong: true }, { minutes: 5 });
const curry = meal(MI, 'mittag', 'Linsencurry', {}, { minutes: 30, keepsDays: 2, recipeId: 'r1' });
const restOfCurry = meal(3, 'mittag', 'Linsencurry', { reuseOf: '2-mittag' });
const wished = meal(MO, 'abend', 'Suppe', { askedBy: 'pb' });
const thisWeek = week(THIS, [meal(MO, 'fruehstueck', 'Haferbrei mit Beeren'), skyr, wished, curry, restOfCurry, meal(MI, 'abend', 'Pfanne'), meal(1, 'fruehstueck', 'Müsli'), meal(SO, 'abend', 'Nudeln')]);
const nextWeek = week(NEXT, [meal(MO, 'fruehstueck', 'Haferbrei mit Beeren'), meal(1, 'abend', 'Pfanne')]);
const weeks = [thisWeek, nextWeek];

describe('Essen in words', () => {
  it('looks forward over days without meals; a later day names its weekday; nothing ahead is null', () => {
    const gap = week(THIS, [meal(MO, 'abend', 'Suppe'), meal(3, 'fruehstueck', 'Müsli')]);
    const r = nextMeal([gap], at(MO, 21, 0))!;
    expect([r.when, r.meal.day]).toEqual(['später', 3]);
    expect(mealKicker(r)).toBe('Donnerstag · Frühstück um 8 Uhr');
    expect(headSentence(todayMeals([gap], at(MO, 21, 0)), r)).toBe('Für heute steht nichts mehr an. Am Donnerstag gibt es um 8 Uhr Müsli.');
    expect(nextMeal([gap], at(SA, 12, 0))).toBeNull();
    const across = nextMeal([gap, nextWeek], at(SA, 12, 0))!;
    expect([across.week.plan.week, across.when]).toEqual([NEXT, 'später']);
  });
  it('a day without meals in an existing plan says so', () => {
    const friday = at(4, 12, 0);
    expect(todayMeals(weeks, friday)).toEqual([]);
    expect(headSentence([], nextMeal(weeks, friday))).toBe('Heute ist nichts geplant. Am Sonntag gibt es um 19 Uhr Nudeln.');
  });
  it('small sentences keep their singular and drop unknown people', () => {
    expect(rowSentence(thisWeek, meal(MO, 'mittag', 'Toast', {}, { minutes: 1 }))).toBe('Etwa 1 Minute.');
    expect(askedSentence(thisWeek, meal(MO, 'abend', 'X', { askedBy: 'weg' }))).toBeNull();
  });
  it('a meal is dran until two hours after its time, then the next one, after dinner tomorrow', () => {
    expect(nextMeal(weeks, at(MO, 9, 30))!.meal.slot).toBe('fruehstueck');
    expect(nextMeal(weeks, at(MO, 10, 1))!.meal.slot).toBe('mittag');
    const late = nextMeal(weeks, at(MO, 21, 5))!;
    expect([late.when, late.meal.day, late.meal.slot]).toEqual(['morgen', 1, 'fruehstueck']);
    expect(todayMeals(weeks, at(MO, 11, 0)).map((t) => [t.meal.slot, t.over])).toEqual([['fruehstueck', true], ['mittag', false], ['abend', false]]);
  });
  it('Sunday night goes to Monday of next week by its key, also on the night the clocks change', () => {
    const r = nextMeal([thisWeek, nextWeek], at(SO, 22, 0));
    expect([r!.week.plan.week, r!.meal.day]).toEqual([NEXT, 0]);
    // 2026-10-25 is the Sunday of the change to winter time.
    const dstThis = week('2026-10-19', [meal(SO, 'abend', 'Nudeln')]);
    const dstNext = week('2026-10-26', [meal(MO, 'fruehstueck', 'Brei')]);
    const d = nextMeal([dstThis, dstNext], at(SO, 22, 0, '2026-10-19'))!;
    expect([d.week.plan.week, d.meal.day, d.when]).toEqual(['2026-10-26', 0, 'morgen']);
  });
  it('says the day in one sentence, also late and without a plan for tomorrow', () => {
    expect(headSentence(todayMeals(weeks, at(MO, 11, 0)), nextMeal(weeks, at(MO, 11, 0)))).toBe('Das Frühstück liegt hinter dir. Als Nächstes gibt es um 13 Uhr Skyr mit Nüssen.');
    expect(headSentence(todayMeals(weeks, at(MO, 15, 30)), nextMeal(weeks, at(MO, 15, 30)))).toBe('Das Frühstück und das Mittagessen liegen hinter dir. Als Nächstes gibt es um 19 Uhr Suppe.');
    expect(headSentence(todayMeals([thisWeek], at(SO, 22, 0)), nextMeal([thisWeek], at(SO, 22, 0)))).toBe('Für heute steht nichts mehr an. Bo plant die nächsten Tage bald.');
    expect(headSentence([], null)).toBe('Heute ist nichts geplant. Bo plant die nächsten Tage bald.');
  });
  it('says a meal in words: minutes, take along, what it is enough for, how long it keeps, who wished it', () => {
    expect(mealSentence(thisWeek, skyr)).toBe('In 5 Minuten fertig und gut zum Mitnehmen.');
    expect(mealSentence(thisWeek, curry)).toBe('In 30 Minuten fertig, und es reicht auch für Donnerstag, und es hält sich zwei Tage.');
    expect(mealSentence(thisWeek, restOfCurry)).toBe('Das ist der Rest von Mittwoch.');
    expect(rowSentence(thisWeek, restOfCurry)).toBe('Rest von Mittwoch.');
    expect(rowSentence(thisWeek, curry)).toBe('Reicht auch für Donnerstag.');
    expect(askedSentence(thisWeek, wished)).toBe('Auf Wunsch von Lena.');
    expect(askedSentence(thisWeek, skyr)).toBeNull();
    expect(eatersLine(['Max', 'Lena'])).toBe('Max und Lena essen mit');
    expect(slotKicker('fruehstueck')).toBe('Frühstück · 8 Uhr');
  });
  it('the next days run from tomorrow across the week edge, only with a plan, cut after the last day with a meal', () => {
    expect(comingDays(weeks, at(MO, 12, 0)).map((r) => r.lead)).toEqual(['Di 10.', 'Mi 11.', 'Do 12.', 'Fr 13.', 'Sa 14.', 'So 15.', 'Mo 16.']);
    expect(comingDays(weeks, at(MO, 12, 0))[0]!.dateLong).toBe('Dienstag, 10. November');
    expect(comingDays(weeks, at(MO, 12, 0))[1]!.meal!.slot).toBe('abend');
    expect(comingDays(weeks, at(SO, 12, 0)).map((r) => r.lead)).toEqual(['Mo 16.', 'Di 17.']);
    expect(comingDays([thisWeek], at(SO, 12, 0))).toEqual([]);
  });
  it('without a plan the head says that Bo plans soon', () => {
    expect(NO_PLAN).toBe('Noch gibt es keinen Essensplan. Bo plant die nächsten Tage bald.');
  });
  it('looks back at the past days', () => {
    expect(lastWeekRows(null)).toEqual([]);
    expect(pastDaysRows(weeks, at(MO, 12, 0))).toEqual([]);
    expect(pastDaysRows(weeks, at(SA, 12, 0)).map((r) => r.lead)).toEqual(['Mo 9.', 'Di 10.', 'Mi 11.', 'Do 12.', 'Fr 13.']);
    expect(lastWeekRows(thisWeek).map((r) => r.meal?.dish.title ?? null)).toEqual(['Suppe', 'Müsli', 'Pfanne', 'Linsencurry', null, null, 'Nudeln']);
  });
  it('In den Plan preselects dinner today, tomorrow once dinner is over, across the week end; nothing without a plan', () => {
    expect(placeDefault(weeks, at(MI, 18, 0))).toMatchObject({ day: 2, slot: 'abend' });
    expect(placeDefault(weeks, at(MI, 21, 30))).toMatchObject({ day: 3, slot: 'abend' });
    expect(placeDefault(weeks, at(SO, 21, 30))).toMatchObject({ week: NEXT, day: 0, slot: 'abend' });
    expect(placeDefault([thisWeek], at(SO, 21, 30))).toMatchObject({ week: THIS, day: 6, slot: 'abend' });
    expect(placeDefault([], at(MI, 18, 0))).toBeNull();
    expect(placeButton(2, 'mittag', false)).toBe('Am Mittwoch zum Mittagessen eintragen');
    expect(placeButton(2, 'abend', true)).toBe('Heute zum Abendessen eintragen');
    expect(placedSentence(weeks, 'r1', at(MO, 9, 0))).toBe('Steht schon im Plan: Mittwoch, zum Mittagessen.');
    expect(placedSentence(weeks, 'r1', at(MI, 9, 0))).toBe('Steht schon im Plan: heute, Mittwoch, zum Mittagessen.');
    expect(placedSentence(weeks, 'r1', at(3, 9, 0))).toBeNull();
  });
  it('the tiles and the list count calmly', () => {
    expect([favSentence(0), favSentence(1), favSentence(2), openSentence(11), openSentence(1), openSentence(0)]).toEqual(['Alle Rezepte durchsuchen', '1 Favorit', '2 Favoriten', '11 Dinge offen', '1 Ding offen', 'Alles ist erledigt']);
    expect(recipeSentence({ minutes: 30, proteinG: 25, keepsDays: 2 })).toBe('In 30 Minuten fertig, mit viel Eiweiß, und es hält sich zwei Tage.');
    expect(recipeSentence({ minutes: 10, proteinG: 8, keepsDays: 0 })).toBe('In 10 Minuten fertig, am besten frisch.');
  });
});

describe('the shopping list over the next days', () => {
  const tofu = (title: string) => dish(title, { ingredients: [{ name: 'Tofu natur', amount: 100, unit: 'g', section: 'Kühlregal' }] });
  const m = (day: number, slot: Slot, title: string, eaters = ['pa', 'pb']): Meal => ({ ...meal(day, slot, title), dish: tofu(title), eaters });
  const A = '2026-11-16', B = '2026-11-23';
  const ws = [week(A, [m(4, 'abend', 'Pfanne')]), week(B, [m(0, 'abend', 'Pfanne'), m(3, 'abend', 'Pfanne')])];
  const d19 = (h: number) => new Date(2026, 10, 19, h).getTime(); // a Thursday
  it('says when the list ends and for whom; in the evening it starts tomorrow', () => {
    expect(shoppingSentence(windowShoppingList(ws, d19(9)), d19(9))).toBe('Die Liste reicht bis Montag und ist für zwei Personen.');
    expect(shoppingSentence(windowShoppingList(ws, d19(21)), d19(21))).toBe('Die Liste beginnt morgen, reicht bis Donnerstag und ist für zwei Personen.');
    expect(shoppingSentence(windowShoppingList([week(A, [m(4, 'abend', 'Pfanne')])], d19(9)), d19(9))).toBe('Die Liste reicht bis Freitag und ist für zwei Personen.');
    expect(shoppingSentence(windowShoppingList([{ ...ws[0]!, plan: { ...ws[0]!.plan, people: [ws[0]!.plan.people[0]!] } }], d19(9)), d19(9))).toBe('Die Liste reicht bis Freitag und ist für eine Person.');
    expect(shoppingSentence(windowShoppingList([week(A, [])], d19(9)), d19(9))).toBe('');
  });
  it('counts the open rows of both weeks', () => {
    expect(openCount(ws, d19(9))).toBe(1);
    expect(openCount([], d19(9))).toBe(0);
  });
});

describe('the list reads the household aliases from the records', () => {
  it('a record "aliases" is attached to the weeks and merges two spellings', () => {
    const ing = (name: string) => ({ name, amount: 100, unit: 'g' as const, section: 'Kühlregal' as const });
    const w = week(THIS, [meal(MO, 'mittag', 'A', {}, { ingredients: [ing('Hüttenkäse')] }), meal(MI, 'mittag', 'B', {}, { ingredients: [ing('Körniger Frischkäse')] })]);
    const records: TrackedRecord[] = [
      { kind: 'mealplan' as const, id: `week-${THIS}`, updatedMs: 1, deleted: false, body: w.plan },
      { kind: 'mealplan' as const, id: `state-${THIS}`, updatedMs: 1, deleted: false, body: w.state },
    ];
    const now = at(MO, 8);
    const count = (rs: TrackedRecord[]) => { const l = windowShoppingList(mealWeeks(rs, now), now); return l.sections.flatMap((s) => s.items).length; };
    expect(count(records)).toBe(2);
    const withAliases = [...records, { kind: 'mealplan' as const, id: 'aliases', updatedMs: 1, deleted: false, body: { map: { [canonName('Hüttenkäse')]: canonName('Körniger Frischkäse') } } }];
    expect(count(withAliases)).toBe(1);
  });
});
