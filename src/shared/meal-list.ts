/**
 * The shopping list over the rolling window, ticks that know which meals they covered, and the stock (bought, not yet eaten).
 * Pure code over the per-week records, shared by the coach and the web app.
 */
import {
  cookPortions, mealKey, SLOTS, parseMealKey, sideIngredient, SECTIONS, UNITS, normIngredient, newRow, addToRow, rowName, rowIsPantry, rowAmount, migrateKey,
  type ItemEntry, type ItemState, type Meal, type MealState, type Row, type ShopItem, type ShopList, type Unit,
} from './meals';
import { addDays, cmpRef, dayRefOf, listStart, windowMeals, type DayRef, type PlanWeek } from './meal-window';

export type WindowList = ShopList & { start: DayRef; lastDay: DayRef | null; people: number };
export type StockItem = { key: string; name: string; unit: Unit; amount: number; state: 'gekauft' | 'da' };

const EPS = 1e-9;
const PANTRY: readonly string[] = ['EL', 'TL', 'Prise'];

type Placed = { week: PlanWeek; meal: Meal; at: DayRef };
/** The amount in the merged unit; `parts`: what each old key and unit contributed, to read ticks stored under old keys. */
type Need = { week: string; key: string; at: DayRef; amount: number; parts: { legacy: string; factor: number; amount: number }[] };
type Acc = { row: Row; needs: Need[] };

/** What each item needs per meal. Source meals only: a rest eats what its source cooked. */
function collectNeeds(meals: Placed[]): Map<string, Acc> {
  const acc = new Map<string, Acc>();
  for (const { week, meal, at } of meals) {
    if (meal.reuseOf) continue;
    const key = mealKey(meal.day, meal.slot);
    const portions = cookPortions(week.plan, week.state, key).total;
    if (portions === 0) continue;
    for (const i of meal.dish.side ? [...meal.dish.ingredients, sideIngredient(meal.dish.side)] : meal.dish.ingredients) {
      const n = normIngredient(i);
      const a = acc.get(n.key) ?? { row: newRow(i, n), needs: [] };
      addToRow(a.row, i, n, meal.dish.title);
      const amount = n.amount * portions;
      const have = a.needs.find((x) => x.week === week.plan.week && x.key === key);
      if (have) {
        have.amount += amount;
        const part = have.parts.find((p) => p.legacy === n.legacy);
        if (part) part.amount += amount; else have.parts.push({ legacy: n.legacy, factor: n.factor, amount });
      } else a.needs.push({ week: week.plan.week, key, at, amount, parts: [{ legacy: n.legacy, factor: n.factor, amount }] });
      acc.set(n.key, a);
    }
  }
  return acc;
}

/**
 * The entry of one item in one week. Ticks stored under an old key (before names and units were merged) count too,
 * unless the entry under the new key is newer: then an untick is not undone by an old tick.
 */
