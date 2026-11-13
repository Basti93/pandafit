import type { Effort } from '../records';

export type ExerciseTemplate = { id: string; title: string; type: string; primaryMuscle: string; equipment: string };
export type GymSet = { type: 'warmup' | 'normal' | 'failure' | 'dropset'; weightKg: number | null; reps: number | null; repRange?: { start: number; end: number } };
export type GymExercise = { templateId: string; title: string; restS: number | null; supersetId: number | null; notes: string; sets: GymSet[] };
/** `studio`: the studio bucket the weights were planned for (set by the guardrails, not by the AI). */
export type GymWorkout = { name: string; exercises: GymExercise[]; studio?: string };

export type SetType = 'warmup' | 'normal' | 'failure' | 'dropset';
export type StrengthWorkout = {
  id: string; title: string; startMs: number; durationS: number;
  /** Own workouts only; a Hevy workout has none and counts for the main studio (shared/studio). */
  studio?: string;
  exercises: {
    title: string; templateId: string; sets: number; reps: number; volumeKg: number;
    workSets: { type: SetType; weightKg: number | null; reps: number | null }[];
    /** The rider's answer to "how many more?" (own workouts only). */
    effort?: Effort;
  }[];
};
