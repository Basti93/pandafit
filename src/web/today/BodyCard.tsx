import type { HealthBody } from '../../shared/health';
import { doctorFinding, healthRows } from '../../tracking/ui/health-view';

/** "Dein Körper": a doctor hint first if there is one, then one short line per area. Words only, no sentences with numbers. */
export function BodyCard({ health, onCoach }: { health: HealthBody | null; onCoach: () => void }) {
  if (!health) return null;
  const doctor = doctorFinding(health);
  return (
    <section className="card" aria-label="Dein Körper">
      <h2>Dein Körper</h2>
      {doctor && <p>{doctor.text}</p>}
      <ul className="tk-bodyrows">
        {healthRows(health).map((r) => <li key={r.key}>{r.title} · {r.word}</li>)}
      </ul>
      <button type="button" className="secondary" onClick={onCoach}>Bo fragen</button>
    </section>
  );
}
