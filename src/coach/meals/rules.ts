import { mealKey, type Dish, type Meal, type MealSettings, type Slot, SLOTS } from '../../shared/meals';
import { fitsEveryone } from './check';
import { RECIPES, type Recipe } from './recipes';

export type Member = { id: string; settings: MealSettings };
/** A meal before it has a dish: who eats it, whether it is taken along, and whose rest it is in the rule plan. */
export type Slotted = Omit<Meal, 'dish'>;

const WORKDAYS = 5;
/** In the rule plan, the lunch cooked on these days also covers the next day's lunch. */
const COOK_TWICE = [0, 2];

/** Who usually eats a meal: on workdays by habit, at the weekend everyone with the plan on. */
export const baseEaters = (members: Member[], day: number, slot: Slot): string[] =>
  members.filter((m) => day >= WORKDAYS || m.settings.habits[slot] !== 'auswaerts').map((m) => m.id);
export const takenAlong = (members: Member[], day: number, slot: Slot): boolean =>
  day < WORKDAYS && members.some((m) => m.settings.habits[slot] === 'mitnehmen');

/** The meals of a week from `fromDay` up to (not including) `toDay`, in order. `pairs`: the rule plan's cook-once-eat-twice lunches. */
export function skeleton(members: Member[], fromDay: number, pairs: boolean, toDay = 7): Slotted[] {
  const out: Slotted[] = [];
  for (let day = fromDay; day < toDay; day++) {
    for (const slot of SLOTS) {
      const reuse = pairs && slot === 'mittag' && COOK_TWICE.includes(day - 1) && day - 1 >= fromDay && takenAlong(members, day - 1, slot);
      out.push({ day, slot, eaters: baseEaters(members, day, slot), takeAlong: takenAlong(members, day, slot), reuseOf: reuse ? mealKey(day - 1, slot) : null });
    }
  }
  return out;
}

export const dishOf = (r: Recipe): Dish => ({ title: r.title, ingredients: r.ingredients.map((i) => ({ ...i })), steps: [...r.steps], minutes: r.minutes, proteinG: r.proteinG, keepsDays: r.keepsDays, source: 'liste', recipeId: r.id });

/** Deterministic randomness, so a week's rule plan is the same on every run. */
export const seeded = (seed: string): (() => number) => {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type PickInput = {
  slot: Slot; eaters: Member[]; takeAlong: boolean; training: boolean;
  /** Days the cooked dish has to keep (its latest rest). */
  keepDays: number;
  /** Recipe ids already in the week: taken only when nothing else fits. */
  used: Set<string>;
  /** Never this one (the dish being swapped). */
  not?: string;
  random: () => number;
};

/** The best recipe for one meal, or null when none in the list fits everyone eating it. */
export function pickRecipe(p: PickInput): Recipe | null {
  const fits = RECIPES.filter((r) => r.slots.includes(p.slot) && r.id !== p.not && r.keepsDays >= p.keepDays && (!p.takeAlong || r.keepsDays >= 1) && fitsEveryone(r, p.eaters.map((e) => e.settings)));
  if (fits.length === 0) return null;
  const fresh = fits.filter((r) => !p.used.has(r.id));
  const pool = fresh.length ? fresh : fits;
  // More protein on training days: the richer half of the list gets a head start.
  const score = (r: Recipe) => p.random() + (p.training && r.proteinG >= 24 ? 0.6 : 0);
  return pool.map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s)[0]!.r;
}

/** Everyone in the household counts for a meal no one eats yet: it may still be switched on. */
export const constraintsFor = (members: Member[], eaters: string[]): Member[] => {
  const who = members.filter((m) => eaters.includes(m.id));
  return who.length ? who : members;
};

/** The rule plan for the meals given: a varied week from the list, rests where the dish keeps long enough. */
export function ruleMeals(members: Member[], slots: Slotted[], trainingDays: number[], random: () => number, used = new Set<string>()): Meal[] {
  const out: Meal[] = [];
  const byKey = new Map<string, Meal>();
  for (const s of slots) {
    const key = mealKey(s.day, s.slot);
    const src = s.reuseOf ? byKey.get(s.reuseOf) : undefined;
    if (src && src.dish.keepsDays >= s.day - src.day && fitsEveryone(src.dish, constraintsFor(members, s.eaters).map((m) => m.settings))) {
      const meal = { ...s, dish: src.dish };
      out.push(meal); byKey.set(key, meal);
      continue;
    }
    const reuses = slots.filter((x) => x.reuseOf === key);
    const keepDays = Math.max(0, ...reuses.map((x) => x.day - s.day));
    const eaters = constraintsFor(members, [...new Set([...s.eaters, ...reuses.flatMap((x) => x.eaters)])]);
    const r = pickRecipe({ slot: s.slot, eaters, takeAlong: s.takeAlong, training: trainingDays.includes(s.day), keepDays, used, random })
      ?? pickRecipe({ slot: s.slot, eaters: constraintsFor(members, s.eaters), takeAlong: s.takeAlong, training: trainingDays.includes(s.day), keepDays: 0, used, random });
    if (!r) continue;
    used.add(r.id);
    const meal = { ...s, reuseOf: null, dish: dishOf(r) };
    out.push(meal); byKey.set(key, meal);
  }
  return out;
}
