import { useRef, useState } from 'react';
import { driftTakeWrites, driftUndoWrites, otherBlockActive, resumedBlockId } from '../../shared/block-take';
import { readBlock } from '../../shared/block';
import { chatThread, type ChatEntry, type ChatMessage } from '../../shared/chat';
import { dateKey } from '../../shared/day-rating';
import type { TrackedRecord } from '../../shared/records';
import { UNDO } from '../../shared/wording';
import type { TrackingPort } from '../ports';
import { driftAnswer } from './chat-open';
import { usePortRecords } from './hooks';

const FAILED = 'Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.';

/**
 * Bo's question whether the fixed section still fits: "Ja, locker planen" ends the section and sets the plan mode to spontaneous
 * (week plans and the goal stay), then "Rückgängig" brings both back while the frame is unchanged; "Nein, weiter so" keeps the section.
 * The answer lives in the chat thread, so a reload or a second device shows the same.
 */
export function DriftCard({ port, now, newId, m }: { port: TrackingPort; now: () => number; newId: () => string; m: ChatEntry }) {
  const chat = usePortRecords(port, 'chat').all;
  const blocks = usePortRecords(port, 'block').all;
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const answer = driftAnswer(chatThread(chat ?? []), m, blocks ?? []);
  const rec = (blocks ?? []).find((r) => r.id === m.drift);
  const body = rec && !rec.deleted ? readBlock(rec.body) : null;

  const once = (f: () => Promise<void>) => async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await f(); setFailed(false); } catch { setFailed(true); } finally { inFlight.current = false; setBusy(false); }
  };
  const put = async (r: TrackedRecord) => { const res = await port.put(r); if (!res.kept) throw new Error('kept'); };
  const say = (msg: ChatMessage) => port.put({ kind: 'chat', id: newId(), updatedMs: now(), deleted: false, body: msg });
  // Frame first, section last; the answer in the chat after both, so a failure on the way leaves the question open.
  const yes = once(async () => {
    const [cur, frame] = await Promise.all([port.list('block'), port.list('frame')]);
    const block = cur.find((r) => r.id === m.drift);
    if (!block) return;
    const writes = driftTakeWrites({ block, frame, msgId: m.id, nowMs: now() });
    // A section that ended in the meantime is not written again; the answer still counts.
    for (const w of writes ?? []) await put(w);
    await say({ role: 'rider', text: 'Ja, locker planen.', atMs: now(), takes: m.id });
  });
  const no = once(async () => { await say({ role: 'rider', text: 'Nein, weiter so.', atMs: now(), declines: m.id }); });
  const undo = once(async () => {
    const [cur, frame] = await Promise.all([port.list('block'), port.list('frame')]);
    const block = cur.find((r) => r.id === m.drift);
    const writes = block ? driftUndoWrites({ block, frame, blocks: cur, nowMs: now() }) : null;
    // Refused in the meantime (a new section runs): nothing is written and the answer stays as it is.
    if (!writes) return;
    for (const w of writes ?? []) await put(w);
    await say({ role: 'rider', text: 'Rückgängig gemacht.', atMs: now(), undoes: m.id });
  });

  const failNote = failed && <p role="status" className="tk-note">{FAILED}</p>;
  if (answer === 'declined') return <div className="tk-nextchange"><p className="muted">Gut, wir bleiben beim festen Abschnitt.</p>{failNote}</div>;
  if (answer === 'undone') return <div className="tk-nextchange"><p className="muted">Du hast das rückgängig gemacht. Der feste Abschnitt gilt weiter.</p>{failNote}</div>;
  if (answer === 'taken') {
    // A deleted record anywhere in the chain (a tombstone) would block the resumed record: then no Rückgängig.
    let tombstone = false;
    for (let cid = m.drift ?? ''; cid !== ''; cid = resumedBlockId(cid)) {
      const r = (blocks ?? []).find((x) => x.id === cid);
      if (!r) break;
      if (r.deleted) { tombstone = true; break; }
    }
    const newer = otherBlockActive(blocks ?? [], m.drift ?? '');
    const canUndo = body?.state === 'ended' && !!body.end && dateKey(now()) <= body.end && !tombstone && !newer;
    return (
      <div className="tk-nextchange">
        <div className="tk-row">
          <span className="muted">Ab jetzt plane ich wieder locker, dein Ziel bleibt.</span>
          {canUndo && <button type="button" className="link" disabled={busy} onClick={() => void undo()}>{UNDO}</button>}
          {newer && <span className="muted">Inzwischen läuft ein neuer Abschnitt.</span>}
        </div>
        {failNote}
      </div>
    );
  }
  return (
    <div className="tk-nextchange" role="group" aria-label="Abschnitt anpassen">
      <div className="tk-row">
        <button type="button" className="primary" disabled={blocks === null || busy} onClick={() => void yes()}>Ja, locker planen</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void no()}>Nein, weiter so</button>
      </div>
      {failNote}
    </div>
  );
}
