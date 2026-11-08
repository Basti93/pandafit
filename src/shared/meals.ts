/**
 * The household's weekly meal plan: types, week arithmetic, portions and the shopping list. Pure code, shared by the coach,
 * the Mac app and the phone. No calories, no weight: protein is one rough number per portion.
 */

export const SLOTS = ['fruehstueck', 'mittag', 'abend'] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = { fruehstueck: 'Frühstück', mittag: 'Mittagessen', abend: 'Abendessen' };
export const SLOT_TIME: Record<Slot, string> = { fruehstueck: '8:00', mittag: '13:00', abend: '19:00' };
export const DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export const DAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'] as const;

export type Diet = 'vegetarisch' | 'vegan' | 'alles';
export const DIETS: readonly Diet[] = ['vegetarisch', 'vegan', 'alles'];
/** Where a person usually has a meal on a workday. At the weekend every meal is at home. */
export type Habit = 'zuhause' | 'mitnehmen' | 'auswaerts';
export const HABITS: readonly Habit[] = ['zuhause', 'mitnehmen', 'auswaerts'];
export type MealSettings = { on: boolean; diet: Diet; dislikes: string[]; intolerances: string[]; habits: Record<Slot, Habit> };
export const DEFAULT_MEAL_SETTINGS: MealSettings = { on: false, diet: 'vegetarisch', dislikes: [], intolerances: [], habits: { fruehstueck: 'zuhause', mittag: 'mitnehmen', abend: 'zuhause' } };

export const SECTIONS = ['Obst und Gemüse', 'Kühlregal', 'Brot und Backwaren', 'Vorrat', 'Tiefkühl', 'Sonstiges'] as const;
export type Section = (typeof SECTIONS)[number];
export const UNITS = ['g', 'ml', 'Stk', 'EL', 'TL', 'Prise', 'Bund', 'Dose', 'Zehe', 'Scheibe'] as const;
export type Unit = (typeof UNITS)[number];

/** Amounts are per portion. `raw`: eaten raw, so a dislike like "rohe Zwiebeln" applies. */
export type Ingredient = { name: string; amount: number; unit: Unit; section: Section; raw?: boolean };
/**
 * `source`: 'coach' the coach invented it, 'liste' from the built-in list, 'rezept' a real recipe (the collection or a person's link),
 * which then has `sourceUrl`. A `proteinG` of 0 means unknown for a real recipe.
 */
export type Dish = { title: string; ingredients: Ingredient[]; steps: string[]; minutes: number; proteinG: number; keepsDays: number; source: 'coach' | 'liste' | 'rezept'; recipeId?: string; sourceUrl?: string; side?: Side };
/** A simple protein side that tops up a dish low in protein ("dazu: 150 g Skyr"). Amount and protein are per portion; it is shopped like an ingredient. */
export type Side = { name: string; amount: number; unit: Unit; section: Section; proteinG: number };
/** The side as an ingredient line, for the shopping list. */
export const sideIngredient = (s: Side): Ingredient => ({ name: s.name, amount: s.amount, unit: s.unit, section: s.section });
/** "150 g Skyr", "2 Stk Eier". */
export const sideText = (s: Side): string => `${s.unit === 'Stk' ? `${s.amount} Stk` : `${s.amount} ${s.unit}`} ${s.name}`;

