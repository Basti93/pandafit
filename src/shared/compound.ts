import type { Exercise } from './exercises';
import { muscleGroupOf } from './muscle-targets';

/**
 * Compound: a secondary muscle in another muscle group than the primary one, so a movement over more than one joint group.
 * Everything else is isolation. The rest and the weekly isolation limit both ask here.
 */
export const isCompound = (e: Pick<Exercise, 'primaryMuscle' | 'secondaryMuscles'>): boolean =>
  (e.secondaryMuscles ?? []).some((m) => muscleGroupOf({ primaryMuscle: m }) !== muscleGroupOf(e));
