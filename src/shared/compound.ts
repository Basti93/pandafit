import type { Exercise } from './exercises';
import { muscleGroupOf } from './muscle-targets';
import { policyRule } from './training-policy';

/**
 * Compound: a big primary group (the groups of `rest.compound-s`) and a secondary muscle in another group, so a movement over
 * more than one joint group. Everything else is isolation. The rest and the weekly isolation limit both ask here.
 */
export function isCompound(e: Pick<Exercise, 'primaryMuscle' | 'secondaryMuscles'>): boolean {
  const big = policyRule('rest.compound-s').lists?.groups ?? [];
  return big.includes(muscleGroupOf(e)) && (e.secondaryMuscles ?? []).some((m) => muscleGroupOf({ primaryMuscle: m }) !== muscleGroupOf(e));
}