/** A link to show: https only, no spaces, not absurdly long. Anything else is dropped, so a record can never put a script into a link. */
export const safeLink = (x: unknown): string | null => {
  if (typeof x !== 'string' || x.length > 500 || /\s/.test(x)) return null;
  try { const u = new URL(x); return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null; } catch { return null; }
};
/** `reuseOf` names the meal this one is the rest of (cook once, eat twice): it has nothing of its own to shop or cook. */
export type Meal = { day: number; slot: Slot; dish: Dish; reuseOf: string | null; eaters: string[]; takeAlong: boolean; /** Changed in the chat with the coach at this person's wish. */ askedBy?: string };
export type Person = { id: string; name: string; avatar?: string };
export type MealPlan = { week: string; createdMs: number; source: 'coach' | 'liste' | 'gemischt'; people: Person[]; meals: Meal[]; trainingDays: number[] };
export type ItemState = 'offen' | 'gekauft' | 'da';
/** Changes on top of the plan, each with its own time, so two devices merge entry by entry. */
export type MealState = {
  eaters: Record<string, Record<string, { on: boolean; atMs: number }>>;
  items: Record<string, { state: ItemState; atMs: number }>;
  /** The person's own shopping items ("Kaffee"), added on the phone. They live here, not in the plan, so a new plan for the week never touches them. */
  own?: Record<string, OwnItem>;
};
/** `removed` is a tombstone: a removed item must not come back when another device still has it. */
export type OwnItem = { name: string; amount: string; state: 'offen' | 'gekauft'; removed: boolean; atMs: number };
export const OWN_NAME_MAX = 60;
export const OWN_AMOUNT_MAX = 30;
export const OWN_MAX = 80;
export const isOwnKey = (key: string): boolean => /^own-[a-z0-9]{4,24}$/.test(key);
export const newOwnKey = (random: () => number = Math.random): string => `own-${Math.floor(random() * 2 ** 40).toString(36).padStart(8, '0')}`;
export const EMPTY_STATE: MealState = { eaters: {}, items: {} };

export const mealKey = (day: number, slot: Slot): string => `${day}-${slot}`;
export const parseMealKey = (key: string): { day: number; slot: Slot } | null => {
  const m = /^([0-6])-(fruehstueck|mittag|abend)$/.exec(key);
  return m ? { day: Number(m[1]), slot: m[2] as Slot } : null;
};

// ---- Weeks, in local time ----

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Monday 0 … Sunday 6. */
export const dayIndex = (ms: number): number => (new Date(ms).getDay() + 6) % 7;
/** The Monday of the week `ms` lies in, as YYYY-MM-DD. */
export const weekOf = (ms: number): string => {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - dayIndex(ms));
  return dateKey(d);
};
export const dateOf = (week: string, day: number): Date => {
  const [y, m, d] = week.split('-').map(Number);
  return new Date(y!, m! - 1, d! + day, 12);
};
export const addWeeks = (week: string, n: number): string => dateKey(dateOf(week, 7 * n));
export const isWeekKey = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && dateKey(dateOf(x, 0)) === x && dateOf(x, 0).getDay() === 1;
export const dayDate = (week: string, day: number): string => { const d = dateOf(week, day); return `${d.getDate()}.${d.getMonth() + 1}.`; };
export const weekRangeText = (week: string): string => `${dayDate(week, 0)} bis ${dayDate(week, 6)}`;

// ---- Who eats, how much is cooked ----

export function eatersOf(plan: MealPlan, state: MealState, key: string): string[] {
  const meal = plan.meals.find((m) => mealKey(m.day, m.slot) === key);
  if (!meal) return [];
  const over = state.eaters[key] ?? {};
  return plan.people.map((p) => p.id).filter((id) => (over[id] ? over[id]!.on : meal.eaters.includes(id)));
}

/** The meals that eat the rest of `key`. */
export const reusesOf = (plan: MealPlan, key: string): Meal[] => plan.meals.filter((m) => m.reuseOf === key);

/** Portions to cook for a meal: its own eaters and those of every meal that eats its rest. A rest itself cooks nothing. */
export function cookPortions(plan: MealPlan, state: MealState, key: string): { total: number; parts: { day: number; slot: Slot; count: number }[] } {
  const meal = plan.meals.find((m) => mealKey(m.day, m.slot) === key);
  if (!meal || meal.reuseOf) return { total: 0, parts: [] };
  const parts = [meal, ...reusesOf(plan, key)].map((m) => ({ day: m.day, slot: m.slot, count: eatersOf(plan, state, mealKey(m.day, m.slot)).length }));
  return { total: parts.reduce((a, p) => a + p.count, 0), parts };
}

export const withEater = (state: MealState, key: string, person: string, on: boolean, atMs: number): MealState =>
  ({ ...state, eaters: { ...state.eaters, [key]: { ...(state.eaters[key] ?? {}), [person]: { on, atMs } } } });
