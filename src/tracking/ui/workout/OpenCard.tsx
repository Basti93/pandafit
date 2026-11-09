import { useState } from 'react';
import { bodyOf } from '../../../shared/record-bodies';
import type { TrackedRecord } from '../../../shared/records';
import { dateLabel } from '../labels';

export function OpenCard({ rec, primary, onResume, onEnd, onDiscard }: { rec: TrackedRecord; primary: boolean; onResume: () => void; onEnd: () => void; onDiscard: () => Promise<void> }) {
  const w = bodyOf('workout', rec);
  const [asking, setAsking] = useState(false);
  const [more, setMore] = useState(false);
  const sfx = primary ? '' : ` ${w.title} ${dateLabel(w.startMs)}`;
  return (
    <section className="card tk-open" aria-label={`${w.title} läuft noch`}>
      <h2>{w.title} läuft noch</h2>
      <p className="muted">Gestartet {dateLabel(w.startMs)} · alles gespeichert</p>
      <button type="button" onClick={onResume}>{`Weitermachen${sfx}`}</button>
      <button type="button" className="secondary" aria-label={`Training beenden${sfx}`} onClick={onEnd}>Beenden</button>
      <div className="tk-links">
        <button type="button" className="link" aria-label={`Mehr zum Training${sfx}`} aria-expanded={more} onClick={() => setMore(!more)}>Mehr</button>
        {more && <button type="button" className="danger-link" aria-label={`Training verwerfen${sfx}`} onClick={() => setAsking(true)}>Verwerfen</button>}
      </div>
      {asking && (
        <p className="tk-note">Verwerfen löscht dieses Training samt erledigter Sätze. Wirklich verwerfen?{' '}
          <button type="button" className="danger-link" onClick={() => void onDiscard().then(() => setAsking(false))}>Ja, verwerfen</button>{' '}
          <button type="button" className="link" onClick={() => setAsking(false)}>Behalten</button>
        </p>
      )}
    </section>
  );
}
