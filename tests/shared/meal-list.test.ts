process.env.TZ = 'Europe/Berlin';
import { describe, expect, it } from 'vitest';
import { retieStock, stockNames, stockOf, tickWrites, windowShoppingList, ownWeekOf, type StockItem, type WindowList } from '../../src/shared/meal-list';
import type { PlanWeek } from '../../src/shared/meal-window';
import { canonName, itemKey, withItem, withOwn, type Dish, type ItemState, type Meal, type Slot } from '../../src/shared/meals';

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

describe('merged ingredients and old ticks', () => {
  const dishOf = (name: string, amount: number, unit: 'Stk' | 'g'): Dish => ({ title: name, ingredients: [{ name, amount, unit, section: 'Obst und Gemüse' }], steps: [], minutes: 5, proteinG: 1, keepsDays: 0, source: 'liste' });
  const m = (day: number, d: Dish): Meal => ({ day, slot: 'abend', dish: d, reuseOf: null, eaters: ['max', 'lena'], takeAlong: false });
  const base = [pw('2026-11-16', [m(4, dishOf('Tomate', 1, 'Stk'))]), pw('2026-11-23', [m(0, dishOf('Tomaten', 150, 'g'))])];
  const TK = itemKey('Tomate', 'g');
  const items = (l: WindowList) => [...l.sections.flatMap((s) => s.items), ...l.have];
  const withItems = (ws: PlanWeek[], week: string, it: Record<string, { state: ItemState; atMs: number; cover?: Record<string, number> }>) =>
    ws.map((w) => (w.plan.week === week ? { ...w, state: { ...w.state, items: it } } : w));

  it('Tomate [Stk] and Tomaten [g] are one row across both weeks', () => {
    const l = windowShoppingList(base, now);
    expect(items(l)).toHaveLength(1);
    expect(items(l)[0]).toMatchObject({ key: TK, amount: '500 g' });
  });

  it('an old tick with cover under the old key covers its meal in the old unit', () => {
    const old = withItems(base, '2026-11-16', { 'tomate|Stk': { state: 'gekauft', atMs: 1, cover: { '4-abend': 2 } } });
    expect(items(windowShoppingList(old, now))[0]).toMatchObject({ state: 'offen', amount: '300 g' });
  });

  it('old ticks of both old keys together cover the whole row', () => {
    const old = withItems(withItems(base, '2026-11-16', { 'tomate|Stk': { state: 'gekauft', atMs: 1 } }), '2026-11-23', { 'tomaten|g': { state: 'gekauft', atMs: 2 } });
    const l = windowShoppingList(old, now);
    expect(items(l)[0]).toMatchObject({ state: 'gekauft' });
    expect(l.open).toBe(0);
  });

  it('a new tick keeps what the old tick covered, and untick then clears it', () => {
    const old = withItems(base, '2026-11-16', { 'tomate|Stk': { state: 'gekauft', atMs: 1 } });
    const w = tickWrites(old, now, TK, 'gekauft');
    const ticked = old.map((x) => { const o = w.find((y) => y.week === x.plan.week); return o ? { ...x, state: withItem(x.state, TK, 'gekauft', 5, o.cover) } : x; });
    expect(items(windowShoppingList(ticked, now))[0]!.state).toBe('gekauft');
    const off = tickWrites(ticked, now, TK, 'offen');
    const cleared = ticked.map((x) => (off.some((y) => y.week === x.plan.week) ? { ...x, state: withItem(x.state, TK, 'offen', 9) } : x));
    expect(items(windowShoppingList(cleared, now))[0]!.state).toBe('offen');
  });

  it('stock reads old keys, converted to the new unit', () => {
    const old = withItems(base, '2026-11-16', { 'tomate|Stk': { state: 'gekauft', atMs: 1, cover: { '4-abend': 2 } } });
    expect(stockOf(old, { week: '2026-11-16', day: 0 })).toEqual([{ key: TK, name: 'Tomate', unit: 'g', amount: 200, state: 'gekauft' }]);
  });

  it('keys that no recipe knows any more never throw', () => {
    const odd = withItems(base, '2026-11-16', { 'irgendwas|Stk': { state: 'gekauft', atMs: 1, cover: { '4-abend': 1 } }, '': { state: 'da', atMs: 1 } });
    expect(() => stockOf(odd, { week: '2026-11-16', day: 0 })).not.toThrow();
    expect(() => windowShoppingList(odd, now)).not.toThrow();
  });
});

describe('learned aliases in the rolling list', () => {
  const dishOf = (name: string): Dish => ({ title: name, ingredients: [{ name, amount: 100, unit: 'g', section: 'Kühlregal' }], steps: [], minutes: 5, proteinG: 1, keepsDays: 0, source: 'liste' });
  const m = (day: number, d: Dish): Meal => ({ day, slot: 'abend', dish: d, reuseOf: null, eaters: ['max'], takeAlong: false });
  const aliases = { [canonName('Hüttenkäse')]: canonName('Körniger Frischkäse') };
  const ws = (a?: typeof aliases): PlanWeek[] => [{ ...pw('2026-11-16', [m(4, dishOf('Hüttenkäse'))]), ...(a ? { aliases: a } : {}) }, { ...pw('2026-11-23', [m(0, dishOf('Körniger Frischkäse'))]), ...(a ? { aliases: a } : {}) }];
  const rows = (l: WindowList) => [...l.sections.flatMap((s) => s.items), ...l.have];

  it('two spellings the rules keep apart become one row with the alias', () => {
    expect(rows(windowShoppingList(ws(), now))).toHaveLength(2);
    expect(rows(windowShoppingList(ws(aliases), now))).toHaveLength(1);
  });

  it('a tick made before the alias (old key, with cover) still covers its meal', () => {
    const base = ws(aliases);
    const ticked = base.map((w) => (w.plan.week === '2026-11-16' ? { ...w, state: withItem(w.state, itemKey('Hüttenkäse', 'g'), 'gekauft', 1, { '4-abend': 100 }) } : w));
    expect(rows(windowShoppingList(ticked, now))[0]).toMatchObject({ state: 'offen', amount: '1 Becher à 200 g' });
    expect(stockOf(ticked, { week: '2026-11-16', day: 0 })).toEqual([{ key: itemKey('Körniger Frischkäse', 'g'), name: 'Hüttenkäse', unit: 'g', amount: 100, state: 'gekauft' }]);
  });
});
