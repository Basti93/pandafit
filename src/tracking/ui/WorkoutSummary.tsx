import type { ActivityItem } from '../../shared/activities';
import type { LoggedWorkout } from '../../shared/records';
import type { NextStep } from '../../shared/stats';
import type { PlanDay } from '../../shared/week-plan';
import { Finisher } from './FinisherCard';
import { finisherOf } from './finisher';
import { nextLine, nextOf } from './next-line';

const KEY = 'pandafit-summary-pending';
/** The finished workout whose summary is still showing. Kept on this device, so a reload shows it until "Fertig". */
export const pendingSummary = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setPendingSummary = (id: string | null): void => {
  try { if (id === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, id); } catch { /* private mode: the summary lives until the screen is left */ }
};

/** After a saved finish: what was done, and the coach's next step per exercise (or that it is still coming). One button. */
export function WorkoutSummary({ workout: w, next, onDone, nowMs, today, activities, complaintsOpen }: { workout: LoggedWorkout; next: readonly NextStep[]; onDone: () => void; nowMs: number; today: PlanDay | null; activities: ActivityItem[]; complaintsOpen: boolean }) {
  const mine = next.filter((n) => n.forWorkoutId === w.id || n.atMs === w.startMs);
  const minutes = Math.max(1, Math.round(((w.endMs ?? w.startMs) - w.startMs) / 60000));
  const rows = w.exercises.map((e) => ({ e, n: nextOf(mine, e) })).filter((r) => r.n);
  const finisher = finisherOf({ workout: w, nowMs, today, activities, complaintsOpen });
  return (
    <section className="card tk-summary" aria-label="Zusammenfassung">
      <h2>Gespeichert</h2>
      <p className="muted">{w.exercises.length} {w.exercises.length === 1 ? 'Übung' : 'Übungen'} · {minutes} Min</p>
      {rows.map(({ e, n }, i) => <p key={i} className="muted tk-sub">{e.title} · {nextLine(n!)}</p>)}
      {finisher && <Finisher f={finisher} />}
      <button type="button" onClick={onDone}>Fertig</button>
    </section>
  );
}
