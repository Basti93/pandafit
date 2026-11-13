import type { Exercise } from '../exercises';
import { contributions } from '../muscle-balance';
import { muscleGroupOf } from '../muscle-targets';
import { policyRule, ruleNumber } from '../training-policy';
import type { ExerciseTemplate } from './types';

const SECONDARY_WEIGHT = ruleNumber('gym.pre-fatigue-secondary-weight');
const SHARE_PER_SET = ruleNumber('gym.pre-fatigue-share-per-set');
const SHARE_MIN = ruleNumber('gym.pre-fatigue-share-min');
const FATIGUE_SYNERGISTS: Record<string, string[]> = policyRule('gym.pre-fatigue-synergists').lists ?? {};

/** The muscles of an exercise as far as they are known: the main muscle and the muscles that work with it. */
export type Muscles = { primaryMuscle: string | null | undefined; secondaryMuscles?: readonly string[] };

/** The primary muscle of an exercise by its template id; undefined when nobody knows it. */
export type MuscleOf = (templateId: string) => string | null | undefined;

/** Resolves a template id to its muscles as the muscle volume does: the catalog first (with secondary muscles), then the Hevy template (main muscle only). */
export function musclesOfFrom(templates: readonly ExerciseTemplate[], catalog: readonly Exercise[] = []): (templateId: string) => Muscles | undefined {
  const byCatalog = new Map(catalog.map((e) => [e.id, e]));
  const byTemplate = new Map(templates.map((t) => [t.id, t.primaryMuscle]));
  return (id) => {
    const c = byCatalog.get(id);
    if (c) return { primaryMuscle: c.primaryMuscle, secondaryMuscles: c.secondaryMuscles };
    return byTemplate.has(id) ? { primaryMuscle: byTemplate.get(id) } : undefined;
  };
}

/** Resolves a template id as the muscle volume does: the profile's catalog first, then the Hevy template. */
export function muscleOfFrom(templates: readonly ExerciseTemplate[], catalog: readonly Exercise[] = []): MuscleOf {
  const byCatalog = new Map(catalog.map((e) => [e.id, e.primaryMuscle]));
  const byTemplate = new Map(templates.map((t) => [t.id, t.primaryMuscle]));
  return (id) => byCatalog.get(id) ?? byTemplate.get(id);
}

/** Hard sets are the work sets: normal, failure and drop sets. Warm-ups do not tire the muscle in this sense. */
export const hardSetsOf = (sets: readonly { type: string }[]): number => sets.filter((s) => s.type === 'normal' || s.type === 'failure' || s.type === 'dropset').length;

/**
 * Per exercise, in workout order: the fatigue its muscle group has from all earlier exercises. An earlier exercise of the same
 * main group counts all its hard sets; one that works the group along (its list of fatigue synergists) counts a share of them.
 * An exercise without a known muscle group (none, or one that only counts as "other") has 0 and tires nothing. A superset
 * partner counts when it stands earlier in the list, like any earlier exercise.
 */
export function preFatigue(exercises: readonly (Muscles & { hardSets: number; supersetId: number | null })[]): number[] {
  const done = new Map<string, number>();
  return exercises.map((e) => {
    const group = muscleGroupOf(e);
    const before = group === 'other' ? 0 : done.get(group) ?? 0;
    for (const c of contributions({ primaryMuscle: e.primaryMuscle ?? '', secondaryMuscles: e.secondaryMuscles ? [...e.secondaryMuscles] : undefined }, undefined, FATIGUE_SYNERGISTS)) {
      if (c.group === 'other') continue;
      done.set(c.group, (done.get(c.group) ?? 0) + e.hardSets * (c.direct ? 1 : SECONDARY_WEIGHT));
    }
    return before;
  });
}

/** How much of the last load stays when an exercise stands `deltaSets` hard sets later than before. One place for planning and the running workout. */
export const positionShare = (deltaSets: number): number => Math.max(SHARE_MIN, 1 - SHARE_PER_SET * deltaSets);
