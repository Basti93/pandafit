import type { GymOutlook as Outlook } from '../../shared/gym-outlook';
import { shortDateOfKey } from '../../shared/dates';

const dayLabel = (date: string | null): string | null => (date ? shortDateOfKey(date) : null);

/** The workouts after the next one, as a sketch, and where the training is heading. Nothing without an outlook. */
export function GymOutlook({ outlook }: { outlook: Outlook | null | undefined }) {
  if (!outlook || (outlook.sessions.length === 0 && !outlook.direction)) return null;
  return (
    <section className="tk-outlook">
      <h3>Danach</h3>
      {outlook.direction && <p>{outlook.direction}</p>}
      {outlook.sessions.length > 0 && (
        <ul className="tk-outlook-list">
          {outlook.sessions.map((s, i) => (
            <li key={i}>
              <details>
                <summary>
                  {dayLabel(s.date) && <span className="muted">{dayLabel(s.date)} · </span>}
                  <strong>{s.name}</strong>
                  {s.focus && <span className="muted"> · {s.focus}</span>}
                </summary>
                <ul>{s.exercises.map((e, j) => <li key={j}>{e.title}, {e.sets} {e.sets === 1 ? 'Satz' : 'Sätze'}</li>)}</ul>
              </details>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Das ist eine Skizze. Bo plant jedes Training neu, mit dem, was wirklich passiert ist.</p>
    </section>
  );
}
