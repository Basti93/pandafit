import type { Section, Side, Slot, Unit } from '../../shared/meals';
import { SECTIONS, UNITS } from '../../shared/meals';
import { policyRule, ruleValues } from '../../shared/training-policy';
import { fitsEveryone, type Eater } from './check';

/**
 * The protein side of a dish that is low in protein. The sides are a short register list (`meals.protein-sides`); a side must lift the meal to
 * the per-meal protein target and pass the diet, dislikes and intolerances of everyone eating it.
 */

let parsed: Side[] | null = null;
/** The register list, in its order. */
export function proteinSides(): Side[] {
  if (parsed) return parsed;
  parsed = (policyRule('meals.protein-sides').lists?.sides ?? []).flatMap((line): Side[] => {
    const [name, amount, unit, section, protein] = line.split('|');
    if (!name || !UNITS.includes(unit as Unit) || !SECTIONS.includes(section as Section)) return [];
    return [{ name, amount: Number(amount), unit: unit as Unit, section: section as Section, proteinG: Number(protein) }];
  });
  return parsed;
}

/** Protein one meal should reach: dinner is lighter. */
export const proteinTarget = (slot: Slot): number => { const v = ruleValues('meals.protein-sides'); return slot === 'abend' ? v.dinnerTarget! : v.mainTarget!; };

/**
 * Sides that bring a dish with `dishProteinG` to the target of `slot` and suit every eater. Empty when none fits; `null` when the dish needs
 * no side (it reaches the target alone).
 */
export function sideCandidates(dishProteinG: number, slot: Slot, eaters: readonly Eater[]): Side[] | null {
  const target = proteinTarget(slot);
  if (dishProteinG >= target) return null;
  return proteinSides().filter((s) => dishProteinG + s.proteinG >= target && fitsEveryone({ title: s.name, ingredients: [{ name: s.name, amount: s.amount, unit: s.unit, section: s.section }], steps: [] }, [...eaters]));
}
