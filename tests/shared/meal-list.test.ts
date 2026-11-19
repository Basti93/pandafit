process.env.TZ = 'Europe/Berlin';
import { describe, expect, it } from 'vitest';
import { retieStock, stockNames, stockOf, tickWrites, windowShoppingList, ownWeekOf, type StockItem, type WindowList } from '../../src/shared/meal-list';
import type { PlanWeek } from '../../src/shared/meal-window';
import { itemKey, withItem, withOwn, type Dish, type ItemState, type Meal, type Slot } from '../../src/shared/meals';

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime(); // 19.11.2026 is a Thursday
const tofu: Dish = { title: 'Tofupfanne', ingredients: [{ name: 'Tofu natur', amount: 100, unit: 'g', section: 'Kühlregal' }], steps: [], minutes: 20, proteinG: 25, keepsDays: 0, source: 'liste' };
const KEY = itemKey('Tofu natur', 'g');
const meal = (day: number, slot: Slot, eaters = ['max', 'lena']): Meal => ({ day, slot, dish: tofu, reuseOf: null, eaters, takeAlong: false });
const pw = (week: string, meals: Meal[]): PlanWeek => ({ plan: { week, createdMs: 0, source: 'liste', people: [{ id: 'max', name: 'Max' }, { id: 'lena', name: 'Lena' }], meals, trainingDays: [] }, state: { eaters: {}, items: {} } });
const weeks = [pw('2026-11-16', [meal(4, 'abend')]), pw('2026-11-23', [meal(0, 'abend')])];
const now = at(19, 9);

const withMeal = (ws: PlanWeek[], week: string, m: Meal): PlanWeek[] => ws.map((w) => (w.plan.week === week ? { ...w, plan: { ...w.plan, meals: [...w.plan.meals, m] } } : w));
const apply = (ws: PlanWeek[], writes: ReturnType<typeof tickWrites>, s: ItemState, t: number) =>
  ws.map((w) => { const x = writes.find((o) => o.week === w.plan.week); return x ? { ...w, state: withItem(w.state, KEY, s, t, x.cover) } : w; });
const row = (l: WindowList) => [...l.sections.flatMap((s) => s.items), ...l.have].find((i) => i.key === KEY)!;

describe('rolling shopping list', () => {
  it('sums the same ingredient across both week records into one row', () => {
    expect(row(windowShoppingList(weeks, now))).toMatchObject({ amount: '2 Packungen à 200 g', state: 'offen' });
  });
  it('one tick writes the covered meals into each week record', () => {
    const w = tickWrites(weeks, now, KEY, 'gekauft');
    expect(w).toEqual([{ week: '2026-11-16', cover: { '4-abend': 200 } }, { week: '2026-11-23', cover: { '0-abend': 200 } }]);
    const l = windowShoppingList(apply(weeks, w, 'gekauft', now), now);
    expect(row(l).state).toBe('gekauft');
    expect(l.open).toBe(0);
  });
  it('after buying, only what is new shows: a new meal, or one more eater', () => {
    const bought = apply(weeks, tickWrites(weeks, now, KEY, 'gekauft'), 'gekauft', now);
    const more = withMeal(bought, '2026-11-23', meal(1, 'abend', ['max']));
    expect(row(windowShoppingList(more, now))).toMatchObject({ state: 'offen', amount: '1 Packung à 200 g' });
  });
  it('a tick stays until its meal is past, then leaves with it', () => {
    const bought = apply(weeks, tickWrites(weeks, now, KEY, 'gekauft'), 'gekauft', now);
    expect(row(windowShoppingList(bought, at(20, 21, 30))).state).toBe('gekauft');
  });
  it('an old entry without cover covers its whole week', () => {
    const old = weeks.map((w) => (w.plan.week === '2026-11-16' ? { ...w, state: { ...w.state, items: { [KEY]: { state: 'gekauft' as const, atMs: 1 } } } } : w));
    expect(row(windowShoppingList(old, now))).toMatchObject({ state: 'offen', amount: '1 Packung à 200 g' });
  });
  it('untick clears the cover in every week that has it', () => {
    const bought = apply(weeks, tickWrites(weeks, now, KEY, 'gekauft'), 'gekauft', now);
    expect(tickWrites(bought, now, KEY, 'offen')).toEqual([{ week: '2026-11-16' }, { week: '2026-11-23' }]);
  });
  it('own items come from both weeks; a new one goes to the week of the last planned day', () => {
    expect(ownWeekOf(weeks, now)).toBe('2026-11-23');
    const own = weeks.map((w, i) => ({ ...w, state: withOwn(w.state, `own-abcd123${i}`, `Kaffee ${i}`, '', i) }));
    expect(windowShoppingList(own, now).own.map((o) => [o.name, o.week])).toEqual([['Kaffee 0', '2026-11-16'], ['Kaffee 1', '2026-11-23']]);
  });
  it('the window reports its last day and the people', () => {
    const l = windowShoppingList(weeks, now);
    expect(l.lastDay).toEqual({ week: '2026-11-23', day: 0 });
    expect(l.people).toBe(2);
  });
});

describe('stock', () => {
  const from = { week: '2026-11-16', day: 4 };
  const bought = () => apply(weeks, tickWrites(weeks, now, KEY, 'gekauft'), 'gekauft', now);
  const stock400: StockItem[] = [{ key: KEY, name: 'Tofu natur', unit: 'g', amount: 400, state: 'gekauft' }];
  it('stock is what is bought for meals from tomorrow on', () => {
    expect(stockOf(bought(), from)).toEqual(stock400);
    expect(stockNames(stock400)).toEqual(['Tofu natur']);
  });
  it('after a replan the stock moves onto the new dishes; what still is missing shows open', () => {
    const replanned = [pw('2026-11-16', [meal(6, 'mittag')]), pw('2026-11-23', [meal(1, 'abend'), meal(2, 'abend', ['max'])])]
      .map((w, i) => ({ ...w, state: bought()[i]!.state }));
    const states = retieStock(replanned, from, stock400, 5);
    expect(states['2026-11-16']!.items[KEY]).toEqual({ state: 'gekauft', atMs: 5, cover: { '6-mittag': 200 } });
    expect(states['2026-11-23']!.items[KEY]).toEqual({ state: 'gekauft', atMs: 5, cover: { '1-abend': 200 } });
    const merged = replanned.map((w) => ({ ...w, state: states[w.plan.week] ?? w.state }));
    expect(row(windowShoppingList(merged, now))).toMatchObject({ state: 'offen', amount: '1 Packung à 200 g' });
  });
  it('stock that no new dish needs leaves the list', () => {
    const none = [pw('2026-11-16', []), pw('2026-11-23', [])].map((w, i) => ({ ...w, state: bought()[i]!.state }));
    const states = retieStock(none, from, stock400, 5);
    expect(states['2026-11-16']!.items[KEY]).toEqual({ state: 'offen', atMs: 5 });
  });
});
