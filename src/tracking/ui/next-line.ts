import { formatDecimal } from '../session';
import type { NextStep } from '../../shared/stats';

/** "Nächstes Mal: 62,5 kg × 8 – weil du alle Wiederholungen geschafft hast." */
export const nextLine = (n: NextStep): string => `Nächstes Mal: ${n.weightKg !== null ? `${formatDecimal(n.weightKg)} kg × ${n.reps}` : `${n.reps} Wiederholungen`}, ${n.reason}.`;

/** The coach's next step for an exercise of a workout: by exercise id, else by title. */
export const nextOf = (mine: readonly NextStep[], e: { exerciseId: string; title: string }): NextStep | undefined =>
  mine.find((n) => n.exerciseId === e.exerciseId) ?? mine.find((n) => n.title === e.title);
