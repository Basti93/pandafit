import { describe, expect, it } from 'vitest';
import {
  addWeeks, cookPortions, dayIndex, eatersOf, EMPTY_STATE, itemKey, mergeStates, readMealPlan, readReplanRequest, readMealState, shopAmount, shoppingList,
  weekOf, withEater, withItem, withOwn, changeOwn, type Dish, type MealPlan,
} from '../../src/shared/meals';

const dish = (title: string, ingredients: Dish['ingredients'], keepsDays = 2): Dish => ({ title, ingredients, steps: ['Kochen.'], minutes: 20, proteinG: 25, keepsDays, source: 'liste' });
const oats = dish('Overnight Oats', [{ name: 'Haferflocken', amount: 60, unit: 'g', section: 'Vorrat' }, { name: 'Skyr', amount: 150, unit: 'g', section: 'Kühlregal' }]);
const curry = dish('Curry', [{ name: 'Kichererbsen', amount: 0.5, unit: 'Dose', section: 'Vorrat' }, { name: 'Basmatireis', amount: 70, unit: 'g', section: 'Vorrat' }, { name: 'Currypulver', amount: 1, unit: 'TL', section: 'Vorrat' }]);
const soup = dish('Suppe', [{ name: 'Karotten', amount: 1, unit: 'Stk', section: 'Obst und Gemüse' }, { name: 'Haferflocken', amount: 20, unit: 'g', section: 'Vorrat' }]);

const plan = (): MealPlan => ({
  week: '2026-11-09', createdMs: 1, source: 'liste', trainingDays: [],
  people: [{ id: 'max', name: 'Max' }, { id: 'lena', name: 'Lena' }],
  meals: [
    { day: 0, slot: 'fruehstueck', dish: oats, reuseOf: null, eaters: ['max', 'lena'], takeAlong: false },
    { day: 0, slot: 'mittag', dish: curry, reuseOf: null, eaters: ['max', 'lena'], takeAlong: true },
    { day: 1, slot: 'mittag', dish: curry, reuseOf: '0-mittag', eaters: ['max', 'lena'], takeAlong: true },
    { day: 0, slot: 'abend', dish: soup, reuseOf: null, eaters: ['max'], takeAlong: false },
  ],
});

describe('weeks', () => {
  it('a week starts on Monday in local time', () => {
    const sat = new Date(2026, 10, 7, 6, 0).getTime();
    expect(dayIndex(sat)).toBe(5);
    expect(weekOf(sat)).toBe('2026-11-02');
    expect(addWeeks(weekOf(sat), 1)).toBe('2026-11-09');
    expect(weekOf(new Date(2026, 10, 9, 0, 1).getTime())).toBe('2026-11-09');
  });
});

describe('portions', () => {
  it('a cooked dish counts its own eaters and those of its rest; the rest cooks nothing', () => {
    const p = plan();
    expect(cookPortions(p, EMPTY_STATE, '0-mittag')).toEqual({ total: 4, parts: [{ day: 0, slot: 'mittag', count: 2 }, { day: 1, slot: 'mittag', count: 2 }] });
    expect(cookPortions(p, EMPTY_STATE, '1-mittag').total).toBe(0);
  });

  it('a person toggled off a meal leaves its eaters and its portions, and can be toggled back', () => {
    const p = plan();
    const off = withEater(EMPTY_STATE, '1-mittag', 'lena', false, 10);
    expect(eatersOf(p, off, '1-mittag')).toEqual(['max']);
    expect(cookPortions(p, off, '0-mittag').total).toBe(3);
    const on = withEater(off, '0-abend', 'lena', true, 11);
    expect(eatersOf(p, on, '0-abend')).toEqual(['max', 'lena']);
    expect(eatersOf(p, withEater(off, '1-mittag', 'lena', true, 12), '1-mittag')).toEqual(['max', 'lena']);
  });
});

