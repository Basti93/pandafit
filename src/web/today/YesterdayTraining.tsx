import { bodyOf } from '../../shared/record-bodies';
import type { ActivityItem } from '../../shared/activities';
import { localDayKey } from '../../shared/dates';
import type { TrackedRecord } from '../../shared/records';
import { activityText, mergedActivities } from '../../tracking/ui/done-days';
import { activitiesOn } from './day-data';

/** Heute on Gestern: what was trained, as plain facts. Rest day only when the data is known and empty. */
export function YesterdayTraining({ activities, workouts, mobility, date }: { activities: TrackedRecord[] | null; workouts: TrackedRecord[] | null; mobility: TrackedRecord[] | null; date: string }) {
  const items = activitiesOn(mergedActivities(activities, workouts), date);
  const doneMobility = (mobility ?? []).filter((r) => !r.deleted && typeof (r.body as { doneMs?: unknown } | null)?.doneMs === 'number' && localDayKey((r.body as { doneMs: number }).doneMs) === date);
  const titles = (a: ActivityItem): string[] => {
    if (a.kind !== 'kraft' || !a.ref) return [];
    const w = (workouts ?? []).find((r) => r.id === a.ref && !r.deleted);
    return w ? bodyOf('workout', w).exercises.map((e) => e.title) : [];
  };
  return (
    <section className="card" aria-label="Training gestern">
      <h2>Training gestern</h2>
      {items === null && doneMobility.length === 0 && <p className="muted">Für gestern sind noch keine Daten da.</p>}
      {items !== null && items.length === 0 && doneMobility.length === 0 && <p className="muted">Gestern war ein Ruhetag.</p>}
      {(items ?? []).map((a) => {
        const ex = titles(a);
        // activityText already names the minutes except for strength and a run with a distance.
        const text = a.kind === 'kraft' || (a.kind === 'lauf' && a.distanceM !== null && a.distanceM > 0) ? `${activityText(a)} · ${Math.max(1, Math.round(a.minutes))} Min` : activityText(a);
        return (
          <div key={a.key}>
            <p>{text}</p>
            {ex.length > 0 && <p className="muted tk-clamp">{ex.join(', ')}</p>}
          </div>
        );
      })}
      {doneMobility.length > 0 && <p>Beweglichkeit</p>}
    </section>
  );
}
