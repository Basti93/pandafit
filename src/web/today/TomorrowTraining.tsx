import type { ReactNode } from 'react';
import type { TrackedRecord } from '../../shared/records';
import { hasSport, planFor } from '../../shared/week-plan';
import { planDayLabel } from '../../tracking/ui/TodayCard';

/** Heute on Morgen: the planned training, no start button. `gymNote` is the strength plan's name and exercises (muted), shown on a strength day. */
export function TomorrowTraining({ weekplans, date, gymNote }: { weekplans: TrackedRecord[] | null; date: string; gymNote?: ReactNode }) {
  const day = planFor(weekplans ?? [], date);
  if (!day) return null;
  return (
    <section className="card" aria-label="Training morgen">
      <h2>Training morgen</h2>
      <p>{planDayLabel(day)}</p>
      {hasSport(day, 'gym') && gymNote}
    </section>
  );
}