export const withItem = (state: MealState, item: string, s: ItemState, atMs: number): MealState =>
  ({ ...state, items: { ...state.items, [item]: { state: s, atMs } } });
/** Adds an own item (blank names are ignored); `change` ticks or removes one that is there. */
export function withOwn(state: MealState, key: string, name: string, amount: string, atMs: number): MealState {
  const n = name.trim().replace(/\s+/g, ' ').slice(0, OWN_NAME_MAX);
  if (!n || !isOwnKey(key)) return state;
  return { ...state, own: { ...state.own, [key]: { name: n, amount: amount.trim().replace(/\s+/g, ' ').slice(0, OWN_AMOUNT_MAX), state: 'offen', removed: false, atMs } } };
}
export function changeOwn(state: MealState, key: string, change: { state: 'offen' | 'gekauft' } | { removed: true }, atMs: number): MealState {
  const have = state.own?.[key];
  if (!have) return state;
  return { ...state, own: { ...state.own, [key]: { ...have, ...change, atMs } } };
}

/** Entry by entry, the newer one wins; a tie goes to the greater JSON text so every device ends the same. */
export function mergeStates(a: MealState, b: MealState): MealState {
  const pick = <T extends { atMs: number }>(x: T | undefined, y: T | undefined): T | undefined => {
    if (!x) return y;
    if (!y) return x;
    if (x.atMs !== y.atMs) return x.atMs > y.atMs ? x : y;
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  };
  const eaters: MealState['eaters'] = {};
  for (const key of new Set([...Object.keys(a.eaters), ...Object.keys(b.eaters)])) {
    const ea = a.eaters[key] ?? {}, eb = b.eaters[key] ?? {};
    eaters[key] = {};
    for (const p of new Set([...Object.keys(ea), ...Object.keys(eb)])) eaters[key]![p] = pick(ea[p], eb[p])!;
  }
  const items: MealState['items'] = {};
  for (const k of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) items[k] = pick(a.items[k], b.items[k])!;
  const own: Record<string, OwnItem> = {};
  for (const k of new Set([...Object.keys(a.own ?? {}), ...Object.keys(b.own ?? {})])) own[k] = pick(a.own?.[k], b.own?.[k])!;
  return { eaters, items, ...(Object.keys(own).length > 0 ? { own } : {}) };
}

// ---- Shopping list ----

const lower = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const PANTRY_UNITS: readonly Unit[] = ['EL', 'TL', 'Prise'];
type Family = 'g' | 'ml' | 'Stk' | 'Bund' | 'Dose' | 'Zehe' | 'Scheibe' | 'etwas';
const familyOf = (u: Unit): Family => (PANTRY_UNITS.includes(u) ? 'etwas' : (u as Family));
export const itemKey = (name: string, unit: Unit): string => `${lower(name)}|${familyOf(unit)}`;

/** Common pack sizes, so the list says what to take from the shelf. */
const PLURAL: Record<string, string> = { Packung: 'Packungen', Becher: 'Becher', Beutel: 'Beutel' };
const PACKS: Record<string, { size: number; label: string }> = {
  magerquark: { size: 500, label: 'Becher' }, skyr: { size: 450, label: 'Becher' }, 'hüttenkäse': { size: 200, label: 'Becher' },
  naturjoghurt: { size: 500, label: 'Becher' }, 'griechischer joghurt': { size: 500, label: 'Becher' }, sojajoghurt: { size: 500, label: 'Becher' },
  'tofu natur': { size: 200, label: 'Packung' }, 'räuchertofu': { size: 200, label: 'Packung' }, feta: { size: 200, label: 'Packung' }, halloumi: { size: 225, label: 'Packung' },
  mozzarella: { size: 125, label: 'Packung' }, haferflocken: { size: 500, label: 'Packung' }, vollkornnudeln: { size: 500, label: 'Packung' },
  basmatireis: { size: 500, label: 'Packung' }, quinoa: { size: 400, label: 'Packung' }, bulgur: { size: 500, label: 'Packung' },
  'rote linsen': { size: 500, label: 'Packung' }, tellerlinsen: { size: 500, label: 'Packung' }, 'passierte tomaten': { size: 500, label: 'Packung' },
  milch: { size: 1000, label: 'Packung' }, hafermilch: { size: 1000, label: 'Packung' }, 'tk-beeren': { size: 300, label: 'Beutel' },
  'tk-erbsen': { size: 450, label: 'Beutel' }, babyspinat: { size: 125, label: 'Beutel' }, kartoffeln: { size: 1000, label: 'Beutel' },
  sojaschnetzel: { size: 150, label: 'Packung' }, hummus: { size: 200, label: 'Becher' }, 'tk-brokkoli': { size: 450, label: 'Beutel' },
};
const SLICES_PER_LOAF = 10;
const CLOVES_PER_BULB = 10;

