import type { Exercise } from '../../shared/exercises';
import type { ExerciseTemplate } from '../../shared/gym/types';
import { muscleGroupOf } from '../../shared/muscle-targets';

/** The primary muscle of an exercise by its template id; undefined when nobody knows it. */
export type MuscleOf = (templateId: string) => string | null | undefined;

/** Resolves a template id as the muscle volume does: the profile's catalog first, then the Hevy template. */
export function muscleOfFrom(templates: readonly ExerciseTemplate[], catalog: readonly Exercise[] = []): MuscleOf {
  const byCatalog = new Map(catalog.map((e) => [e.id, e.primaryMuscle]));
  const byTemplate = new Map(templates.map((t) => [t.id, t.primaryMuscle]));
  return (id) => byCatalog.get(id) ?? byTemplate.get(id);
}

/** Hard sets are the work sets: normal, failure and drop sets. Warm-ups do not tire the muscle in this sense. */
export const hardSetsOf = (sets: readonly { type: string }[]): number => sets.filter((s) => s.type === 'normal' || s.type === 'failure' || s.type === 'dropset').length;

/**
 * Per exercise, in workout order: the hard sets of all earlier exercises of the same muscle group. An exercise without a known
 * muscle group (none, or one that only counts as "other") has 0 and tires nothing. A superset partner counts when it stands earlier in the list, like any earlier exercise.
 */
export function preFatigue(exercises: readonly { primaryMuscle: string | null | undefined; hardSets: number; supersetId: number | null }[]): number[] {
  const done = new Map<string, number>();
  return exercises.map((e) => {
    const group = muscleGroupOf(e);
    if (group === 'other') return 0;
    const before = done.get(group) ?? 0;
    done.set(group, before + e.hardSets);
    return before;
  });
}
