import type { LoggedWorkout } from '../records';
import type { StrengthWorkout } from './types';

/** Hevy template id to own exercise id (see linkHevyTemplates). Pass an empty map when nothing is linked. */
type Links = ReadonlyMap<string, string>;

/** Same shape the Hevy conversion makes, so suggestNext works on both. An unfinished workout has no duration (0). */
export function toStrengthWorkout(w: LoggedWorkout, links: Links): StrengthWorkout {
  // Pandafit sets only count once confirmed; Hevy has no confirmation, so all its sets are real.
  const real = (sets: LoggedWorkout['exercises'][number]['sets']) => w.source === 'pandafit' ? sets.filter((s) => s.doneMs !== null) : sets;
  return {
    id: w.id, title: w.title, startMs: w.startMs,
    durationS: w.endMs === null ? 0 : Math.max(0, Math.round((w.endMs - w.startMs) / 1000)),
    ...(w.studio ? { studio: w.studio } : {}),
    exercises: w.exercises.map((e) => ({ e, sets: real(e.sets) })).filter((x) => x.sets.length > 0).map(({ e, sets }) => {
      const work = sets.filter((s) => s.type !== 'warmup');
      return {
        title: e.title, templateId: links.get(e.exerciseId) ?? e.exerciseId,
        workSets: sets.map((s) => ({ type: s.type, weightKg: s.weightKg ?? null, reps: s.reps ?? null })),
        ...(e.effort && e.effort !== 'skip' ? { effort: e.effort } : {}),
        sets: work.length,
        reps: work.reduce((a, s) => a + (s.reps ?? 0), 0),
        volumeKg: Math.round(work.reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0)),
      };
    }),
  };
}

/** Finished own workouts only; one still open is not history yet. */
export const historyFromLogged = (logged: LoggedWorkout[], links: Links): StrengthWorkout[] =>
  logged.filter((w) => w.endMs !== null).map((w) => toStrengthWorkout(w, links));