describe('shopping list', () => {
  it('sums by people eating, rounds to shop units and groups by section', () => {
    const list = shoppingList(plan(), EMPTY_STATE);
    const items = Object.fromEntries(list.sections.flatMap((s) => s.items.map((i) => [i.name, { amount: i.amount, section: s.section }])));
    // 2 × 60 g oats + 1 × 20 g in the soup = 140 g: one pack
    expect(items.Haferflocken).toEqual({ amount: '1 Packung à 500 g', section: 'Vorrat' });
    // 2 × 150 g Skyr: one 450 g cup
    expect(items.Skyr!.amount).toBe('1 Becher à 450 g');
    // the curry is cooked for 4: 2 tins, 280 g rice
    expect(items.Kichererbsen!.amount).toBe('2 Dosen');
    expect(items.Basmatireis!.amount).toBe('1 Packung à 500 g');
    expect(items.Currypulver).toBeUndefined();
    expect(list.pantry.map((i) => `${i.name}: ${i.amount}`)).toEqual(['Currypulver: aus dem Vorrat']);
    expect(items.Karotten).toEqual({ amount: '1 Stück', section: 'Obst und Gemüse' });
    expect(list.sections.map((s) => s.section)).toEqual(['Obst und Gemüse', 'Kühlregal', 'Vorrat']);
  });

  it('a person off a meal changes the amounts, and nobody eating means nothing to buy', () => {
    const p = plan();
    let s = withEater(EMPTY_STATE, '1-mittag', 'lena', false, 1);
    s = withEater(s, '1-mittag', 'max', false, 1);
    s = withEater(s, '0-mittag', 'lena', false, 1);
    const names = (st = s) => shoppingList(p, st).sections.flatMap((x) => x.items.map((i) => `${i.name}: ${i.amount}`));
    expect(names()).toContain('Kichererbsen: 1 Dose');
    s = withEater(s, '0-mittag', 'max', false, 2);
    expect(names().some((n) => n.startsWith('Kichererbsen'))).toBe(false);
  });

  it('bought and already-there ticks are kept per item; "schon da" moves to its own list', () => {
    const p = plan();
    const s = withItem(withItem(EMPTY_STATE, itemKey('Skyr', 'g'), 'gekauft', 1), itemKey('Karotten', 'Stk'), 'da', 2);
    const list = shoppingList(p, s);
    expect(list.have.map((i) => i.name)).toEqual(['Karotten']);
    expect(list.sections.flatMap((x) => x.items).find((i) => i.name === 'Skyr')!.state).toBe('gekauft');
    expect(list.open).toBe(list.total - 2);
  });

  it('rounds loose amounts sensibly', () => {
    expect(shopAmount('Zucchini', 'g', 130)).toBe('150 g');
    expect(shopAmount('Ingwer', 'g', 15)).toBe('20 g');
    expect(shopAmount('Paprika', 'Stk', 2.5)).toBe('3 Stück');
    expect(shopAmount('Mehl', 'g', 1230)).toBe('1,3 kg');
    expect(shopAmount('Knoblauch', 'Zehe', 3)).toBe('1 Knolle');
    expect(shopAmount('Vollkornbrot', 'Scheibe', 12)).toBe('2 Brote (12 Scheiben)');
    expect(shopAmount('Feta', 'g', 300)).toBe('2 Packungen à 200 g');
  });
});

describe('state merge and reading', () => {
  it('merges entry by entry, the newer one wins, the same on both sides', () => {
    const a = withItem(withEater(EMPTY_STATE, '0-abend', 'lena', false, 5), 'skyr|g', 'gekauft', 3);
    const b = withItem(withEater(EMPTY_STATE, '0-abend', 'lena', true, 4), 'skyr|g', 'offen', 9);
    const m = mergeStates(a, b);
    expect(m.eaters['0-abend']!.lena).toEqual({ on: false, atMs: 5 });
    expect(m.items['skyr|g']).toEqual({ state: 'offen', atMs: 9 });
    expect(mergeStates(b, a)).toEqual(m);
  });

  it('reads what it can and skips the rest', () => {
    expect(readMealPlan({ week: 'x' })).toBeNull();
    const p = readMealPlan({ ...plan(), meals: [...plan().meals, { day: 9, slot: 'mittag' }] })!;
    expect(p.meals).toHaveLength(4);
    expect(readMealState({ eaters: { '0-abend': { lena: { on: false, atMs: 1 } }, bad: {} }, items: { a: { state: 'gekauft', atMs: 2 }, b: { state: 'weg', atMs: 2 } } }))
      .toEqual({ eaters: { '0-abend': { lena: { on: false, atMs: 1 } } }, items: { a: { state: 'gekauft', atMs: 2 } } });
  });
});

describe('own shopping items', () => {
  const K = 'own-abc12345';
  const empty = shoppingList(plan(), EMPTY_STATE);

  it('an own item is added with its amount, ticked and removed, apart from the plan list', () => {
    let s = withOwn(EMPTY_STATE, K, '  Kaffee ', '2 Pakete', 10);
    expect(shoppingList(plan(), s).own).toEqual([{ key: K, name: 'Kaffee', amount: '2 Pakete', state: 'offen', dishes: [] }]);
    // The plan's own counts do not change.
    expect(shoppingList(plan(), s).total).toBe(empty.total);
    expect(shoppingList(plan(), s).open).toBe(empty.open);
    s = changeOwn(s, K, { state: 'gekauft' }, 20);
    expect(shoppingList(plan(), s).own[0]!.state).toBe('gekauft');
    s = changeOwn(s, K, { removed: true }, 30);
    expect(shoppingList(plan(), s).own).toEqual([]);
  });

  it('blank names and odd keys are ignored; ticked items sink below open ones', () => {
    expect(withOwn(EMPTY_STATE, K, '   ', '', 1)).toBe(EMPTY_STATE);
    expect(withOwn(EMPTY_STATE, 'x', 'Tee', '', 1)).toBe(EMPTY_STATE);
    let s = withOwn(EMPTY_STATE, K, 'Kaffee', '', 1);
    s = withOwn(s, 'own-def67890', 'Tee', '', 2);
    s = changeOwn(s, K, { state: 'gekauft' }, 3);
    expect(shoppingList(plan(), s).own.map((i) => i.name)).toEqual(['Tee', 'Kaffee']);
  });

  it('they merge entry by entry: a removal newer than another device\'s tick wins, and a state without any reads as before', () => {
    const base = withOwn(EMPTY_STATE, K, 'Kaffee', '', 1);
    const removed = changeOwn(base, K, { removed: true }, 5);
    const ticked = changeOwn(base, K, { state: 'gekauft' }, 3);
    expect(shoppingList(plan(), mergeStates(removed, ticked)).own).toEqual([]);
    expect(shoppingList(plan(), mergeStates(ticked, removed)).own).toEqual([]);
    expect(mergeStates(EMPTY_STATE, EMPTY_STATE)).toEqual(EMPTY_STATE);
    expect(readMealState({ eaters: {}, items: {} })).toEqual(EMPTY_STATE);
  });

  it('reading a stored state keeps good own entries, cuts long text and skips bad ones', () => {
    const read = readMealState({ own: { [K]: { name: 'x'.repeat(200), amount: 'y'.repeat(200), state: 'gekauft', removed: false, atMs: 1 }, bad: { name: 'a', state: 'offen', atMs: 1 }, 'own-zzzz1111': { name: 'b', state: 'da', atMs: 1 } } });
    expect(Object.keys(read.own!)).toEqual([K]);
    expect(read.own![K]!.name).toHaveLength(60);
    expect(read.own![K]!.amount).toHaveLength(30);
    expect(readMealState(JSON.parse(JSON.stringify(read)))).toEqual(read);
  });
});

