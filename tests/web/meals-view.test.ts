import { describe, expect, it } from 'vitest';
import { addWeeks, type Dish, type Meal, type Slot } from '../../src/shared/meals';
import {
  askedSentence, eatersLine, favSentence, headSentence, mealSentence, nextMeal, nextWeekRows, openSentence, placeButton, placeDefault, placedSentence,
  recipeSentence, restOfWeek, rowSentence, shoppingSentence, shoppingWeek, slotKicker, todayMeals, type Week,
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
    expect(headSentence(todayMeals([thisWeek], at(SO, 22, 0)), nextMeal([thisWeek], at(SO, 22, 0)))).toBe('Für heute steht nichts mehr an. Der nächste Plan kommt am Samstagmorgen.');
    expect(headSentence([], null)).toBe('Heute ist nichts geplant. Der nächste Plan kommt am Samstagmorgen.');
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
  it('the rest of the week starts after today, the next week only with its plan', () => {
    expect(restOfWeek(weeks, at(MO, 12, 0)).map((r) => r.lead)).toEqual(['Di 10.', 'Mi 11.', 'Do 12.', 'Fr 13.', 'Sa 14.', 'So 15.']);
    expect(restOfWeek(weeks, at(MO, 12, 0))[0]!.dateLong).toBe('Dienstag, 10. November');
    expect(restOfWeek(weeks, at(MO, 12, 0))[1]!.meal!.slot).toBe('abend');
    expect(restOfWeek(weeks, at(SO, 12, 0))).toEqual([]);
    expect(nextWeekRows([thisWeek], at(SA, 12, 0))).toEqual([]);
    expect(nextWeekRows(weeks, at(SA, 12, 0))).toHaveLength(7);
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
    expect([shoppingSentence(2), shoppingSentence(1)]).toEqual(['Die Liste reicht für die ganze Woche und für zwei Personen.', 'Die Liste reicht für die ganze Woche und für eine Person.']);
    expect(shoppingWeek(weeks, at(SA, 9, 0))!.plan.week).toBe(NEXT);
    expect(shoppingWeek(weeks, at(MI, 9, 0))!.plan.week).toBe(THIS);
    expect(recipeSentence({ minutes: 30, proteinG: 25, keepsDays: 2 })).toBe('In 30 Minuten fertig, mit viel Eiweiß, und es hält sich zwei Tage.');
    expect(recipeSentence({ minutes: 10, proteinG: 8, keepsDays: 0 })).toBe('In 10 Minuten fertig, am besten frisch.');
  });
});
