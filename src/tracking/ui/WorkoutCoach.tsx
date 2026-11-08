import { useEffect, useState } from 'react';
import { chatThread, proposalAnswer, waitingMessage, MAX_CHAT_TEXT, type ChatEntry, type ChatMessage, type WorkoutChange, type WorkoutOp } from '../../shared/chat';
import type { Exercise } from '../../shared/exercises';
import type { TrackingPort } from '../ports';
import type { TrackedWorkout } from '../session';
import { changeTaken, checkOps, undoRefusal } from '../workout-change';
import { DECLINE, DECLINED, gehtNicht, TAKE, UNDO } from '../../shared/wording';
import { changesOf } from '../../shared/changes';
import { NextChangeCard } from './NextChangeCard';
import { RuleCard } from './RuleCard';
import { ChatBubble } from './ChatBubble';
import { useExcluded, usePortRecords } from './hooks';

/** One op in plain German, with the exercise names of this workout. */
export function opText(o: WorkoutOp, w: TrackedWorkout, catalog: Exercise[]): string {
  const name = w.exercises.find((e) => e.rid === o.ex)?.title ?? 'Übung';
  switch (o.op) {
    case 'drop': return `${name}: die restlichen Sätze weglassen`;
    case 'swap': return `${name} tauschen gegen ${catalog.find((e) => e.id === o.to)?.title ?? o.to}`;
    case 'sets': return o.open === 0 ? `${name}: keine weiteren Sätze` : `${name}: noch ${o.open} ${o.open === 1 ? 'Satz' : 'Sätze'}`;
    case 'lighter': return `${name}: ${Math.round(o.pct)} % leichter`;
  }
}

/**
 * Talking to the coach during a workout: "Gerät belegt", "Schulter zwickt", "nur noch 30 Minuten". The coach answers in the
 * same chat (it needs a connection); a proposed change applies only on "Übernehmen" and never touches done sets.
 */
