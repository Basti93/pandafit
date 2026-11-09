import type { TrackedRecord } from './records';
import { readOutlook, type GymOutlook } from './gym-outlook';

/** The `plan/current` record: the next strength session and what goes with it. */
export type PlanBody = {
  workout: import('./gym/types').GymWorkout | null; reason: string | null; source: string | null; note: string | null;
  questions: string[]; atMs: number; mobility: MobilitySession | null; outlook: GymOutlook | null;
};
export type MobilitySession = { id: string; forSession: 'bike' | 'strength' | 'run'; minutes: number; exercises: { id: string; title: string; howTo: string; area: string }[]; reason: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function readPlan(r: TrackedRecord | undefined): PlanBody | null {
  if (!r || r.deleted || !isObj(r.body)) return null;
  const b = r.body;
  const w = isObj(b.workout) && Array.isArray(b.workout.exercises) && typeof b.workout.name === 'string' ? (b.workout as unknown as PlanBody['workout']) : null;
  const m = isObj(b.mobility) && typeof b.mobility.id === 'string' && Array.isArray(b.mobility.exercises) ? (b.mobility as unknown as MobilitySession) : null;
  return {
    workout: w, reason: typeof b.reason === 'string' ? b.reason : null, source: typeof b.source === 'string' ? b.source : null,
    note: typeof b.note === 'string' ? b.note : null, questions: Array.isArray(b.questions) ? b.questions.filter((q): q is string => typeof q === 'string') : [],
    atMs: typeof b.atMs === 'number' ? b.atMs : r.updatedMs, mobility: m, outlook: readOutlook(b.outlook),
  };
}

