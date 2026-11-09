import './tracking.css';
import type { ReactNode } from 'react';
import { finisherLine, STRETCH_LINE, type Finisher as F } from './finisher';
import { MainCard } from './kit';

/** "Zum Abschluss": offered after strength training, never owed. The stretch part is the coach's mobility row when there is one. */
export function Finisher({ f, mobility }: { f: F; mobility?: ReactNode }) {
  const line = finisherLine(f);
  return (
    <MainCard kicker="Zum Abschluss" title={f.cardio ? 'Locker ausklingen' : 'Dehnen'} text={line}
      more={mobility ?? (line === STRETCH_LINE ? null : <p className="muted">{STRETCH_LINE}</p>)} />
  );
}
