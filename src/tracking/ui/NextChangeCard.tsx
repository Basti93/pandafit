import { useState } from 'react';
import { changesOf, moveChange, type ChangeState } from '../../shared/changes';
import type { TrackedRecord } from '../../shared/records';
import type { TrackingPort } from '../ports';
import { DECLINE, DECLINED, TAKE, UNDO } from '../../shared/wording';

/**
 * The coach's proposal for the next workout: one reason sentence and Übernehmen / Nein danke; Rückgängig while it is not used.
 * The state lives in the `change` record and only moves forward, so a reload or a second device shows the same.
 */
export function NextChangeCard({ port, changeId, records, now, history }: { port: TrackingPort; changeId: string; records: TrackedRecord[] | null; now: () => number; /** In the chat history: one line, no buttons except Rückgängig; a proposal still open is pinned elsewhere. */ history?: boolean }) {
  const [failed, setFailed] = useState(false);
  const c = changesOf(records ?? []).find((x) => x.id === changeId);
  if (!c) return null;
  const go = async (to: ChangeState) => {
    try {
      const cur = (await port.list('change')).find((r) => r.id === changeId);
      const next = cur ? moveChange(cur, to, now()) : null;
      if (next) await port.put(next);
      setFailed(false);
    } catch { setFailed(true); }
  };
  if (history) {
    if (c.state === 'proposed') return null;
    if (c.state === 'used') return <div className="tk-histline"><span className="muted">✓ Im Training berücksichtigt</span><span className="muted tk-block">{c.reason}</span></div>;
    const line = c.state === 'taken' ? `Übernommen: ${c.reason}` : c.state === 'declined' ? DECLINED : 'Rückgängig gemacht.';
    return (
      <div className="tk-histline">
        <span className="muted">{line}</span>
        {c.state === 'taken' && <button type="button" className="link" onClick={() => void go('undone')}>{UNDO}</button>}
        {failed && <span role="status" className="tk-note">Gerade nicht gespeichert. Versuch es gleich nochmal.</span>}
      </div>
    );
  }
  return (
    <div className="tk-nextchange">
      <p>{c.state === 'proposed' ? `Fürs nächste Training: ${c.reason}` : c.reason}</p>
      {c.state === 'proposed' && (
        <div className="tk-row">
          <button type="button" onClick={() => void go('taken')}>{TAKE}</button>
          <button type="button" className="link" onClick={() => void go('declined')}>{DECLINE}</button>
        </div>
      )}
      {c.state === 'taken' && <div className="tk-row"><span className="muted">Übernommen fürs nächste Training.</span><button type="button" className="link" onClick={() => void go('undone')}>{UNDO}</button></div>}
      {c.state === 'used' && <p className="muted">Im Training berücksichtigt.</p>}
      {c.state === 'declined' && <p className="muted">{DECLINED}.</p>}
      {c.state === 'undone' && <p className="muted">Rückgängig gemacht.</p>}
      {failed && <p role="status" className="tk-note">Gerade nicht gespeichert. Versuch es gleich nochmal.</p>}
    </div>
  );
}
