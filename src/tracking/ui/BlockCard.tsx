import { useRef, useState } from 'react';
import { blockDates, blockWeeks, readBlock } from '../../shared/block';
import { blockTakeWrites, blockUndoWrites } from '../../shared/block-take';
import { dateKey } from '../../shared/day-rating';
import { dayMonthOfKey } from '../../shared/dates';
import { above } from '../../shared/exercise-links';
import { DECLINE, DECLINED, TAKE, UNDO } from '../../shared/wording';
import type { TrackingPort } from '../ports';
import { planRows } from './done-days';
import { useCatalog, usePortRecords } from './hooks';
import { Week } from './WeekList';

const list = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`);
/** A sentence ends with one full stop, also when the date label already ends with one. */
const sentence = (t: string): string => (t.endsWith('.') ? t : `${t}.`);
const FAILED = 'Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.';

/**
 * The monthly review's proposal of a fixed section: the dates, per template the core exercises, the week rhythm, Übernehmen / Nein danke.
 * After taking: "Gilt ab {Start}." with Rückgängig, while no week plan of the section was changed. The state lives in the `block` record.
 * `msgId`: the chat message that carries the section; the week plans it writes are marked with it.
 */
export function BlockCard({ port, blockId, msgId, now, history }: { port: TrackingPort; blockId: string; msgId: string; now: () => number; /** In the chat history: one line, Rückgängig only. */ history?: boolean }) {
  const blocks = usePortRecords(port, 'block');
  const plans = usePortRecords(port, 'weekplan').all;
  const catalog = useCatalog(port);
  const [message, setMessage] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  // One take or undo at a time: a fast double tap must not write twice.
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const rec = (blocks.all ?? []).find((r) => r.id === blockId);
  const body = rec && !rec.deleted ? readBlock(rec.body) : null;
  if (!rec || !body) return rec?.deleted && undone ? <div className="tk-nextchange"><p className="muted">Du hast den Abschnitt rückgängig gemacht.</p></div> : null;
  const titleOf = (id: string) => catalog.find((e) => e.id === id)?.title ?? id;

  const go = async (to: 'take' | 'decline' | 'undo') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const nowMs = now();
      const [blockRecs, frame, weekplans] = await Promise.all([port.list('block'), port.list('frame'), port.list('weekplan')]);
      const cur = blockRecs.find((r) => r.id === blockId);
      if (!cur) return;
      let writes;
      if (to === 'take') writes = blockTakeWrites({ block: cur, frame, plans: weekplans, blocks: blockRecs, msgId, today: dateKey(nowMs), nowMs });
      else if (to === 'undo') {
        const r = blockUndoWrites({ block: cur, frame, plans: weekplans, msgId, nowMs });
        if ('refused' in r) { setMessage(r.refused); return; }
        writes = r;
      } else {
        const b = readBlock(cur.body);
        writes = b && b.state === 'proposed' ? [{ ...cur, updatedMs: above(nowMs, cur), body: { ...b, state: 'declined' as const } }] : null;
      }
      for (const w of writes ?? []) {
        const res = await port.put(w);
        if (!res.kept) { setMessage(FAILED); return; }
      }
      if (to === 'undo') setUndone(true);
      setMessage(null);
    } catch { setMessage(FAILED); } finally { inFlight.current = false; setBusy(false); }
  };
  // The undo is offered while every week plan of the section is still the one the take wrote.
  const undoWhy = body.state === 'active' ? blockUndoWrites({ block: rec, frame: [], plans: plans ?? [], msgId, nowMs: now() }) : null;
  const why = plans !== null && undoWhy !== null && 'refused' in undoWhy ? undoWhy.refused : null;
  const canUndo = body.state === 'active' && plans !== null && undoWhy !== null && !('refused' in undoWhy);

  if (history) {
    if (body.state === 'proposed') return null;
    const line = body.state === 'declined' ? DECLINED : body.state === 'active' ? `Du hast den festen Abschnitt bis ${dayMonthOfKey(body.end!)} übernommen.` : 'Der feste Abschnitt ist zu Ende.';
    return (
      <div className="tk-histline">
        <span className="muted">{line}</span>
        {canUndo && <button type="button" className="link" disabled={busy} onClick={() => void go('undo')}>{UNDO}</button>}
        {why && <span className="muted">{why}</span>}
        {message && <span role="status" className="tk-note">{message}</span>}
      </div>
    );
  }
  if (body.state === 'proposed') {
    const dates = blockDates(dateKey(now()));
    const first = blockWeeks({ ...body, ...dates })[0];
    return (
      <div className="tk-nextchange">
        <p><b>Fester Abschnitt bis {dayMonthOfKey(dates.end)}</b></p>
        {body.templates.map((t) => <p key={t.name}>{t.name} mit {list(t.core.map(titleOf))}.</p>)}
        {first && <Week brief rows={planRows(first.days)} label="Wochenrhythmus des Abschnitts" />}
        {message && <p role="status" className="tk-note">{message}</p>}
        <div className="tk-row">
          <button type="button" className="primary" disabled={plans === null || busy} onClick={() => void go('take')}>{TAKE}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void go('decline')}>{DECLINE}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="tk-nextchange">
      {body.state === 'active' && (
        <div className="tk-row">
          <span className="muted">{sentence(`Gilt ab ${dayMonthOfKey(body.start!)}`)}</span>
          {canUndo && <button type="button" className="link" disabled={busy} onClick={() => void go('undo')}>{UNDO}</button>}
          {why && <span className="muted">{why}</span>}
        </div>
      )}
      {body.state === 'declined' && <p className="muted">{DECLINED}.</p>}
      {message && <p role="status" className="tk-note">{message}</p>}
    </div>
  );
}
