import type { ReactNode } from 'react';
import type { TrackedRecord } from '../../shared/records';
import { hasSport, planFor } from '../../shared/week-plan';
import { planDayLabel } from '../../tracking/ui/plan-text';

/** Heute on Morgen: the planned training, no start button; without a plan one calm line. `gymNote` is the strength plan's name and exercises (muted), shown on a strength day. */
export function TomorrowTraining({ weekplans, date, gymNote }: { weekplans: TrackedRecord[] | null; date: string; gymNote?: ReactNode }) {
  const day = planFor(weekplans ?? [], date);
  // Still loading: nothing yet. Loaded without a plan for the day: one calm line, so Morgen is never an empty page.
  if (weekplans === null) return null;
  if (!day) return <section className="card" aria-label="Training morgen"><h2>Training morgen</h2><p className="muted">Für morgen ist noch kein Training geplant.</p></section>;
  return (
    <section className="card" aria-label="Training morgen">
      <h2>Training morgen</h2>
      <p>{planDayLabel(day)}</p>
      {hasSport(day, 'gym') && gymNote}
    </section>
  );
}
