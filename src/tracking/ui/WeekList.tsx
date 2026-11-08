import { WEEKDAY_LABEL, type PlanDay } from '../../shared/week-plan';
import type { PlannedRun } from '../../shared/run';
import { planDayText, runText } from './plan-text';
import type { DayRow } from './done-days';

export { runText };

export const dayName = (date: string) => WEEKDAY_LABEL[(new Date(`${date}T12:00:00`).getDay() + 6) % 7]!;
const dayText = (d: PlanDay) => planDayText(d, { legs: true });

/** One row per day: past days what was done or Ruhetag, today what was done and the rest of the plan, later days the plan. The run coach's runs sit on planned days. */
export function Week({ rows, label, today, runs = [] }: { rows: DayRow[]; label: string; today?: string; runs?: PlannedRun[] }) {
  return (
    <ul className="tk-week" aria-label={label}>
      {rows.map(({ date, done, plan: d, rest }) => (
        <li key={date} className={date === today ? 'tk-today' : undefined} aria-current={date === today ? 'date' : undefined}>
          <b>{dayName(date)}</b>
          <span>
            {done.length > 0 && <span>✓ {done.join(' · ')}</span>}
            {rest && <span className="muted">Ruhetag</span>}
            {d && (
              <>
                {done.length > 0 && <span className="muted"> · </span>}
                {d.sport === 'run' && runs.some((r) => r.date === date) ? runs.filter((r) => r.date === date).map(runText).join(' · ') : dayText(d)}
                {d.fixed && <span className="muted"> · fest</span>}{d.note && <span className="muted"> · {d.note}</span>}
                {d.sport !== 'run' && runs.filter((r) => r.date === date).map((r) => <span key={r.kind}> · {runText(r)}</span>)}
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
