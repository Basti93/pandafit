import { bodyOf } from '../../../shared/record-bodies';
import { usedMarks } from '../../../shared/changes';
import type { LoggedWorkout } from '../../../shared/records';
import type { TrackingPort } from '../../ports';

/** "39 Min", from an hour on "1 Std 5 Min". */
export const sinceLabel = (ms: number): string => { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${m} Min`; };

/** A finished workout uses up the taken changes it lists. A workout thrown away never gets here, so its changes stay taken for the next one. */
export async function markUsed(port: TrackingPort, workouts: { id: string; changes?: { id: string }[] }[], nowMs: number): Promise<void> {
  try { for (const r of usedMarks(await port.list('change'), workouts, nowMs)) await port.put(r); } catch { /* the next start marks them */ }
}

/** Marks the taken changes the finished workouts list as used (see markUsed), reading the workouts afresh. */
export async function markUsedNow(port: TrackingPort, now: () => number): Promise<void> {
  let all: LoggedWorkout[] = [];
  try { all = (await port.list('workout')).filter((r) => !r.deleted).map((r) => bodyOf('workout', r)); } catch { return; /* the next start marks them */ }
  await markUsed(port, all.filter((x) => x.endMs !== null), now());
}
