import { dayTitle, shiftDay, type DayOffset } from './day-nav';

/** The head of the day page: the day before, the day name with its date, the day after. */
export function DayHead({ offset, nowMs, onStep }: { offset: DayOffset; nowMs: number; onStep: (step: -1 | 1) => void }) {
  const t = dayTitle(offset, nowMs);
  return (
    <header className="tk-dayhead">
      <button type="button" className="tk-dayarrow" aria-label="Tag zurück" disabled={shiftDay(offset, -1) === offset} onClick={() => onStep(-1)}>‹</button>
      <div className="tk-daytitle">
        <h1 className="tk-title">{t.name}</h1>
        <p className="muted">{t.date}</p>
      </div>
      <button type="button" className="tk-dayarrow" aria-label="Tag vor" disabled={shiftDay(offset, 1) === offset} onClick={() => onStep(1)}>›</button>
    </header>
  );
}
