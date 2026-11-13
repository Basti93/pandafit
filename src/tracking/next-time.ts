import type { Exercise } from '../shared/exercises';
import { suggestNext } from '../shared/gym/progression';
import { historyFromLogged, toStrengthWorkout } from '../shared/gym/strength-history';
import type { LoadStepOverrides } from '../shared/loads';
import type { LoggedWorkout } from '../shared/records';
import type { StudioState } from '../shared/studio';
import { resolveExercise } from './exercise-identity';
import { formatDecimal, type TrackedWorkout } from './session';

type Options = { history: LoggedWorkout[]; catalog: Exercise[]; studios: StudioState; overrides: LoadStepOverrides; nowMs: number };

/**
 * What the answer to "how many more?" means for the next time: the progression's suggestion when this workout counts as done,
 * as one sentence next to today's heaviest confirmed working weight. Null when the exercise has nothing confirmed to build on.
 * The suggestion is the one the prompt would show: it does not know the exercise's place in the next workout.
 */
export function nextTimeLine(w: TrackedWorkout, exRid: string, o: Options): string | null {
  const ex = w.exercises.find((x) => x.rid === exRid);
  if (!ex) return null;
  const now = o.nowMs;
  const workouts = [...historyFromLogged(o.history, new Map()), toStrengthWorkout({ ...w, endMs: now }, new Map())];
  const info = resolveExercise({ exerciseId: ex.exerciseId, title: ex.title }, o.catalog).exercise ?? undefined;
  const next = suggestNext(ex.exerciseId, workouts, now, info, { studio: w.studio, overrides: o.overrides, renames: o.studios.renames });
  if (next.why === 'none') return null;
  const work = ex.sets.filter((s) => s.doneMs !== null && (s.type === 'normal' || s.type === 'failure') && s.reps !== null && s.reps > 0);
  if (work.length === 0) return null;
  const todayKg = Math.max(...work.map((s) => s.weightKg ?? 0));
  const todayReps = Math.min(...work.filter((s) => (s.weightKg ?? 0) === todayKg).map((s) => s.reps as number));
  const kg = (n: number): string => `${formatDecimal(n)} kg`;
  if (next.weightKg === null || todayKg === 0) {
    return next.reps > todayReps ? `Nächstes Mal ${next.reps} statt ${todayReps} Wiederholungen.` : `Nächstes Mal bleibt es bei ${next.reps} Wiederholungen.`;
  }
  if (next.weightKg > todayKg) return `Nächstes Mal ${kg(next.weightKg)} statt ${kg(todayKg)}.`;
  if (next.weightKg < todayKg) return `Nächstes Mal etwas leichter, mit ${kg(next.weightKg)}.`;
  if (next.reps > todayReps) return `Nächstes Mal ${next.reps} statt ${todayReps} Wiederholungen mit ${kg(next.weightKg)}.`;
  return `Nächstes Mal bleibt es bei ${kg(next.weightKg)}.`;
}
