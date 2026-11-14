import type { TrackedRecord } from '../../shared/records';
import { liveTaken, takenChanges, type NextChange } from '../../shared/changes';

/** The changes the rider took for the next workout, oldest first. Read only: the coach never writes or clears them. */
export function takenChangesOf(store: { all(profileId: string, kind?: 'change' | 'workout'): TrackedRecord[] }, profileId: string): NextChange[] {
  try {
    const workouts = store.all(profileId, 'workout').filter((r) => !r.deleted && typeof r.body === 'object' && r.body !== null).map((r) => r.body as { startMs: number; endMs: number | null; changes?: { id: string }[] }).filter((w) => typeof w.startMs === 'number');
    return liveTaken(takenChanges(store.all(profileId, 'change')), workouts);
  } catch { return []; }
}
