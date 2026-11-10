import { useRef, useState } from 'react';
import { chatThread, proposalAnswer, type ChatEntry, type ChatMessage } from '../../shared/chat';
import { goalRecord, PUSHES, PUSH_LABEL, PUSH_QUESTION, storedGoalOf, type Push } from '../../shared/personal';
import type { TrackingPort } from '../ports';
import { UNDO } from '../../shared/wording';
import { usePortRecords } from './hooks';

const FAILED = 'Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.';

/**
 * Bo's question how hard he may push: the three choices and "Später". A choice writes the goal and the answer in the chat, then
 * "Gilt ab jetzt" with Rückgängig, which restores the push from before (or none) as long as nobody changed it since.
 * The state lives in the chat thread, so a reload or a second device shows the same.
 */
export function PushCard({ port, now, newId, m }: { port: TrackingPort; now: () => number; newId: () => string; m: ChatEntry }) {
  const chat = usePortRecords(port, 'chat').all;
  const goals = usePortRecords(port, 'goal').all;
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const thread = chatThread(chat ?? []);
  const answer = proposalAnswer(thread, m.id);
  const change = [...thread].reverse().find((x) => x.takes === m.id)?.pushChange;

  const once = (f: () => Promise<void>) => async () => {
    if (busy.current) return;
    busy.current = true;
    try { await f(); setFailed(false); } catch { setFailed(true); } finally { busy.current = false; }
  };
  const say = (body: ChatMessage) => port.put({ kind: 'chat', id: newId(), updatedMs: now(), deleted: false, body });
  const setPush = async (push: Push | null) => {
    const list = await port.list('goal');
    const { push: _old, ...rest } = storedGoalOf(list);
    await port.put(goalRecord(push ? { ...rest, push } : rest, now(), list.find((g) => g.id === 'goal')));
  };
  const choose = (to: Push) => once(async () => {
    const from = storedGoalOf(await port.list('goal')).push ?? null;
    await setPush(to);
    await say({ role: 'rider', text: `${PUSH_LABEL[to]}.`, atMs: now(), takes: m.id, pushChange: { from, to } });
  });
  const undo = once(async () => {
    if (!change) return;
    await setPush(change.from);
    await say({ role: 'rider', text: 'Härte rückgängig gemacht.', atMs: now(), undoes: m.id });
  });
  const later = once(async () => { await say({ role: 'rider', text: 'Später.', atMs: now(), declines: m.id }); });

  const failNote = failed && <p role="status" className="tk-note">{FAILED}</p>;
  if (answer === 'declined') return <div className="tk-nextchange"><p className="muted">Du kannst die Härte jederzeit im Profil wählen.</p>{failNote}</div>;
  if (answer === 'undone') return <div className="tk-nextchange"><p className="muted">Du hast das rückgängig gemacht.</p>{failNote}</div>;
  if (answer === 'taken' && change) {
    // Rückgängig only while the goal still has the chosen push; a later change in the profile wins.
    const still = goals !== null && storedGoalOf(goals).push === change.to;
    return (
      <div className="tk-nextchange">
        <div className="tk-row">
          <span className="muted">{`Gilt ab jetzt: ${PUSH_LABEL[change.to]}.`}</span>
          {still && <button type="button" className="link" onClick={() => void undo()}>{UNDO}</button>}
        </div>
        {goals !== null && !still && <p className="muted">Du hast die Härte danach im Profil geändert.</p>}
        {failNote}
      </div>
    );
  }
  if (answer !== null) return null;
  return (
    <div className="tk-nextchange" role="group" aria-label="Härte wählen">
      {m.text !== PUSH_QUESTION && <p><b>{PUSH_QUESTION}</b></p>}
      <div className="tk-row">
        {PUSHES.map((p) => <button key={p} type="button" className="secondary" disabled={goals === null} onClick={() => void choose(p)()}>{PUSH_LABEL[p]}</button>)}
      </div>
      <button type="button" className="link" onClick={() => void later()}>Später</button>
      {failNote}
    </div>
  );
}