describe('cover in item entries', () => {
  it('reads only valid cover keys and drops a cover that is no object', () => {
    expect(readMealState({ items: { k: { state: 'gekauft', atMs: 1, cover: { '4-abend': 200, '9-x': 1, '1-mittag': -1, '2-abend': 'x' } } } }).items.k)
      .toEqual({ state: 'gekauft', atMs: 1, cover: { '4-abend': 200 } });
    expect(readMealState({ items: { k: { state: 'gekauft', atMs: 1, cover: 5 } } }).items.k).toEqual({ state: 'gekauft', atMs: 1 });
  });
});

describe('replan requests', () => {
  it('reads a request and skips bad ones', () => {
    expect(readReplanRequest('replan-abcd1234', { atMs: 1, answeredMs: null })).toEqual({ id: 'replan-abcd1234', atMs: 1, answeredMs: null });
    expect(readReplanRequest('replan-abcd1234', { atMs: 1, answeredMs: 5 })).toEqual({ id: 'replan-abcd1234', atMs: 1, answeredMs: 5 });
    expect(readReplanRequest('replan-x', { atMs: 1 })).toBeNull();
    expect(readReplanRequest('replan-abcd1234', { answeredMs: null })).toBeNull();
    expect(readReplanRequest('replan-abcd1234', 'x')).toBeNull();
  });
});

describe('canonical ingredient key', () => {
  const same = (a: string, b: string) => expect(itemKey(a, 'g'), `${a} = ${b}`).toBe(itemKey(b, 'g'));
  const apart = (a: string, b: string) => expect(itemKey(a, 'g'), `${a} != ${b}`).not.toBe(itemKey(b, 'g'));

  it('merges spelling, word order, plural, filler words and synonyms', () => {
    same('Basmati-Reis', 'Basmatireis');
    same('Ei', 'Eier');
    same('Feta', 'Feta Käse');
    same('Möhre', 'Karotte');
    same('Möhren', 'Karotten');
    same('Kirschtomaten', 'Cherrytomaten');
    same('Tofu', 'Naturtofu');
    same('Tofu natur', 'Tofu');
    same('Sojasauce', 'Sojasoße');
    same('Paprika, rot', 'Rote Paprika');
    same('Paprika, gelb', 'Gelbe Paprika');
    same('Zwiebel', 'Speisezwiebel');
    same('Zwiebeln', 'Zwiebel');
    same('Milch', 'Vollmilch');
    same('Skyr', 'Skyr natur');
    same('Oregano', 'Oregano, getrocknet');
    same('Paprikapulver', 'Paprikapulver edelsüß');
    same('Champignons', 'Braune Champignons');
    same('Kürbiskerne', 'Kürbiskern');
    same('KARTOFFELN', 'kartoffel');
  });

  it('keeps different things apart', () => {
    apart('Räuchertofu', 'Tofu');
    apart('Rote Linsen', 'Grüne Linsen');
    apart('Rote Paprika', 'Gelbe Paprika');
    apart('Vegetarischer Hartkäse', 'Parmesan');
    apart('Kichererbsen', 'Kichererbsen (Dose, abgetropft)');
    apart('Tomate getrocknet', 'Tomate');
    apart('Brauner Reis', 'Reis');
    apart('Linsen', 'Rote Linsen');
  });

  it('is stable: a canonical key maps to itself', () => {
    for (const n of ['Rote Paprika', 'Eier', 'Kirschtomaten', 'Basmati-Reis', 'Champignons', 'Walnüsse']) {
      const [name, fam] = itemKey(n, 'g').split('|');
      expect(itemKey(name!, fam as 'g')).toBe(itemKey(n, 'g'));
    }
  });
});
