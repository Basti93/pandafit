import { WEEKDAY_LABEL, type PlanDay } from '../../shared/week-plan';
import type { PlannedRun } from '../../shared/run';
import { planDayText, runText } from './plan-text';

export { runText };

export const dayName = (date: string) => WEEKDAY_LABEL[(new Date(`${date}T12:00:00`).getDay() + 6) % 7]!;
const dayText = (d: PlanDay) => planDayText(d, { legs: true });

/** Seven day rows, Mo–So: sport and hardness on one line, today marked. The run coach's runs sit on their days. */
export function Week({ days, label, today, runs = [], rode }: { days: PlanDay[]; label: string; today?: string; runs?: PlannedRun[]; /** Dates with a ride the coach published: the day says "gefahren". */ rode?: ReadonlySet<string> }) {
  return (
    <ul className="tk-week" aria-label={label}>
      {days.map((d) => (
        <li key={d.date} className={d.date === today ? 'tk-today' : undefined} aria-current={d.date === today ? 'date' : undefined}>
          <b>{dayName(d.date)}</b>
          <span>
            {d.sport === 'run' && runs.some((r) => r.date === d.date) ? runs.filter((r) => r.date === d.date).map(runText).join(' · ') : dayText(d)}
            {rode?.has(d.date) && <span className="muted"> · gefahren</span>}{d.fixed && <span className="muted"> · fest</span>}{d.note && <span className="muted"> · {d.note}</span>}
            {d.sport !== 'run' && runs.filter((r) => r.date === d.date).map((r) => <span key={r.kind}> · {runText(r)}</span>)}
          </span>
        </li>
      ))}
    </ul>
  );
}
