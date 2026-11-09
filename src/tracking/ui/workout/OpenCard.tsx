import { useState } from 'react';
import { bodyOf } from '../../../shared/record-bodies';
import type { TrackedRecord } from '../../../shared/records';
import { dateLabel } from '../labels';
import { ConfirmLink, MainCard, RowCard, Sheet } from '../kit';

const QUESTION = 'Verwerfen löscht dieses Training samt erledigter Sätze. Wirklich verwerfen?';

/**
 * A workout that is still open. The newest is the main card "Läuft noch"; another one (rare) is a row card that opens a small sheet
 * with the same actions, their names ending in the title and date so they stay apart.
 */
export function OpenCard({ rec, primary, onResume, onEnd, onDiscard }: { rec: TrackedRecord; primary: boolean; onResume: () => void; onEnd: () => void; onDiscard: () => Promise<void> }) {
  const w = bodyOf('workout', rec);
  const [open, setOpen] = useState(false);
  const text = `Gestartet ${dateLabel(w.startMs)}. Alles ist gespeichert.`;
  if (primary) {
    return (
      <MainCard kicker="Läuft noch" title={w.title} text={text}
        primary={{ label: 'Weitermachen', onClick: onResume }} secondary={{ label: 'Training beenden', onClick: onEnd }}
        more={<ConfirmLink label="Training verwerfen" question={QUESTION} onConfirm={() => void onDiscard()} />} />
    );
  }
  const sfx = ` ${w.title} ${dateLabel(w.startMs)}`;
  return (
    <>
      <RowCard icon="kraft" kicker="Läuft noch" title={w.title} sub={`Gestartet ${dateLabel(w.startMs)}`} onClick={() => setOpen(true)} />
      {open && (
        <Sheet size="small" title={`${w.title} läuft noch`} onClose={() => setOpen(false)}
          actions={<>
            <button type="button" className="primary" onClick={onResume}>{`Weitermachen${sfx}`}</button>
            <button type="button" className="secondary" onClick={onEnd}>{`Training beenden${sfx}`}</button>
          </>}>
          <p className="muted">{text}</p>
          <ConfirmLink label={`Training verwerfen${sfx}`} question={QUESTION} onConfirm={() => void onDiscard().then(() => setOpen(false))} />
        </Sheet>
      )}
    </>
  );
}
