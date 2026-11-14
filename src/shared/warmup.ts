import { snapDown, type Ladder } from './loads';
import { ruleRamp, ruleValues } from './training-policy';
import { EXERCISES, catalogEntryOf, type Exercise } from './exercises';
import { muscleGroupOf } from './muscle-targets';

/** Warm-up per movement block: the ramp comes from the register (`prep.ramp`), the bar's weight comes from the caller (0: no bar). Pure, shared by app and coach. */
export type RampStep = { weightKg: number; reps: number };

/**
 * The warm-up sets before a working weight: for a barbell first the bar, then each ramp share snapped down on the ladder.
 * Assisted exercises get none. Duplicates, steps at or above the working weight and barbell steps below the bar are dropped. No working weight: none.
 */
export function warmupRamp(a: { workingKg: number | null | undefined; ladder: Ladder; type?: string; barKg: number }): RampStep[] {
  const w = a.workingKg;
  if (typeof w !== 'number' || !(w > 0) || a.type?.includes('assisted')) return []; // an assisted weight is help: lighter is harder
  const bar = a.barKg;
  const candidates: RampStep[] = [
    ...(bar > 0 ? [{ weightKg: bar, reps: ruleValues('prep.ramp').barReps }] : []),
    ...ruleRamp('prep.ramp').map((s) => ({ weightKg: snapDown(w * s.pct / 100, a.ladder), reps: s.reps })),
  ];
  const seen = new Set<number>();
  return candidates.filter((s) => {
    if (s.weightKg >= w || s.weightKg < bar || seen.has(s.weightKg)) return false;
    seen.add(s.weightKg);
    return true;
  });
}

type WSet = { type?: string; weightKg?: number | null; doneMs?: number | null };
type WEx = { rid: string; exerciseId?: string; title?: string; sets: readonly WSet[] };

/** The first work set's planned weight: the working weight a ramp is built from. */
export const workingWeightOf = (e: { sets: readonly WSet[] }): number | null => {
  const w = e.sets.find((s) => s.type !== 'warmup')?.weightKg;
  return typeof w === 'number' && w > 0 ? w : null;
};

/**
 * True when the exercise has no done set and no warm-up set, and no earlier exercise of the same muscle group in this workout has a
 * done set (that muscle is warm already).
 */
export function needsWarmup(w: { exercises: readonly WEx[] }, rid: string, catalog: readonly Exercise[] = EXERCISES): boolean {
  const i = w.exercises.findIndex((e) => e.rid === rid);
  if (i < 0) return false;
  const e = w.exercises[i]!;
  if (e.sets.some((s) => s.type === 'warmup' || (s.doneMs ?? null) !== null)) return false;
  const own = catalogEntryOf(e, catalog);
  if (!own) return true;
  const group = muscleGroupOf(own);
  return !w.exercises.slice(0, i).some((p) => {
    const o = catalogEntryOf(p, catalog);
    return !!o && muscleGroupOf(o) === group && p.sets.some((s) => (s.doneMs ?? null) !== null);
  });
}
