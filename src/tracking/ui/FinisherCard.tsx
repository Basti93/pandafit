import './tracking.css';
import type { ReactNode } from 'react';
import type { Finisher as F } from './finisher';

/** "Zum Abschluss": offered after strength training, never owed. The stretch part is the coach's mobility row when there is one. */
export function Finisher({ f, mobility }: { f: F; mobility?: ReactNode }) {
  return (
    <section className="card tk-finisher" aria-label="Zum Abschluss">
      <h2>Zum Abschluss</h2>
      {f.cardio && <p>Mach 20 Min lockeres Cardio auf dem Rad, dem Crosstrainer oder dem Laufband. Du kannst dabei noch reden.</p>}
      {f.reason && <p className="muted">{f.reason}</p>}
      {mobility ?? <p>Dehn ein paar Minuten, was sich fest anfühlt.</p>}
    </section>
  );
}
