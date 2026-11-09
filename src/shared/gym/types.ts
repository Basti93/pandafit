export type ExerciseTemplate = { id: string; title: string; type: string; primaryMuscle: string; equipment: string };
export type GymSet = { type: 'warmup' | 'normal' | 'failure' | 'dropset'; weightKg: number | null; reps: number | null; repRange?: { start: number; end: number } };
export type GymExercise = { templateId: string; title: string; restS: number | null; supersetId: number | null; notes: string; sets: GymSet[] };
/** `studio`: the studio bucket the weights were planned for (set by the guardrails, not by the AI). */
export type GymWorkout = { name: string; exercises: GymExercise[]; studio?: string };
