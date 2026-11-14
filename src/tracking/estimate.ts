import { nextUp, snapDown, type Ladder } from '../shared/loads';
import { ruleNumber } from '../shared/training-policy';
import type { EstimateAsk, TrackedExercise, TrackedSet, TrackedWorkout } from './session';

export type { EstimateAsk };

/**
 * Bo's estimated start weight (see TrackedSet.estimatedKg): the hint before the first question, then "Wie war das Gewicht?"
 * at most twice per exercise. Pure.
 */

const isWork = (s: TrackedSet): boolean => s.type !== 'warmup';
const doneWork = (e: TrackedExercise): number => e.sets.filter((s) => isWork(s) && s.doneMs !== null).length;
const warmups = (e: TrackedExercise): TrackedSet[] => e.sets.filter((s) => !isWork(s));
const EPS = 1e-6;

export const NOT_ASKED: EstimateAsk = { n: 0, atDone: 0, ended: false };
/** Questions per exercise at most: the first, and one more after a step. */
export const MAX_ESTIMATE_ASKS = 2;

/** The moment of the first question: after the last warm-up set when there are warm-ups, else (or when they were skipped) after the first work set. */
const firstMoment = (e: TrackedExercise): boolean => {
  const warm = warmups(e);
  return warm.length > 0 && warm.every((s) => s.doneMs !== null) ? doneWork(e) === 0 : doneWork(e) === 1;
};
const askOf = (e: TrackedExercise): EstimateAsk => e.estimateAsk ?? NOT_ASKED;
/** The work set confirmed last (by its time, then its place), or none. */
const lastDoneWork = (e: TrackedExercise): TrackedSet | undefined =>
  e.sets.filter((s) => isWork(s) && s.doneMs !== null).reduce<TrackedSet | undefined>((m, s) => (!m || s.doneMs! >= m.doneMs! ? s : m), undefined);

/** True while the exercise carries an estimated weight and its first question has not come yet: the hint under the weight shows. */
export const showsEstimateHint = (e: TrackedExercise): boolean =>
  e.sets.some((s) => s.estimatedKg) && !askOf(e).ended && doneWork(e) === 0 && !(warmups(e).length > 0 && warmups(e).every((s) => s.doneMs !== null));

/** The open work sets that still hold the estimated weight (a step moves the estimate with them): the sets an answer moves. */
export const stillEstimated = (e: TrackedExercise): TrackedSet[] =>
  e.sets.filter((s) => isWork(s) && s.doneMs === null && s.estimatedKg && s.weightKg !== null && s.weightKg === s.prefillKg);

/**
 * Whether "Wie war das Gewicht?" shows now: first at its moment, once more right after the next confirmed work set after a step.
 * Only about a weight really lifted: a work set done at another weight than the estimate means the person chose their own.
 */
export function asksEstimate(e: TrackedExercise): boolean {
  const ask = askOf(e);
  if (ask.ended || ask.n >= MAX_ESTIMATE_ASKS || stillEstimated(e).length === 0) return false;
  if (!(ask.n === 0 ? firstMoment(e) : doneWork(e) === ask.atDone + 1)) return false;
  const lifted = lastDoneWork(e);
  return !lifted || (!!lifted.estimatedKg && lifted.weightKg === lifted.prefillKg);
}

/** The answer the exercise keeps after "Passt" / "Überspringen" (`end`) or a step. */
export const answered = (e: TrackedExercise, how: 'end' | 'step'): EstimateAsk =>
  how === 'end' ? { ...askOf(e), ended: true } : { n: askOf(e).n + 1, atDone: doneWork(e), ended: false };

/**
 * The weight after "Zu leicht" (up) or "Zu schwer" (down): the ladder weight nearest to `gym.estimate-step-pct` of the weight,
 * at least one ladder step. Null: no lighter weight.
 */
export function stepKg(kg: number, dir: 'up' | 'down', ladder: Ladder): number | null {
  const share = ruleNumber('gym.estimate-step-pct') / 100;
  if (dir === 'up') {
    const target = kg * (1 + share);
    let x = nextUp(kg, ladder);
    // Go on while the next step lands nearer to the target than this one.
    for (let n = nextUp(x, ladder); Math.abs(n - target) < Math.abs(x - target) - EPS; n = nextUp(n, ladder)) x = n;
    return x;
  }
  const target = kg * (1 - share);
  let x = snapDown(kg - 0.01, ladder);
  if (!(x > 0 && x < kg)) return null;
  for (let n = snapDown(x - 0.01, ladder); n > 0 && n < x && Math.abs(n - target) < Math.abs(x - target) - EPS; n = snapDown(n - 0.01, ladder)) x = n;
  return x;
}

/** The step for every set still at the estimate. `to` and `prior` both go to setEstimate (the step and its undo). */
export function estimateStep(e: TrackedExercise, dir: 'up' | 'down', ladder: Ladder): { to: { rid: string; kg: number }[]; prior: { rid: string; kg: number }[] } {
  const to: { rid: string; kg: number }[] = [], prior: { rid: string; kg: number }[] = [];
  for (const s of stillEstimated(e)) {
    const next = stepKg(s.weightKg!, dir, ladder);
    if (next === null) continue;
    to.push({ rid: s.rid, kg: next });
    prior.push({ rid: s.rid, kg: s.weightKg! });
  }
  return { to, prior };
}

/** Sets weight and estimate of the listed open sets: the step stays the estimate, so a second question can move it again. */
export function setEstimate(w: TrackedWorkout, exRid: string, sets: readonly { rid: string; kg: number }[]): TrackedWorkout {
  const to = new Map(sets.map((s) => [s.rid, s.kg]));
  if (!w.exercises.some((e) => e.rid === exRid)) return w;
  return { ...w, exercises: w.exercises.map((e) => (e.rid !== exRid ? e : { ...e, sets: e.sets.map((s) => (s.doneMs === null && to.has(s.rid) ? { ...s, weightKg: to.get(s.rid)!, prefillKg: to.get(s.rid)! } : s)) })) };
}
