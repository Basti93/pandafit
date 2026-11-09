import type { Exercise } from '../../../shared/exercises';
import { extendRest, setStudio, swapExercise, addExercise, moveExercise, moveExerciseTo } from '../../session';
import { takeChange, undoChange } from '../../workout-change';
import { rememberStudio, renameStudio } from '../../studios';
import { ExercisePicker } from '../ExercisePicker';
import { ReorderSheet } from '../ReorderSheet';
import { StudioSheet } from '../StudioSheet';
import { WorkoutCoach } from '../WorkoutCoach';
import { ConfirmLink, Sheet } from '../kit';
import { clock } from '../labels';
import { ExerciseSection } from './ExerciseSection';
import { sinceLabel } from './markUsed';
import { NOT_SAVED, useActiveWorkout, type ActiveWorkoutProps } from './useActiveWorkout';

export function ActiveWorkout(props: ActiveWorkoutProps) {
  const a = useActiveWorkout(props);
  const { port, w, save, ui, set, askCoach, setNotice, screenRef, held, catalog, excluded, studios, overrides, history, now, newId, remaining, known, act, end, discard } = a;
  const { picker } = ui;
  return (
    <div className="tk-screen tk-live" ref={screenRef}>
      <div className="tk-live-head">
        <h1 className="tk-title">{w.title}</h1>
        <button type="button" className="link tk-more" aria-label="Mehr zum Training" onClick={() => set({ topMenu: true })}>⋯</button>
      </div>
      {save === 'unsaved' && (
        <p role="status" className="tk-note">
          Das konnte gerade nicht gespeichert werden. Dein Training bleibt hier offen und wird mit dem nächsten Schritt erneut gespeichert.
          {' '}<button type="button" className="secondary" onClick={() => act((x) => x)}>Jetzt nochmal speichern</button>
        </p>
      )}
      {ui.notice && <p role="note" className="tk-note">{ui.notice}</p>}
      <WorkoutCoach port={port} workout={w} catalog={catalog} now={now} newId={newId} openSignal={ui.coachAsk}
        onTake={(id, c) => act((x) => takeChange(x, id, c, history, catalog, studios, now(), excluded).workout)} onUndo={(id) => act((x) => undoChange(x, id).workout)} />
      {w.exercises.map((e) => <ExerciseSection key={e.rid} e={e} a={a} />)}
      {ui.reorder && (
        <ReorderSheet workout={w} start={ui.reorder}
          onDrop={(rid, to) => act((x) => moveExerciseTo(x, rid, to))} onStep={(rid, dir) => act((x) => moveExercise(x, rid, dir))}
          onClose={() => { held.current = false; set({ reorder: null }); }} />
      )}
      <div className="tk-end">
        <button type="button" className="secondary" onClick={() => set({ picker: { mode: 'add' } })}>Übung hinzufügen</button>
        <button type="button" className="secondary" onClick={() => void end()}>Training beenden</button>
      </div>
      {w.rest && remaining > 0 && !ui.ask && (
        <div role="timer" aria-label="Satzpause" className="tk-rest">
          <button type="button" className="tk-rest-main" aria-label="Pause überspringen" onClick={() => act((x) => ({ ...x, rest: null }))}>Pause {clock(remaining)}</button>
          <button type="button" className="tk-skip" onClick={() => act((x) => extendRest(x))}>+30 s</button>
        </div>
      )}
      {ui.topMenu && (
        <Sheet size="small" title="Training" onClose={() => set({ topMenu: false })}>
          <p role="timer" aria-label="Trainingsdauer" className="muted tk-elapsed">Läuft seit {sinceLabel(now() - w.startMs)}</p>
          <ul className="tk-rows">
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { set({ topMenu: false, studioOpen: true }); }}><span className="tk-row-title">Studio wechseln</span><span className="tk-row-value muted">{w.studio ?? '–'}</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { set({ topMenu: false }); askCoach(); }}><span className="tk-row-title">Bo fragen</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn tk-rowbtn-main" onClick={() => { set({ topMenu: false }); void end(); }}><span className="tk-row-title">Training beenden</span></button></li>
          </ul>
          <div className="tk-links"><ConfirmLink label="Training verwerfen" question="Training samt erledigter Sätze wirklich verwerfen?" onConfirm={() => { set({ topMenu: false }); void discard(); }} /></div>
        </Sheet>
      )}
      {ui.studioOpen && (
        <StudioSheet value={w.studio} known={known} onClose={() => set({ studioOpen: false })}
          onChange={(n, created) => { act((x) => setStudio(x, n ?? '', { history, catalog, studios, overrides })); if (n && created) void rememberStudio(port, n, now()).catch(() => setNotice(NOT_SAVED)); }}
          onRename={(from, to) => { void renameStudio(port, from, to, now()).then(() => act((x) => setStudio(x, to))).catch(() => setNotice(NOT_SAVED)); }} />
      )}
      {ui.ask && ui.ask.question === 'open-sets' && (
        <Sheet title={ui.ask.open === 1 ? 'Ein Satz ist noch offen' : `${ui.ask.open} Sätze sind noch offen`} onClose={() => set({ ask: null })}
          actions={<>
            <button type="button" onClick={() => void end('omit')}>Offene Sätze nicht eintragen</button>
            <button type="button" className="secondary" onClick={() => void end('complete')}>Trotzdem als gemacht eintragen</button>
            <button type="button" className="link" onClick={() => set({ ask: null })}>Zurück</button>
          </>}>
          <p>Was soll mit {ui.ask.open === 1 ? 'ihm' : 'ihnen'} passieren?</p>
        </Sheet>
      )}
      {ui.ask && ui.ask.question === 'nothing-confirmed' && (
        <Sheet title="Du hast noch nichts erledigt" onClose={() => set({ ask: null })}
          actions={<>
            <button type="button" onClick={() => set({ ask: null })}>Weiter trainieren</button>
            <button type="button" className="secondary" onClick={() => void end('complete')}>Alle Sätze als erledigt markieren</button>
          </>}>
          <p>Noch kein Satz ist als erledigt markiert. Was soll mit dem Training passieren?</p>
          <div className="tk-links"><ConfirmLink label="Training verwerfen" question="Training wirklich verwerfen?" onConfirm={() => void end('discard')} /></div>
        </Sheet>
      )}
      {picker && (
        <ExercisePicker port={port} now={now} newId={newId} onClose={() => set({ picker: null })}
          like={picker.mode === 'swap' ? w.exercises.find((x) => x.rid === picker.ex) : undefined}
          onPick={(ex: Exercise) => {
            const p = picker; set({ picker: null });
            act((x) => (p.mode === 'swap' ? swapExercise(x, p.ex, ex, history, studios) : addExercise(x, ex, history, studios)));
          }} />
      )}
    </div>
  );
}
