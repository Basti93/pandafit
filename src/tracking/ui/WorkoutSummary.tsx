import type { ReactNode } from 'react';
import type { ActivityItem } from '../../shared/activities';
import type { LoggedWorkout } from '../../shared/records';
import type { NextStep } from '../../shared/stats';
import type { PlanDay } from '../../shared/week-plan';
import { BoBubble, MainCard } from './kit';
import { finisherLine, finisherOf, STRETCH_LINE } from './finisher';
import { nextLine, nextOf } from './next-line';

const KEY = 'pandafit-summary-pending';
/** The finished workout whose summary is still showing. Kept on this device, so a reload shows it until "Schließen". */
export const pendingSummary = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setPendingSummary = (id: string | null): void => {
  try { if (id === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, id); } catch { /* private mode: the summary lives until the screen is left */ }
};

/** After a saved finish: the main card "Gespeichert" with the coach's next step per exercise, and Bo with what to do now. One button, "Schließen". */
export function WorkoutSummary({ workout: w, next, onDone, nowMs, today, activities, complaintsOpen, extra }: { /** The mobility offer, shown in the card like on the finish card. */ extra?: ReactNode; workout: LoggedWorkout; next: readonly NextStep[]; onDone: () => void; nowMs: number; today: PlanDay | null; activities: ActivityItem[]; complaintsOpen: boolean }) {
  const mine = next.filter((n) => n.forWorkoutId === w.id || n.atMs === w.startMs);
  const minutes = Math.max(1, Math.round(((w.endMs ?? w.startMs) - w.startMs) / 60000));
  const rows = w.exercises.map((e) => ({ e, n: nextOf(mine, e) })).filter((r) => r.n);
  const finisher = finisherOf({ workout: w, nowMs, today, activities, complaintsOpen });
  const count = w.exercises.length === 1 ? '1 Übung' : `${w.exercises.length} Übungen`;
  return (
    <>
      <MainCard label="Zusammenfassung" kicker="Gespeichert" title={w.title} text={`${count} in ${minutes === 1 ? '1 Minute' : `${minutes} Minuten`}.`}
        primary={{ label: 'Schließen', onClick: onDone }}
        more={(rows.length > 0 || extra) && <>{rows.map(({ e, n }, i) => <p key={i} className="muted tk-sub">{e.title} · {nextLine(n!)}</p>)}{extra}</>} />
      {finisher && <BoBubble portrait="mini">{[finisherLine(finisher), STRETCH_LINE].filter((x, i, all) => all.indexOf(x) === i).join(' ')}</BoBubble>}
    </>
  );
}
