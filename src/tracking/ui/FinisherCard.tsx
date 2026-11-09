import './tracking.css';
import type { ReactNode } from 'react';
import type { Finisher as F } from './finisher';
import { MainCard } from './kit';

/** "Zum Abschluss": offered after strength training, never owed. The stretch part is the coach's mobility row when there is one. */
export function Finisher({ f, mobility }: { f: F; mobility?: ReactNode }) {
  const text = [f.cardio && 'Mach 20 Min lockeres Cardio auf dem Rad, dem Crosstrainer oder dem Laufband. Du kannst dabei noch reden.', f.reason].filter(Boolean).join(' ');
  return (
    <MainCard kicker="Zum Abschluss" title={f.cardio ? 'Locker ausklingen' : 'Dehnen'} text={text || undefined}
      more={mobility ?? <p className="muted">Dehn ein paar Minuten, was sich fest anfühlt.</p>} />
  );
}