const de = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
const ceilTo = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step;
const roundMass = (n: number, unit: 'g' | 'ml'): string => {
  if (n >= 1000) return `${de(ceilTo(n, 100) / 1000)} ${unit === 'g' ? 'kg' : 'l'}`;
  return `${n < 100 ? ceilTo(n, 10) : ceilTo(n, 50)} ${unit}`;
};

/** The amount to buy, rounded to what a shop sells. */
export function shopAmount(name: string, unit: Unit, amount: number): string {
  const fam = familyOf(unit);
  const pack = PACKS[lower(name)];
  if (fam === 'etwas') return 'aus dem Vorrat';
  if ((fam === 'g' || fam === 'ml') && pack) {
    const n = Math.max(1, Math.ceil(amount / pack.size - 1e-9));
    return `${n} ${n === 1 ? pack.label : PLURAL[pack.label] ?? pack.label} à ${pack.size >= 1000 ? `${de(pack.size / 1000)} ${fam === 'g' ? 'kg' : 'l'}` : `${pack.size} ${fam}`}`;
  }
  if (fam === 'g' || fam === 'ml') return roundMass(amount, fam);
  if (fam === 'Zehe') { const n = Math.max(1, Math.ceil(amount / CLOVES_PER_BULB - 1e-9)); return n === 1 ? '1 Knolle' : `${n} Knollen`; }
  if (fam === 'Scheibe') { const n = Math.max(1, Math.ceil(amount / SLICES_PER_LOAF - 1e-9)); return `${n} ${n === 1 ? 'Brot' : 'Brote'} (${Math.ceil(amount - 1e-9)} Scheiben)`; }
  const n = Math.max(1, Math.ceil(amount - 1e-9));
  if (fam === 'Dose') return `${n} ${n === 1 ? 'Dose' : 'Dosen'}`;
  if (fam === 'Bund') return `${n} Bund`;
  return `${n} Stück`;
}

/** An amount in a recipe for `portions` people, readable. */
export function recipeAmount(i: Ingredient, portions: number): string {
  const n = i.amount * portions;
  if (i.unit === 'Prise') return n <= 1 ? '1 Prise' : `${Math.ceil(n)} Prisen`;
  if (i.unit === 'g' || i.unit === 'ml') return n >= 1000 ? `${de(n / 1000)} ${i.unit === 'g' ? 'kg' : 'l'}` : `${Math.round(n / 5) * 5 || Math.round(n)} ${i.unit}`;
  const v = Math.round(n * 2) / 2;
  const t = v === 0.5 ? '½' : Number.isInteger(v) ? String(v) : `${Math.floor(v)}½`;
  if (i.unit === 'Stk') return t;
  if (i.unit === 'Zehe') return `${t} ${v > 1 ? 'Zehen' : 'Zehe'}`;
  if (i.unit === 'Scheibe') return `${t} ${v > 1 ? 'Scheiben' : 'Scheibe'}`;
  if (i.unit === 'Dose') return `${t} ${v > 1 ? 'Dosen' : 'Dose'}`;
  return `${t} ${i.unit}`;
}

