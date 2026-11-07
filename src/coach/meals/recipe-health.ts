import type { Slot } from '../../shared/meals';
import { ruleValues } from '../../shared/training-policy';

/**
 * The healthy-meal gate. Nutrition per portion is read from the schema.org `nutrition` object; the gate itself (thresholds in the policy
 * register, `meals.healthy-gate`) decides from the AI's classification and from the stated nutrition, when there is one.
 */

export type Nutrition = { kcal?: number; proteinG?: number; fatG?: number; carbsG?: number; sugarG?: number; fiberG?: number };
export type Ausgewogen = 'gut' | 'mittel' | 'wenig';
export const AUSGEWOGEN: readonly Ausgewogen[] = ['gut', 'mittel', 'wenig'];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The first number in a value ("522 kcal", "28,5 g", 12), with its unit text; null when there is none. */
function quantity(x: unknown): { n: number; unit: string } | null {
  const t = typeof x === 'number' ? String(x) : typeof x === 'string' ? x : '';
  const m = /(\d+(?:[.,]\d+)?)\s*([a-zA-Z]*)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? { n, unit: m[2]!.toLowerCase() } : null;
}

/** Portions a `servingSize` like "4 Portionen" stands for (the values then cover that many); 1 for "1 Portion", a weight or nothing. */
function servings(x: unknown): number {
  const t = typeof x === 'string' ? x : '';
  const m = /(\d+(?:[.,]\d+)?)\s*(portion|portionen|serving|servings|stueck|stück)\b/i.exec(t);
  const n = m ? Number(m[1]!.replace(',', '.')) : 1;
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : 1;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The stated nutrition per portion, or null when nothing usable is there. schema.org states it per serving; "N Portionen" is divided by N. */
export function parseNutrition(x: unknown): Nutrition | null {
  if (!isObj(x)) return null;
  const per = servings(x.servingSize);
  const out: Nutrition = {};
  const kcal = quantity(x.calories);
  if (kcal) { const v = /^kj|kilojoule/.test(kcal.unit) ? kcal.n / 4.184 : kcal.n; if (v <= 6000) out.kcal = Math.round(v / per); }
  for (const [key, field] of [['proteinContent', 'proteinG'], ['fatContent', 'fatG'], ['carbohydrateContent', 'carbsG'], ['sugarContent', 'sugarG'], ['fiberContent', 'fiberG']] as const) {
    const q = quantity(x[key]);
    // Milligrams and kilograms are rare here; only plain grams count, anything else is ignored rather than guessed.
    if (q && (q.unit === '' || q.unit === 'g' || q.unit === 'gr' || q.unit === 'gramm') && q.n <= 500) out[field] = round1(q.n / per);
  }
  return Object.keys(out).length > 0 ? out : null;
}

const gate = () => ruleValues('meals.healthy-gate');
export const planGutBoost = (): number => gate().planGutBoost!;

/**
 * Why a recipe is not a healthy meal, or null. `slots` are the recipe's main meal slots from the AI; with none it is no meal at all.
 * Nutrition values that are not stated are not checked. A recipe with several slots passes when one of them fits.
 */
export function unhealthyReason(i: { slots: readonly Slot[]; ausgewogen?: Ausgewogen | undefined; nutrition?: Nutrition | undefined }): string | null {
  const G = gate();
  if (i.slots.length === 0) return 'no main meal';
  if (i.ausgewogen === 'wenig') return 'ausgewogen: wenig';
  const n = i.nutrition;
  if (!n) return null;
  if (n.sugarG !== undefined && n.sugarG > G.sugarMaxG!) return `sugar ${n.sugarG} g`;
  if (n.fatG !== undefined && n.kcal !== undefined && n.kcal > 0 && (n.fatG * 9) / n.kcal > G.fatShareMax!) return 'fat share';
  const fits = (slot: Slot): boolean => {
    const main = slot !== 'fruehstueck';
    const lo = main ? G.mainKcalMin! : G.breakfastKcalMin!, hi = main ? G.mainKcalMax! : G.breakfastKcalMax!, p = main ? G.mainProteinMin! : G.breakfastProteinMin!;
    return (n.kcal === undefined || (n.kcal >= lo && n.kcal <= hi)) && (n.proteinG === undefined || n.proteinG >= p);
  };
  return i.slots.some(fits) ? null : 'energy or protein out of range';
}
