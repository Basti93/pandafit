import { fireEvent, screen } from '@testing-library/react';
import type { LoggedWorkout, TrackedRecord } from '../../src/shared/records';

export const rec = (w: LoggedWorkout, deleted = false): TrackedRecord => ({ kind: 'workout', id: w.id, updatedMs: 1, deleted, body: w });
export const set = (weightKg: number | null, reps: number | null, doneMs: number | null) => ({ type: 'normal' as const, weightKg, reps, durationS: null, doneMs });
export const ids = { newId: () => 'new-id', now: () => 100_000 };
export const bodyOf = (m: Map<string, TrackedRecord>, key: string) => m.get(key)!.body as LoggedWorkout;

/** An open workout "open1": Bankdrücken with 2 sets (62,5 kg × 8, then empty), Rudern with 3 sets. */
export const open2 = (): LoggedWorkout => ({
  id: 'open1', title: 'Zuhause', startMs: 1000, endMs: null, source: 'pandafit',
  exercises: [
    { exerciseId: 'pf-bench-press', title: 'Bankdrücken', supersetId: null, notes: '', sets: [set(62.5, 8, null), set(null, null, null)] },
    { exerciseId: 'pf-seated-row-cable', title: 'Rudern', supersetId: null, notes: '', sets: [set(40, 10, null), set(40, 10, null), set(40, 10, null)] },
  ],
});

/** "Satz geschafft" on the focus card. */
export const doneNow = () => fireEvent.click(screen.getByRole('button', { name: 'Satz geschafft' }));
/** Opens the sets sheet of the focus exercise by its circle n (1-based row) and returns the dialog. */
export async function setsSheet(n = 1): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^(Satz ${n}|Aufwärmsatz):`) }));
  return screen.findByRole('dialog');
}