export function WorkoutCoach({ port, workout, catalog, now, newId, onTake, onUndo, openSignal }: {
  /** Raised each time the rider picks "Coach fragen" elsewhere (the workout menu). Without it, the panel brings its own button. */
  openSignal?: number;
  port: TrackingPort; workout: TrackedWorkout; catalog: Exercise[]; now: () => number; newId: () => string; /** One workout write that applies the ops and lists `id`; `onUndo` restores the rows in one write. */
  onTake: (id: string, c: WorkoutChange) => void; onUndo: (id: string) => void;
}) {
  const excluded = useExcluded(port);
  const chat = usePortRecords(port, 'chat').all;
  const changeRecs = usePortRecords(port, 'change').all;
  const ruleRecs = usePortRecords(port, 'rule').all;
  const thread = chatThread(chat ?? []);
  const mine = thread.filter((m) => m.inWorkout === workout.id && !m.takes && !m.declines && !m.undoes);
  const key = (m: ChatEntry) => `${m.id}:0`;
  const pending = mine.some((m) => m.workoutChange && proposalAnswer(thread, m.id) === null && !changeTaken(workout, key(m)));
  const proposedNext = mine.some((m) => m.nextChange && changesOf(changeRecs ?? []).some((c) => c.id === m.nextChange && c.state === 'proposed'));
  const waiting = waitingMessage(thread)?.inWorkout === workout.id;
  const [line, setLine] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A taken change stays visible (with "Rückgängig") until the panel is closed, also after a reload.
  const [closed, setClosed] = useState(false);
  const kept = mine.some((m) => m.workoutChange && changeTaken(workout, key(m)));
  useEffect(() => { if (openSignal) { setOpen(true); setClosed(false); } }, [openSignal]);
  const shown = open || pending || proposedNext || waiting || (kept && !closed);

  const write = async (m: ChatMessage) => {
    setError(null);
    try { await port.put({ kind: 'chat', id: newId(), updatedMs: now(), deleted: false, body: m }); return true; } catch { setError('Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.'); return false; }
  };
  const send = async () => {
    const t = text.trim().slice(0, MAX_CHAT_TEXT);
    if (t && (await write({ role: 'rider', text: t, atMs: now(), inWorkout: workout.id }))) setText('');
  };
  // Taken = the workout lists it. The ops and that entry are one workout write, so a double tap or reload cannot apply twice.
  const take = async (m: ChatEntry & { workoutChange: WorkoutChange }) => {
    if (changeTaken(workout, key(m))) return;
    setOpen(true);
    const { ops, reasons } = checkOps(m.workoutChange, workout, catalog, excluded);
    const why = gehtNicht(reasons);
    setLine(ops.length === 0 ? ['Nicht übernommen.', why].filter(Boolean).join(' ') : why);
    if (ops.length === 0) { await write({ role: 'rider', text: 'Nicht übernommen.', atMs: now(), declines: m.id, inWorkout: workout.id }); return; }
    onTake(key(m), m.workoutChange);
    await write({ role: 'rider', text: 'Übernommen.', atMs: now(), takes: m.id, inWorkout: workout.id });
  };
  const undo = (m: ChatEntry) => {
    setLine(null);
    const why = undoRefusal(workout, key(m));
    setLine(why);
    if (!why) onUndo(key(m));
  };

  if (!shown) return openSignal !== undefined ? null : <button type="button" className="secondary tk-coach-open" onClick={() => { setOpen(true); setClosed(false); }}>Coach fragen</button>;
  return (
    <section className="card tk-coach-panel" aria-label="Coach im Training">
      {mine.length === 0 && <p className="muted">Zum Beispiel: „Gerät belegt“, „Schulter zwickt“ oder „nur noch 30 Minuten“.</p>}
      {mine.slice(-6).map((m) => (
        <ChatBubble key={m.id} m={m}>
          {m.nextChange && <NextChangeCard port={port} changeId={m.nextChange} records={changeRecs} now={now} />}
          {m.rule && <RuleCard port={port} ruleId={m.rule} records={ruleRecs} catalog={catalog} now={now} />}
          {m.workoutChange && (
            <>
              <ul>{m.workoutChange.ops.map((o, i) => <li key={i}>{opText(o, workout, catalog)}</li>)}</ul>
              {proposalAnswer(thread, m.id) === null && !changeTaken(workout, key(m)) ? (
                <div className="tk-row">
                  <button type="button" onClick={() => void take(m as ChatEntry & { workoutChange: WorkoutChange })}>{TAKE}</button>
                  <button type="button" className="link" onClick={() => { setOpen(true); void write({ role: 'rider', text: 'Nein danke.', atMs: now(), declines: m.id, inWorkout: workout.id }); }}>{DECLINE}</button>
                </div>
              ) : changeTaken(workout, key(m)) ? (
                <div className="tk-row"><span className="muted">Übernommen.</span>
                  <button type="button" className="link" onClick={() => undo(m)}>{UNDO}</button></div>
              ) : <p className="muted">{proposalAnswer(thread, m.id) === 'declined' ? `${DECLINED}.` : 'Du hast das rückgängig gemacht.'}</p>}
            </>
          )}
        </ChatBubble>
      ))}
      {line && <p role="note" className="tk-note">{line}</p>}
      {waiting && <p role="status" className="muted">Der Coach denkt nach … Dafür braucht er Netz.</p>}
      {error && <p role="alert" className="tk-note">{error}</p>}
      <form className="tk-row tk-chat-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea aria-label="Nachricht an den Coach im Training" rows={1} value={text} maxLength={MAX_CHAT_TEXT} onChange={(e) => setText(e.target.value)} placeholder="Was ist los?" />
        <button type="submit" disabled={!text.trim()}>Senden</button>
      </form>
      {!pending && !proposedNext && !waiting && <button type="button" className="link" onClick={() => { setOpen(false); setClosed(true); }}>Schließen</button>}
    </section>
  );
}
