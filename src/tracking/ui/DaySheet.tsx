import { bodyOf } from '../../shared/record-bodies';
import type { ActivityItem } from '../../shared/activities';
import { dayMonthLongOfKey, localDayKey, weekdayOfKey } from '../../shared/dates';
import { addDays, hasSport, planFor } from '../../shared/week-plan';
import { readPlan } from '../../shared/plan-body';
import type { TrackingPort } from '../ports';
import { activitiesOn, activityText, doneDays, mergedActivities } from './done-days';
import { usePortRecords } from './hooks';
import { Sheet } from './kit';
import { planDayLabel, runText } from './plan-text';
import { runView } from './run-view';

/** One day of the week path in a small sheet: what was done (today and before) or what is planned (today and later). No start button. */
export function DaySheet({ port, date, now, onClose }: { port: TrackingPort; date: string; now: () => number; onClose: () => void }) {
  const activities = usePortRecords(port, 'activities').records;
  const workouts = usePortRecords(port, 'workout').records;
  const mobility = usePortRecords(port, 'mobility').records;
  const weekplans = usePortRecords(port, 'weekplan').records;
  const runRecords = usePortRecords(port, 'run').records;
  const plans = usePortRecords(port, 'plan').records;
  const nowMs = now();
  const today = localDayKey(nowMs);
  const past = date <= today;
  const future = date >= today;

  const merged = mergedActivities(activities, workouts);
  const items = activitiesOn(merged, date);
  const doneMobility = (mobility ?? []).some((r) => !r.deleted && typeof (r.body as { doneMs?: unknown } | null)?.doneMs === 'number' && localDayKey((r.body as { doneMs: number }).doneMs) === date);
  const exercises = (a: ActivityItem): string[] => {
    if (a.kind !== 'kraft' || !a.ref) return [];
    const w = (workouts ?? []).find((r) => r.id === a.ref && !r.deleted);
    return w ? bodyOf('workout', w).exercises.map((e) => e.title) : [];
  };
  const doneAny = (items?.length ?? 0) > 0 || doneMobility;

  // Today shows only the open parts of the plan: a finished strength day does not show the strength plan again.
  const planOn = (d: string) => {
    const raw = planFor(weekplans ?? [], d);
    return raw && d === today ? doneDays([d], today, [raw], merged)[0]!.plan : raw;
  };
  const plan = future ? planOn(date) : null;
  const runs = future ? (runView(runRecords ?? [], nowMs).week?.runs ?? []).filter((r) => r.date === date) : [];
  // The strength plan of the plan record belongs to the first strength day from today on.
  const firstGym = future ? Array.from({ length: 14 }, (_, i) => addDays(today, i)).find((d) => { const p = planOn(d); return p !== null && hasSport(p, 'gym'); }) : undefined;
  const gym = firstGym === date && plan ? readPlan((plans ?? []).find((r) => r.id === 'current'))?.workout ?? null : null;

  return (
    <Sheet title={`${weekdayOfKey(date)}, ${dayMonthLongOfKey(date)}`} size="small" onClose={onClose}>
      <div className="tk-daysheet">
        {past && (items ?? []).map((a) => {
          const ex = exercises(a);
          // activityText already names the minutes except for strength and a run with a distance.
          const text = a.kind === 'kraft' || (a.kind === 'lauf' && a.distanceM !== null && a.distanceM > 0) ? `${activityText(a)} · ${Math.max(1, Math.round(a.minutes))} Min` : activityText(a);
          return (
            <div key={a.key}>
              <p>{text}</p>
              {ex.length > 0 && <p className="muted tk-clamp">{ex.join(', ')}</p>}
            </div>
          );
        })}
        {past && doneMobility && <p>Beweglichkeit</p>}
        {past && !doneAny && date < today && (items === null ? <p className="muted">Für diesen Tag sind noch keine Daten da.</p> : <p className="muted">Das war ein Ruhetag.</p>)}
        {future && plan && (
          <>
            <p>{planDayLabel(plan)}</p>
            {plan.note && <p className="muted">{plan.note}</p>}
            {plan.fixed && <p className="muted">Dieser Tag ist fest eingeplant.</p>}
          </>
        )}
        {runs.map((r) => <p key={r.date + r.kind}>{runText(r)}</p>)}
        {gym && (
          <>
            <p className="muted"><span>{gym.name}</span></p>
            {gym.exercises.length > 0 && <p className="muted tk-clamp">{gym.exercises.map((e) => e.title).join(', ')}</p>}
          </>
        )}
        {future && !plan && runs.length === 0 && !doneAny && <p className="muted">Für diesen Tag ist noch nichts geplant.</p>}
      </div>
    </Sheet>
  );
}
