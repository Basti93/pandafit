import './tracking.css';
import { useState } from 'react';
import { Row, RowList, Sheet } from './kit';

type KeyStore = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
type Session = { id: string; minutes: number; reason: string; exercises: { id: string; title: string; howTo: string }[] };

/** The local calendar day, so "Heute nicht" ends at midnight where the person is. */
export const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const hiddenToday = (storage: KeyStore, key: string, nowMs: number): boolean => {
  try { return storage.getItem(key) === dayKey(nowMs); } catch { return false; }
};
export const hideToday = (storage: KeyStore, key: string, nowMs: number): void => {
  try { storage.setItem(key, dayKey(nowMs)); } catch { /* then it only stays hidden until the page reloads */ }
};

/**
 * Mobility, offered and never owed. One separate row with the minutes; the exercises, "Gemacht" and "Heute nicht" in a sheet.
 * "Heute nicht" hides it for today on this device only: nothing is sent and nothing is asked.
 */
export function MobilityOffer({ session, hideKey, storage, now, onDone }: { session: Session; hideKey: string; storage: KeyStore; now: () => number; onDone: () => void }) {
  const [hidden, setHidden] = useState(() => hiddenToday(storage, hideKey, now()));
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  const omitted = /Bereiche, die dich gerade stören[^.]*\./.exec(session.reason)?.[0] ?? '';
  return (
    <section aria-label="Beweglichkeit" className="tk-mob">
      <RowList>
        <Row title={`Beweglichkeit · ${session.minutes} Min`} onClick={() => setOpen(true)} />
      </RowList>
      {open && (
        <Sheet title="Beweglichkeit" onClose={() => setOpen(false)}
          actions={<>
            <button type="button" className="primary" onClick={() => { setOpen(false); onDone(); }}>Gemacht</button>
            <button type="button" className="link" onClick={() => { hideToday(storage, hideKey, now()); setHidden(true); }}>Heute nicht</button>
          </>}>
          {/* The stored reason opens with "Nach dem Training …", which is wrong on a rest day: only its note on left-out areas stays. */}
          <p>Kurz und ruhig, nur wenn du magst.{omitted ? ` ${omitted}` : ''}</p>
          <ol className="tk-mob-list">
            {session.exercises.map((e) => <li key={e.id}><b>{e.title}</b><span>{e.howTo}</span></li>)}
          </ol>
        </Sheet>
      )}
    </section>
  );
}