export type ShopItem = { key: string; name: string; amount: string; state: ItemState; dishes: string[] };
/** `pantry`: spoonfuls and pinches, usually at home already: only a reminder to check. */
export type ShopList = {
  sections: { section: Section; items: ShopItem[] }[]; pantry: ShopItem[]; have: ShopItem[]; open: number; total: number;
  /** The person's own items, open ones first. Not part of `open` and `total`, which count what the plan needs. */
  own: ShopItem[];
};

/** Every ingredient of the week, summed over the portions really eaten, grouped by supermarket section. */
export function shoppingList(plan: MealPlan, state: MealState): ShopList {
  const acc = new Map<string, { name: string; unit: Unit; amount: number; section: Section; dishes: Set<string> }>();
  for (const m of plan.meals) {
    if (m.reuseOf) continue;
    const portions = cookPortions(plan, state, mealKey(m.day, m.slot)).total;
    if (portions === 0) continue;
    for (const i of m.dish.side ? [...m.dish.ingredients, sideIngredient(m.dish.side)] : m.dish.ingredients) {
      const key = itemKey(i.name, i.unit);
      const have = acc.get(key);
      if (have) { have.amount += i.amount * portions; have.dishes.add(m.dish.title); } else acc.set(key, { name: i.name.trim(), unit: i.unit, amount: i.amount * portions, section: i.section, dishes: new Set([m.dish.title]) });
    }
  }
  const all = [...acc.entries()].map(([key, a]) => ({ section: a.section, pantry: familyOf(a.unit) === 'etwas', item: { key, name: a.name, amount: shopAmount(a.name, a.unit, a.amount), state: state.items[key]?.state ?? 'offen', dishes: [...a.dishes] } as ShopItem }));
  const byName = (x: ShopItem, y: ShopItem) => x.name.localeCompare(y.name, 'de');
  const sections = SECTIONS.map((section) => ({ section, items: all.filter((x) => x.section === section && !x.pantry && x.item.state !== 'da').map((x) => x.item).sort(byName) })).filter((s) => s.items.length > 0);
  const pantry = all.filter((x) => x.pantry && x.item.state !== 'da').map((x) => x.item).sort(byName);
  const have = all.filter((x) => x.item.state === 'da').map((x) => x.item).sort(byName);
  const own = Object.entries(state.own ?? {}).filter(([, o]) => !o.removed).sort(([, x], [, y]) => (x.state === y.state ? 0 : x.state === 'offen' ? -1 : 1) || x.atMs - y.atMs)
    .map(([key, o]): ShopItem => ({ key, name: o.name, amount: o.amount, state: o.state, dishes: [] }));
  return { sections, pantry, have, open: all.filter((x) => x.item.state === 'offen').length, total: all.length, own };
}

// ---- Reading records: anything else is skipped, never thrown ----

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string';
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const readIngredient = (x: unknown): Ingredient | null =>
  isObj(x) && str(x.name) && num(x.amount) && UNITS.includes(x.unit as Unit) && SECTIONS.includes(x.section as Section)
    ? { name: x.name, amount: x.amount, unit: x.unit as Unit, section: x.section as Section, ...(x.raw === true ? { raw: true } : {}) } : null;
const readSide = (x: unknown): Side | null =>
  isObj(x) && str(x.name) && x.name.trim() !== '' && num(x.amount) && x.amount > 0 && UNITS.includes(x.unit as Unit) && SECTIONS.includes(x.section as Section) && num(x.proteinG) && x.proteinG >= 0
    ? { name: x.name.trim().slice(0, 60), amount: x.amount, unit: x.unit as Unit, section: x.section as Section, proteinG: x.proteinG } : null;
const readDish = (x: unknown): Dish | null => {
  if (!isObj(x) || !str(x.title) || !Array.isArray(x.ingredients) || !Array.isArray(x.steps) || !num(x.minutes) || !num(x.proteinG) || !num(x.keepsDays)) return null;
  const ingredients = x.ingredients.map(readIngredient);
  if (ingredients.some((i) => i === null) || !x.steps.every(str)) return null;
  return { title: x.title, ingredients: ingredients as Ingredient[], steps: x.steps as string[], minutes: x.minutes, proteinG: x.proteinG, keepsDays: x.keepsDays, source: x.source === 'coach' ? 'coach' : x.source === 'rezept' && safeLink(x.sourceUrl) ? 'rezept' : 'liste', ...(str(x.recipeId) ? { recipeId: x.recipeId } : {}), ...(x.source === 'rezept' && safeLink(x.sourceUrl) ? { sourceUrl: safeLink(x.sourceUrl)! } : {}), ...(readSide(x.side) ? { side: readSide(x.side)! } : {}) };
};

