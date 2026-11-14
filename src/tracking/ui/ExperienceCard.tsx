import { useRef, useState } from 'react';
import { chatThread, proposalAnswer, type ChatEntry, type ChatMessage } from '../../shared/chat';
import { goalRecord, storedGoalOf } from '../../shared/personal';
import { EXPERIENCES, EXPERIENCE_ANSWER, EXPERIENCE_QUESTION, type Experience } from '../../shared/experience';
import type { TrackingPort } from '../ports';
import { UNDO } from '../../shared/wording';
import { usePortRecords } from './hooks';

const FAILED = 'Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.';

/**
 * Bo's one question how long the person trains with weights: three answers and "Später". An answer goes into the goal record
 * and into the chat, then a short confirmation with Rückgängig, which restores the answer from before (or none) as long as
 * nobody changed it since. Like the push question, the state lives in the chat thread.
 */
export function ExperienceCard({ port, now, newId, m }: { port: TrackingPort; now: () => number; newId: () => string; m: ChatEntry }) {
  const chat = usePortRecords(port, 'chat').all;
  const goals = usePortRecords(port, 'goal').all;
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const thread = chatThread(chat ?? []);
  const answer = proposalAnswer(thread, m.id);
  const change = [...thread].reverse().find((x) => x.takes === m.id)?.experienceChange;

  const once = (f: () => Promise<void>) => async () => {
    if (busy.current) return;
    busy.current = true;
    try { await f(); setFailed(false); } catch { setFailed(true); } finally { busy.current = false; }
  };
  const say = (body: ChatMessage) => port.put({ kind: 'chat', id: newId(), updatedMs: now(), deleted: false, body });
  const setExperience = async (e: Experience | null) => {
    const list = await port.list('goal');
    const { experience: _old, ...rest } = storedGoalOf(list);
    await port.put(goalRecord(e ? { ...rest, experience: e } : rest, now(), list.find((g) => g.id === 'goal')));
  };
  const choose = (to: Experience) => once(async () => {
    const from = storedGoalOf(await port.list('goal')).experience ?? null;
    await setExperience(to);
    await say({ role: 'rider', text: `${EXPERIENCE_ANSWER[to]}.`, atMs: now(), takes: m.id, experienceChange: { from, to } });
  });
  const undo = once(async () => {
    if (!change) return;
    await setExperience(change.from);
    await say({ role: 'rider', text: 'Antwort rückgängig gemacht.', atMs: now(), undoes: m.id });
  });
  const later = once(async () => { await say({ role: 'rider', text: 'Später.', atMs: now(), declines: m.id }); });

  const failNote = failed && <p role="status" className="tk-note">{FAILED}</p>;
  if (answer === 'declined') return <div className="tk-nextchange"><p className="muted">Kein Problem, ich richte mich nach deinen Trainings.</p>{failNote}</div>;
  if (answer === 'undone') return <div className="tk-nextchange"><p className="muted">Du hast das rückgängig gemacht.</p>{failNote}</div>;
  if (answer === 'taken' && change) {
    const still = goals !== null && storedGoalOf(goals).experience === change.to;
    return (
      <div className="tk-nextchange">
        <div className="tk-row">
          <span className="muted">Danke, ich plane dein Krafttraining danach.</span>
          {still && <button type="button" className="link" onClick={() => void undo()}>{UNDO}</button>}
        </div>
        {failNote}
      </div>
    );
  }
  if (answer !== null) return null;
  return (
    <div className="tk-nextchange" role="group" aria-label="Erfahrung mit Gewichten">
      {m.text !== EXPERIENCE_QUESTION && <p><b>{EXPERIENCE_QUESTION}</b></p>}
      <div className="tk-row">
        {EXPERIENCES.map((e) => <button key={e} type="button" className="secondary" disabled={goals === null} onClick={() => void choose(e)()}>{EXPERIENCE_ANSWER[e]}</button>)}
      </div>
      <button type="button" className="link" onClick={() => void later()}>Später</button>
      {failNote}
    </div>
  );
}
