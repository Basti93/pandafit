import { bodyOf } from '../../shared/record-bodies';
import { useRef, useState } from 'react';
import { ReadFailed } from './ReadFailed';
import type { GymExercise, GymWorkout } from '../../shared/gym/types';
import type { TrackedRecord } from '../../shared/records';
import type { TrackingPort } from '../ports';
import { ExercisePicker } from './ExercisePicker';
import { ConfirmLink, Row, RowList, Sheet } from './kit';
import { usePortRecords } from './hooks';

type Draft = { id: string; isNew: boolean; name: string; exercises: GymExercise[]; updatedMs: number };
/** Always newer than the stored copy, whatever the clock says, so the last edit wins. */
const after = (now: () => number, prev: number): number => Math.max(now(), prev + 1);
const emptySet = () => ({ type: 'normal' as const, weightKg: null, reps: null });

export function RoutinesScreen({ port, onStart, now = Date.now, newId = () => crypto.randomUUID() }: {
  port: TrackingPort; onStart: (r: GymWorkout) => void; now?: () => number; newId?: () => string;
}) {
  const q = usePortRecords(port, 'routine');
  const records = q.records;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const [open, setOpen] = useState<string | null>(null);

  const write = async (r: TrackedRecord): Promise<boolean> => { try { await port.put(r); setFailed(false); return true; } catch { setFailed(true); return false; } };

  const count = (b: GymWorkout) => `${b.exercises.length} ${b.exercises.length === 1 ? 'Übung' : 'Übungen'}`;
  const openRecord = (records ?? []).find((r) => r.id === open);
  const note = failed && <p role="status" className="tk-note">Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.</p>;

  const closeAll = () => { setDraft(null); setOpen(null); setFailed(false); };
  // One sheet for a routine: it reads first and turns into the editor, so Back and × always close the whole thing.
  const sheet = (() => {
    if (draft) {
      const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
      const setEx = (i: number, f: (e: GymExercise) => GymExercise | null) =>
        set({ exercises: draft.exercises.flatMap((e, k) => (k === i ? (f(e) ? [f(e)!] : []) : [e])) });
      const valid = draft.name.trim() !== '' && draft.exercises.length > 0;
      return (
        <Sheet title={draft.isNew ? 'Neue Routine' : 'Routine bearbeiten'} onClose={closeAll}
          actions={<>
            {!valid && (draft.name !== '' || draft.exercises.length > 0) && <p className="muted tk-oneline">Gib einen Namen und mindestens eine Übung an.</p>}
            <button type="button" disabled={!valid} onClick={async () => {
              if (saving.current) return; // a double tap saves once
              saving.current = true;
              try {
                const body: GymWorkout = { name: draft.name.trim(), exercises: draft.exercises };
                if (await write({ kind: 'routine', id: draft.id, updatedMs: after(now, draft.updatedMs), deleted: false, body })) closeAll();
              } finally { saving.current = false; }
            }}>Speichern</button>
            <button type="button" className="link" onClick={closeAll}>Abbrechen</button>
          </>}>
          <label className="tk-field">Name der Routine<input autoFocus value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <RowList label="Übungen">
            {draft.exercises.map((e, i) => (
              <li key={i} className="tk-rowitem tk-stepper">
                <span className="tk-row-title">{e.title}</span>
                <button type="button" className="tk-step-btn" aria-label={`Satz entfernen ${e.title}`} disabled={e.sets.length <= 1} onClick={() => setEx(i, (x) => ({ ...x, sets: x.sets.slice(0, -1) }))}>−</button>
                <span className="tk-stepcount" aria-label={`${e.sets.length} Sätze`}>{e.sets.length} {e.sets.length === 1 ? 'Satz' : 'Sätze'}</span>
                <button type="button" className="tk-step-btn" aria-label={`Satz hinzufügen ${e.title}`} onClick={() => setEx(i, (x) => ({ ...x, sets: [...x.sets, emptySet()] }))}>+</button>
                <button type="button" className="danger-link tk-del-ex" aria-label={`Übung entfernen ${e.title}`} onClick={() => setEx(i, () => null)}>×</button>
              </li>
            ))}
          </RowList>
          <button type="button" className="secondary" onClick={() => setPicking(true)}>Übung hinzufügen</button>
          {note}
          {!draft.isNew && (() => {
            const stored = (records ?? []).find((r) => r.id === draft.id);
            return stored ? <div className="tk-links"><ConfirmLink label="Routine löschen" question="Routine wirklich löschen?" onConfirm={async () => { if (await write({ ...stored, updatedMs: after(now, Math.max(stored.updatedMs, draft.updatedMs)), deleted: true })) closeAll(); }} /></div> : null;
          })()}
        </Sheet>
      );
    }
    if (!openRecord) return null;
    const body = bodyOf('routine', openRecord);
    return (
      <Sheet title={body.name} onClose={closeAll}
        actions={<>
          <button type="button" onClick={() => { setOpen(null); onStart(body); }}>Training starten</button>
          <button type="button" className="secondary" onClick={() => setDraft({ id: openRecord.id, isNew: false, name: body.name, exercises: body.exercises, updatedMs: openRecord.updatedMs })}>Bearbeiten</button>
        </>}>
        {body.exercises.length === 0 ? <p className="muted">Diese Routine hat noch keine Übung.</p> : (
          <RowList label="Übungen">{body.exercises.map((e, i) => <Row key={i} title={e.title} value={`${e.sets.length} Sätze`} />)}</RowList>
        )}
        {note}
      </Sheet>
    );
  })();

  return (
    <div className="tk-screen">
      {q.failed && <ReadFailed text="Deine Routinen konnten gerade nicht gelesen werden." retry={q.retry} />}
      {records !== null && records.length === 0 && <p className="muted">Noch keine Routine. Leg eine an, dann startest du sie mit einem Tipp.</p>}
      {(records ?? []).length > 0 && (
        <RowList label="Routinen">
          {(records ?? []).map((r) => {
            const body = bodyOf('routine', r);
            return <Row key={r.id} title={body.name} value={count(body)} onClick={() => setOpen(r.id)} />;
          })}
        </RowList>
      )}
      {!sheet && note}
      <button type="button" className="secondary" onClick={() => setDraft({ id: newId(), isNew: true, name: '', exercises: [], updatedMs: 0 })}>Neue Routine</button>
      {sheet}
      {draft && picking && <ExercisePicker port={port} now={now} newId={newId} onClose={() => setPicking(false)} onPick={(ex) => {
        setPicking(false);
        setDraft({ ...draft, exercises: [...draft.exercises, { templateId: ex.id, title: ex.title, restS: null, supersetId: null, notes: '', sets: [emptySet(), emptySet(), emptySet()] }] });
      }} />}
    </div>
  );
}