export function readMealPlan(body: unknown): MealPlan | null {
  if (!isObj(body) || !isWeekKey(body.week) || !Array.isArray(body.people) || !Array.isArray(body.meals)) return null;
  const people = body.people.flatMap((p): Person[] => (isObj(p) && str(p.id) && str(p.name) ? [{ id: p.id, name: p.name, ...(str(p.avatar) ? { avatar: p.avatar } : {}) }] : []));
  const meals = body.meals.flatMap((m): Meal[] => {
    if (!isObj(m) || !num(m.day) || m.day < 0 || m.day > 6 || !SLOTS.includes(m.slot as Slot) || !Array.isArray(m.eaters)) return [];
    const dish = readDish(m.dish);
    if (!dish) return [];
    return [{ day: m.day, slot: m.slot as Slot, dish, reuseOf: str(m.reuseOf) && parseMealKey(m.reuseOf) ? m.reuseOf : null, eaters: m.eaters.filter(str), takeAlong: m.takeAlong === true, ...(str(m.askedBy) ? { askedBy: m.askedBy } : {}) }];
  });
  const trainingDays = Array.isArray(body.trainingDays) ? body.trainingDays.filter((d): d is number => num(d) && d >= 0 && d <= 6) : [];
  const source = body.source === 'coach' || body.source === 'gemischt' ? body.source : 'liste';
  return { week: body.week, createdMs: num(body.createdMs) ? body.createdMs : 0, source, people, meals, trainingDays };
}

export function readMealState(body: unknown): MealState {
  const out: MealState = { eaters: {}, items: {} };
  if (!isObj(body)) return out;
  if (isObj(body.eaters)) {
    for (const [key, per] of Object.entries(body.eaters)) {
      if (!parseMealKey(key) || !isObj(per)) continue;
      for (const [p, v] of Object.entries(per)) if (isObj(v) && typeof v.on === 'boolean' && num(v.atMs)) (out.eaters[key] ??= {})[p] = { on: v.on, atMs: v.atMs };
    }
  }
  if (isObj(body.items)) {
    for (const [k, v] of Object.entries(body.items)) if (isObj(v) && (v.state === 'offen' || v.state === 'gekauft' || v.state === 'da') && num(v.atMs)) out.items[k] = { state: v.state, atMs: v.atMs };
  }
  if (isObj(body.own)) {
    const own: Record<string, OwnItem> = {};
    for (const [k, v] of Object.entries(body.own)) {
      if (Object.keys(own).length >= OWN_MAX) break;
      if (!isOwnKey(k) || !isObj(v) || !str(v.name) || !num(v.atMs) || (v.state !== 'offen' && v.state !== 'gekauft')) continue;
      const name = v.name.trim().slice(0, OWN_NAME_MAX);
      if (name) own[k] = { name, amount: str(v.amount) ? v.amount.trim().slice(0, OWN_AMOUNT_MAX) : '', state: v.state, removed: v.removed === true, atMs: v.atMs };
    }
    if (Object.keys(own).length > 0) out.own = own;
  }
  return out;
}