function resolveEntry(state: MealState, key: string, needs: Need[]): ItemEntry | undefined {
  const canon = state.items[key];
  const old = [...new Set(needs.flatMap((n) => n.parts.map((p) => p.legacy)))].filter((k) => k !== key)
    .flatMap((k) => { const e = state.items[k]; return e && e.state !== 'offen' && (!canon || e.atMs > canon.atMs) ? [{ k, e }] : []; });
  if (old.length === 0) return canon;
  const cover: Record<string, number> = {};
  const give = (n: Need, v: number) => { cover[n.key] = Math.min(n.amount, (cover[n.key] ?? 0) + v); };
  if (canon && canon.state !== 'offen') for (const n of needs) give(n, canon.cover ? canon.cover[n.key] ?? 0 : n.amount);
  for (const { k, e } of old) {
    for (const n of needs) for (const p of n.parts) if (p.legacy === k) give(n, e.cover ? (e.cover[n.key] ?? 0) * p.factor : p.amount);
  }
  const all = [...old.map((o) => o.e), ...(canon && canon.state !== 'offen' ? [canon] : [])];
  const newest = all.reduce((x, y) => (y.atMs > x.atMs ? y : x));
  return Object.values(cover).some((v) => v > EPS) ? { state: newest.state, atMs: newest.atMs, cover } : canon;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const weekOfPlan = (weeks: PlanWeek[], week: string) => weeks.find((w) => w.plan.week === week);

/** What a tick covers of one need: nothing when open, the stored amount, or (old entry without `cover`) the whole need. */
function coverOf(entry: ItemEntry | undefined, n: Need): number {
  if (!entry || entry.state === 'offen') return 0;
  return entry.cover ? entry.cover[n.key] ?? 0 : n.amount;
}

export function windowShoppingList(weeks: PlanWeek[], nowMs: number): WindowList {
  const start = listStart(weeks, nowMs);
  const meals = windowMeals(weeks, nowMs);
  const acc = collectNeeds(meals);
  const all = [...acc.entries()].map(([key, a]) => {
    const resolved = new Map<string, ItemEntry | undefined>();
    for (const n of a.needs) if (!resolved.has(n.week)) { const w = weekOfPlan(weeks, n.week); resolved.set(n.week, w ? resolveEntry(w.state, key, a.needs.filter((x) => x.week === n.week)) : undefined); }
    const entries = a.needs.map((n) => ({ n, e: resolved.get(n.week) }));
    const remaining = sum(a.needs.map((n) => n.amount)) - sum(entries.map(({ n, e }) => coverOf(e, n)));
    let state: ItemState = 'offen';
    let shown = remaining;
    if (remaining <= EPS) {
      const newest = entries.filter(({ n, e }) => e && e.state !== 'offen' && coverOf(e, n) > 0).map(({ e }) => e!).sort((x, y) => y.atMs - x.atMs)[0];
      state = newest?.state ?? 'offen';
      shown = sum(a.needs.map((n) => n.amount));
    }
    const item: ShopItem = { key, name: rowName(a.row), amount: rowAmount(a.row, shown), state, dishes: [...a.row.dishes] };
    return { section: a.row.section, pantry: rowIsPantry(a.row), item };
  });
  const byName = (x: ShopItem, y: ShopItem) => x.name.localeCompare(y.name, 'de');
  const sections = SECTIONS.map((section) => ({ section, items: all.filter((x) => x.section === section && !x.pantry && x.item.state !== 'da').map((x) => x.item).sort(byName) })).filter((s) => s.items.length > 0);
  const pantry = all.filter((x) => x.pantry && x.item.state !== 'da').map((x) => x.item).sort(byName);
  const have = all.filter((x) => x.item.state === 'da').map((x) => x.item).sort(byName);
  const own = weeks.flatMap((w) => Object.entries(w.state.own ?? {}).filter(([, o]) => !o.removed).map(([key, o]) => ({ key, o, week: w.plan.week })))
    .sort((x, y) => (x.o.state === y.o.state ? 0 : x.o.state === 'offen' ? -1 : 1) || x.o.atMs - y.o.atMs)
    .map(({ key, o, week }): ShopItem => ({ key, name: o.name, amount: o.amount, state: o.state, dishes: [], week }));
  const inWindow = [...new Set(meals.map((m) => m.week.plan.week))];
  const newest = weeks.filter((w) => inWindow.includes(w.plan.week)).sort((a, b) => b.plan.week.localeCompare(a.plan.week))[0] ?? [...weeks].sort((a, b) => b.plan.week.localeCompare(a.plan.week))[0];
  return {
    sections, pantry, have, open: all.filter((x) => x.item.state === 'offen').length, total: all.length, own,
    start, lastDay: meals.length > 0 ? meals[meals.length - 1]!.at : null, people: newest?.plan.people.length ?? 0,
  };
}

/** The week of the last window day with a meal; else the current week if it has a plan; else null. */
export function ownWeekOf(weeks: PlanWeek[], nowMs: number): string | null {
  const meals = windowMeals(weeks, nowMs);
  if (meals.length > 0) return meals[meals.length - 1]!.at.week;
  const current = dayRefOf(nowMs).week;
  return weeks.some((w) => w.plan.week === current) ? current : null;
}

/** Is the meal of `at` still ahead of the window, so a tick made now keeps its cover? */
const beyondWindow = (at: DayRef, start: DayRef): boolean => cmpRef(at, addDays(start, 6)) > 0;

const allPlaced = (w: PlanWeek): Placed[] => w.plan.meals.map((meal) => ({ week: w, meal, at: { week: w.plan.week, day: meal.day } }));

export function tickWrites(weeks: PlanWeek[], nowMs: number, key: string, state: ItemState): { week: string; cover?: Record<string, number> }[] {
  const start = listStart(weeks, nowMs);
  const needs = collectNeeds(windowMeals(weeks, nowMs)).get(key)?.needs ?? [];
  const out: { week: string; cover?: Record<string, number> }[] = [];
  for (const w of weeks) {
    const inWeek = needs.filter((n) => n.week === w.plan.week);
    const entry = resolveEntry(w.state, key, collectNeeds(allPlaced(w)).get(key)?.needs ?? []);
    if (state === 'offen') {
      if (entry || inWeek.length > 0) out.push({ week: w.plan.week });
      continue;
    }
    if (inWeek.length === 0) continue;
    const cover: Record<string, number> = Object.fromEntries(inWeek.map((n) => [n.key, n.amount]));
    if (entry && entry.state !== 'offen') {
      if (entry.cover) {
        for (const [k, v] of Object.entries(entry.cover)) {
          const m = parseMealKey(k);
          if (m && beyondWindow({ week: w.plan.week, day: m.day }, start)) cover[k] = v;
        }
      } else {
        const later = w.plan.meals.map((meal) => ({ week: w, meal, at: { week: w.plan.week, day: meal.day } })).filter((p) => beyondWindow(p.at, start));
        for (const n of collectNeeds(later).get(key)?.needs ?? []) cover[n.key] = n.amount;
      }
    }
    out.push({ week: w.plan.week, cover });
  }
  return out;
}

// ---- Stock ----

const slotOrder = (a: Placed, b: Placed) => cmpRef(a.at, b.at) || SLOTS.indexOf(a.meal.slot) - SLOTS.indexOf(b.meal.slot);
const placedFrom = (weeks: PlanWeek[], from: DayRef): Placed[] =>
  weeks.flatMap((week) => week.plan.meals.map((meal) => ({ week, meal, at: { week: week.plan.week, day: meal.day } }))).filter((p) => cmpRef(p.at, from) >= 0).sort(slotOrder);

/** Per item the cover on meals at or after `from`, in any week. */
export function stockOf(weeks: PlanWeek[], from: DayRef): StockItem[] {
  const acc = collectNeeds(placedFrom(weeks, from));
  const names = collectNeeds(weeks.flatMap((week) => week.plan.meals.map((meal) => ({ week, meal, at: { week: week.plan.week, day: meal.day } }))));
  const found = new Map<string, { amount: number; state: 'gekauft' | 'da'; atMs: number }>();
  const add = (key: string, amount: number, e: ItemEntry) => {
    if (amount <= EPS || e.state === 'offen') return;
    const have = found.get(key);
    found.set(key, { amount: (have?.amount ?? 0) + amount, state: !have || e.atMs >= have.atMs ? e.state : have.state, atMs: Math.max(have?.atMs ?? 0, e.atMs) });
  };
  for (const w of weeks) {
    const moved = Object.entries(w.state.items).map(([old, e]) => ({ old, e, ...migrateKey(old) }));
    for (const { old, e, key, factor } of moved) {
      if (e.state === 'offen') continue;
      const canon = w.state.items[key];
      if (old !== key && canon && canon.atMs >= e.atMs) continue;
      if (e.cover) {
        add(key, factor * sum(Object.entries(e.cover).filter(([k]) => { const m = parseMealKey(k); return m !== null && cmpRef({ week: w.plan.week, day: m.day }, from) >= 0; }).map(([, v]) => v)), e);
      } else {
        add(key, sum((acc.get(key)?.needs ?? []).filter((n) => n.week === w.plan.week).map((n) => n.amount)), e);
      }
    }
  }
  const out: StockItem[] = [];
  for (const [key, f] of found) {
    const [name, family] = key.split('|') as [string, string];
    const known = names.get(key);
    const unit: Unit | null = known?.row.unit ?? ((UNITS as readonly string[]).includes(family) ? family as Unit : null);
    if (!unit || PANTRY.includes(unit)) continue;
    out.push({ key, name: known ? rowName(known.row) : name, unit, amount: f.amount, state: f.state });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** After a replan: the bought amounts move onto the new dishes, in date and slot order. What no dish needs is dropped. */
export function retieStock(weeks: PlanWeek[], from: DayRef, stock: StockItem[], atMs: number): Record<string, MealState> {
  const placed = placedFrom(weeks, from);
  const touched = new Map<string, MealState>();
  const stateOf = (w: PlanWeek) => touched.get(w.plan.week) ?? w.state;
  for (const s of stock) {
    const needs = (collectNeeds(placed).get(s.key)?.needs ?? []).slice().sort((a, b) => cmpRef(a.at, b.at) || SLOTS.indexOf(parseMealKey(a.key)!.slot) - SLOTS.indexOf(parseMealKey(b.key)!.slot));
    let left = s.amount;
    const fresh = new Map<string, Record<string, number>>();
    for (const n of needs) {
      if (left <= EPS) break;
      const give = Math.min(n.amount, left);
      left -= give;
      fresh.set(n.week, { ...(fresh.get(n.week) ?? {}), [n.key]: give });
    }
    for (const w of weeks) {
      const old = resolveEntry(w.state, s.key, collectNeeds(allPlaced(w)).get(s.key)?.needs ?? []);
      const before = (() => {
        if (!old || old.state === 'offen') return {} as Record<string, number>;
        if (old.cover) return Object.fromEntries(Object.entries(old.cover).filter(([k]) => { const m = parseMealKey(k); return m !== null && cmpRef({ week: w.plan.week, day: m.day }, from) < 0; }));
        const earlier = w.plan.meals.map((meal) => ({ week: w, meal, at: { week: w.plan.week, day: meal.day } })).filter((p) => cmpRef(p.at, from) < 0);
        return Object.fromEntries((collectNeeds(earlier).get(s.key)?.needs ?? []).map((n) => [n.key, n.amount]));
      })();
      const cover = { ...before, ...(fresh.get(w.plan.week) ?? {}) };
      if (!old && !fresh.has(w.plan.week)) continue;
      const st = stateOf(w);
      const entry: ItemEntry = Object.keys(cover).length === 0 ? { state: 'offen', atMs } : { state: s.state, atMs, cover };
      touched.set(w.plan.week, { ...st, items: { ...st.items, [s.key]: entry } });
    }
  }
  return Object.fromEntries(touched);
}

export const stockNames = (stock: StockItem[]): string[] => stock.map((s) => s.name);