/** Record ids of the `mealplan` kind. */
export const planRecordId = (week: string) => `week-${week}`;
export const stateRecordId = (week: string) => `state-${week}`;
export const weekOfRecordId = (id: string): { week: string; part: 'week' | 'state' } | null => {
  const m = /^(week|state)-(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m && isWeekKey(m[2]) ? { week: m[2]!, part: m[1] as 'week' | 'state' } : null;
};

// ---- The chat with the coach about the plan ----

/**
 * One message to the coach and its answer. Per person: it lives in that person's account as a `mealplan` record with
 * the id `chat-…`, written first by the device it was typed on and then once more by the Mac with the reply.
 */
export type MealChat = { id: string; week: string; text: string; atMs: number; reply: string | null; answeredMs: number | null; changed: string[] };
export const CHAT_MAX_CHARS = 300;
export const isChatRecordId = (id: string): boolean => /^chat-[a-z0-9]{4,40}$/.test(id);
export const newChatId = (nowMs: number, random: () => number = Math.random): string => `chat-${Math.round(nowMs).toString(36)}${Math.floor(random() * 2 ** 40).toString(36).padStart(8, '0')}`;
export function readMealChat(id: string, body: unknown): MealChat | null {
  if (!isChatRecordId(id) || !isObj(body) || !isWeekKey(body.week) || !str(body.text) || !num(body.atMs)) return null;
  const text = body.text.trim().slice(0, CHAT_MAX_CHARS);
  if (!text) return null;
  const changed = Array.isArray(body.changed) ? body.changed.filter((k): k is string => str(k) && parseMealKey(k) !== null) : [];
  return { id, week: body.week, text, atMs: body.atMs, reply: str(body.reply) ? body.reply : null, answeredMs: num(body.answeredMs) ? body.answeredMs : null, changed };
}

// ---- Own recipes by link: the request and the answer are records of the person's account, like the chat ----

export type LinkState = 'saved' | 'wait' | 'veg' | 'none' | 'limit' | 'bad' | 'fetch';
export type LinkResult = { state: LinkState; title?: string };
/** A person's request to add a recipe by link, first written by the device, then once more by the coach with the answer. */
export type LinkRequest = { id: string; url: string; atMs: number; result: LinkResult | null; answeredMs: number | null };
export const LINK_URL_MAX = 500;
export const isLinkRecordId = (id: string): boolean => /^link-[a-z0-9]{4,40}$/.test(id);
export const newLinkId = (nowMs: number, random: () => number = Math.random): string => `link-${Math.round(nowMs).toString(36)}${Math.floor(random() * 2 ** 40).toString(36).padStart(8, '0')}`;
const LINK_STATES: readonly string[] = ['saved', 'wait', 'veg', 'none', 'limit', 'bad', 'fetch'];
export function readLinkRequest(id: string, body: unknown): LinkRequest | null {
  if (!isLinkRecordId(id) || !isObj(body) || !str(body.url) || !num(body.atMs)) return null;
  const url = body.url.trim().slice(0, LINK_URL_MAX);
  if (!url) return null;
  const r = isObj(body.result) && LINK_STATES.includes(body.result.state as string) ? { state: body.result.state as LinkState, ...(str(body.result.title) ? { title: body.result.title.slice(0, 120) } : {}) } : null;
  return { id, url, atMs: body.atMs, result: r, answeredMs: num(body.answeredMs) ? body.answeredMs : null };
}
/** What the person reads after adding a link. */
export const linkAnswer = (r: LinkResult | null): string => {
  switch (r?.state) {
    case 'saved': return `Gespeichert: ${r.title ?? 'Rezept'}`;
    case 'wait': return `Gespeichert: ${r.title ?? 'Rezept'}. Das Rezept wird noch aufbereitet.`;
    case 'veg': return 'Das Rezept ist nicht vegetarisch. Darum ist es nicht gespeichert.';
    case 'none': return 'Auf der Seite ist kein Rezept zu finden';
    case 'limit': return 'Für heute sind es genug Rezepte. Morgen geht es weiter.';
    case 'bad': return 'Das ist kein Link, den ich öffnen kann. Er muss mit https beginnen.';
    case 'fetch': return 'Die Seite war nicht zu erreichen. Versuch es später noch einmal.';
    default: return 'Der Coach schaut sich die Seite gleich an.';
  }
};

/** A person's own recipe in their list ("Eigene Rezepte"), written by the coach; deleting the record deletes the recipe. */
export type OwnRecipe = { id: string; title: string; sourceUrl: string; minutes: number };
export const isRecipeRecordId = (id: string): boolean => /^recipe-[a-z0-9-]{4,40}$/.test(id);
export function readOwnRecipe(id: string, body: unknown): OwnRecipe | null {
  if (!isRecipeRecordId(id) || !isObj(body) || !str(body.title) || !num(body.minutes)) return null;
  const sourceUrl = safeLink(body.sourceUrl);
  return sourceUrl && body.title.trim() ? { id, title: body.title.trim().slice(0, 120), sourceUrl, minutes: body.minutes } : null;
}

// ---- Browsing recipes: what the app asks the coach for, and the favourites ----

/** A recipe in the browse list. `tags` are readable labels, the most telling first. */
export type RecipeSummary = { id: string; title: string; minutes: number; proteinG: number | null; keepsDays: number; own: boolean; fav: boolean; image: boolean; tags: string[] };
/** The recipe view: ingredients are per portion (scale them with `recipeAmount`). */
export type RecipeDetail = RecipeSummary & { ingredients: Ingredient[]; steps: string[]; sourceUrl: string };
export type RecipePage = { items: RecipeSummary[]; more: boolean };
export const RECIPE_PAGE = 20;
/**
 * A favourite is a record of its own per person and recipe: `fav-<recipe id>` in kind `mealplan`, deleted (tombstone) when it is no
 * longer one. Two devices toggling different recipes never touch the same record, and a toggle made offline syncs like any record.
 */
export const RECIPE_ID = /^[cl]-[0-9a-f]{14}$/;
export const isFavRecordId = (id: string): boolean => /^fav-[cl]-[0-9a-f]{14}$/.test(id);
export const favRecordId = (recipeId: string): string => `fav-${recipeId}`;
/** The recipe ids of a person's favourites, from their records. */
export const favouriteIds = (records: readonly { id: string; deleted: boolean }[] | null): Set<string> =>
  new Set((records ?? []).filter((r) => !r.deleted && isFavRecordId(r.id)).map((r) => r.id.slice('fav-'.length)));

// ---- Putting a recipe on the plan: a request record, answered by the coach, like a link ----

export type PlaceState = 'placed' | 'nofit' | 'past' | 'noplan' | 'gone';
/** A person's wish to cook a recipe at a meal; written by the device, answered once more by the coach with `result`. */
export type PlaceRequest = { id: string; week: string; meal: string; recipeId: string; atMs: number; result: PlaceState | null; answeredMs: number | null };
export const isPlaceRecordId = (id: string): boolean => /^place-[a-z0-9]{4,40}$/.test(id);
export const newPlaceId = (nowMs: number, random: () => number = Math.random): string => `place-${Math.round(nowMs).toString(36)}${Math.floor(random() * 2 ** 40).toString(36).padStart(8, '0')}`;
const PLACE_STATES: readonly string[] = ['placed', 'nofit', 'past', 'noplan', 'gone'];
export function readPlaceRequest(id: string, body: unknown): PlaceRequest | null {
  if (!isPlaceRecordId(id) || !isObj(body) || !isWeekKey(body.week) || typeof body.meal !== 'string' || !parseMealKey(body.meal) || typeof body.recipeId !== 'string' || !RECIPE_ID.test(body.recipeId) || !num(body.atMs)) return null;
  return { id, week: body.week, meal: body.meal, recipeId: body.recipeId, atMs: body.atMs, result: PLACE_STATES.includes(body.result as string) ? body.result as PlaceState : null, answeredMs: num(body.answeredMs) ? body.answeredMs : null };
}
export const placeAnswer = (r: PlaceState | null): string => {
  switch (r) {
    case 'placed': return 'Das Rezept ist jetzt im Plan.';
    case 'nofit': return 'Das passt nicht zu den Angaben der Esser dieser Mahlzeit.';
    case 'past': return 'Dieser Tag ist schon vorbei.';
    case 'noplan': return 'Für diese Woche gibt es keinen Plan mehr, den ich ändern kann.';
    case 'gone': return 'Dieses Rezept gibt es nicht mehr.';
    default: return 'Der Coach trägt es gleich ein.';
  }
};

export const initialOf = (p: Person): string => p.avatar || (p.name.trim()[0] ?? '?').toUpperCase();
