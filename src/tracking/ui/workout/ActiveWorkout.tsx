import type { Exercise } from '../../../shared/exercises';
import { asksEffort } from '../../effort';
import { nextTimeLine } from '../../next-time';
import { extendRest, restRemainingS, setStudio, swapExercise, addExercise, moveExercise, moveExerciseTo, otherStudio, setEffort, type TrackedWorkout } from '../../session';
import { refitPlaces } from '../../placement';
import { ladderHere } from '../../steps';
import { snapDown } from '../../../shared/loads';
import { takeChange, undoChange } from '../../workout-change';
import { rememberStudio, renameStudio } from '../../studios';
import { ExercisePicker } from '../ExercisePicker';
import { ReorderSheet } from '../ReorderSheet';
import { StudioSheet } from '../StudioSheet';
import { WorkoutCoach } from '../WorkoutCoach';
import { EffortQuestion } from '../EffortQuestion';
import { Band, BrushTitle, Card, ConfirmLink, Icon, Kicker, RoundButton, Row, RowList, Sheet, TimerCard } from '../kit';
import { clock } from '../labels';
import { FocusCard } from './FocusCard';
import { doneSentence, effortAsk, focusExercise, isDoneExercise, progressOf, upNext } from './live-view';
import { SetsSheet } from './SetsSheet';
import { sinceLabel } from './markUsed';
import { useNow } from '../hooks';
import { NOT_SAVED, useActiveWorkout, type ActiveWorkoutProps } from './useActiveWorkout';

/** "Läuft seit …": shows minutes only, so it beats once a minute. */
function LiveSince({ startMs, now }: { startMs: number; now: () => number }) {
  const t = useNow(60_000, true, now);
  return <p role="timer" aria-label="Trainingsdauer" className="muted">Läuft seit {sinceLabel(t - startMs)}</p>;
}

/** The rest bar: the only part that re-renders each second, and only during a rest. Gone at zero. */
function RestBar({ w, now, act }: { w: TrackedWorkout; now: () => number; act: (f: (x: TrackedWorkout) => TrackedWorkout) => void }) {
  const t = useNow(1000, !!w.rest, now);
  const remaining = restRemainingS(w, t);
  if (!w.rest || remaining <= 0) return null;
  return (
    <div className="tk-livepause">
      <TimerCard label="Satzpause" more={{ label: '30 s mehr', onClick: () => act((x) => extendRest(x)) }} end={{ label: 'Pause beenden', onClick: () => act((x) => ({ ...x, rest: null })) }}>
        Pause, noch <b>{clock(remaining)}</b>
      </TimerCard>
    </div>
  );
}

export function ActiveWorkout({ onMinimize, ...props }: ActiveWorkoutProps & { /** Verkleinern: the screen goes, the workout keeps running (and saving) in the registry. */ onMinimize: () => void }) {
  const a = useActiveWorkout(props);
  const { port, w, save, ui, set, askCoach, setNotice, catalog, excluded, studios, overrides, history, now, newId, known, act, end, discard } = a;
  const { picker } = ui;
  const focus = focusExercise(w, ui.openRid, a.currentRid);
  const next = upNext(w, focus?.rid ?? null);
  // "Doch anders" asks again about one exercise; its old answer stays until a new one replaces it.
  const reasking = w.exercises.find((e) => e.rid === ui.reask) ?? null;
  const asking = reasking ?? (ui.effortOn ? effortAsk(w, (rid) => asksEffort(w, rid, history, catalog, studios)) : null);
  const thanked = reasking ? undefined : w.exercises.find((e) => e.rid === ui.thanked && e.effort && e.effort !== 'skip');
  const afterAnswer = thanked ? nextTimeLine(w, thanked.rid, { history, catalog, studios, overrides, nowMs: now() }) ?? 'Danke, das merkt sich Bo für das nächste Mal.' : null;
  const progress = progressOf(w, focus?.rid ?? null);
  const done = doneSentence(progress.doneTitles);
  // After a move the weights follow the new place; in another studio than the plan's nothing is recomputed.
  const moved = (to: TrackedWorkout): TrackedWorkout => {
    if (otherStudio(to.planStudio, a.studioHere, studios)) return to;
    const snap = (id: string, kg: number): number => {
      const equipment = catalog.find((c) => c.id === id)?.equipment ?? '';
      return snapDown(kg, ladderHere(id, equipment, history, a.studioHere, overrides, studios.renames).ladder);
    };
    const r = refitPlaces(to, catalog, snap);
    if (r.changed.length > 0) setNotice(`Die Gewichte von ${r.changed.join(' und ')} passen jetzt zur neuen Reihenfolge.`);
    return r.workout;
  };
  return (
    <div className="tk-screen tk-live">
      <div className="tk-livehead">
        <RoundButton icon="verkleinern" name="Verkleinern, Training läuft weiter" onClick={onMinimize} />
        <div className="tk-livehead-mid">
          <BrushTitle level={1}>{w.title}</BrushTitle>
          <LiveSince startMs={w.startMs} now={now} />
        </div>
        <RoundButton icon="mehr" name="Mehr zum Training" onClick={() => set({ topMenu: true })} />
      </div>
      {save === 'unsaved' && (
        <p role="status" className="tk-note">
          Das konnte gerade nicht gespeichert werden. Dein Training bleibt hier offen und wird mit dem nächsten Schritt erneut gespeichert.
          {' '}<button type="button" className="secondary" onClick={() => act((x) => x)}>Jetzt nochmal speichern</button>
        </p>
      )}
      {ui.notice && <p role="note" className="tk-note">{ui.notice}</p>}
      {w.rest && !ui.ask && <RestBar w={w} now={now} act={act} />}
      {progress.total > 0 && (
        <Card label="Dein Training">
          <div className="tk-liveprog">
            <Kicker>Dein Training</Kicker>
            <span className="muted">Übung {progress.index} von {progress.total}</span>
          </div>
          <Band parts={progress.parts} />
          {done && <button type="button" className="link" aria-haspopup="dialog" onClick={() => set({ doneOpen: true })}>{done}<span aria-hidden="true">&nbsp;›</span></button>}
        </Card>
      )}
      <WorkoutCoach port={port} workout={w} catalog={catalog} now={now} newId={newId} openSignal={ui.coachAsk}
        onTake={(id, c) => act((x) => takeChange(x, id, c, history, catalog, studios, now(), excluded).workout)} onUndo={(id) => act((x) => undoChange(x, id).workout)} />
      {asking && (
        <Card soft key={`effort-${asking.rid}`}>
          <EffortQuestion title={asking.title} onAnswer={(ans) => {
            if (reasking) { set({ reask: null }); if (ans !== 'skip') act((x) => setEffort(x, asking.rid, ans)); return; }
            if (ans !== 'skip') set({ thanked: asking.rid });
            act((x) => setEffort(x, asking.rid, ans));
          }}
            onOff={() => { set({ effortOn: false, reask: null }); if (!reasking) act((x) => setEffort(x, asking.rid, 'skip')); }} />
        </Card>
      )}
      {thanked && (
        <Card soft>
          <p className="tk-maintext">{afterAnswer}</p>
          <button type="button" className="link" onClick={() => set({ reask: thanked.rid })}>Doch anders</button>
        </Card>
      )}
      <FocusCard key={focus?.rid ?? 'none'} a={a} />
      {focus && (
        <Card soft>
          {next.length > 0 && <Kicker>Danach</Kicker>}
          {next.length > 0 && (
            <RowList label="Danach">
              {next.map((r) => <Row key={r.rid} title={r.title} value={r.sub} press={a.holdProps(r.rid)} onClick={() => { if (!a.wasHeld()) set({ openRid: r.rid }); }} />)}
            </RowList>
          )}
          <button type="button" className="secondary tk-iconbtn" onClick={() => set({ picker: { mode: 'add' } })}><Icon name="plus" size={18} /><span>Übung hinzufügen</span></button>
        </Card>
      )}
      {ui.setsRid && <SetsSheet a={a} rid={ui.setsRid} />}
      {ui.reorder && (
        <ReorderSheet workout={w} start={ui.reorder}
          onDrop={(rid, to) => act((x) => moved(moveExerciseTo(x, rid, to)))} onStep={(rid, dir) => act((x) => moved(moveExercise(x, rid, dir)))}
          onClose={() => { a.releaseHold(); set({ reorder: null }); }} />
      )}
      <div className="tk-liveend">
        <button type="button" className="secondary" onClick={() => void end()}>Training beenden</button>
      </div>
      {ui.doneOpen && (
        <Sheet size="small" title="Geschafft" onClose={() => set({ doneOpen: false })}>
          <RowList>
            {w.exercises.filter(isDoneExercise).map((e) => <Row key={e.rid} title={e.title} onClick={() => set({ openRid: e.rid, doneOpen: false })} />)}
          </RowList>
        </Sheet>
      )}
      {ui.topMenu && (
        <Sheet size="small" title="Training" onClose={() => set({ topMenu: false })}>
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
            <button type="button" className="primary" onClick={() => void end('omit')}>Offene Sätze nicht eintragen</button>
            <button type="button" className="secondary" onClick={() => void end('complete')}>Trotzdem als gemacht eintragen</button>
            <button type="button" className="link" onClick={() => set({ ask: null })}>Zurück</button>
          </>}>
          <p>Was soll mit {ui.ask.open === 1 ? 'ihm' : 'ihnen'} passieren?</p>
        </Sheet>
      )}
      {ui.ask && ui.ask.question === 'nothing-confirmed' && (
        <Sheet title="Du hast noch nichts erledigt" onClose={() => set({ ask: null })}
          actions={<>
            <button type="button" className="primary" onClick={() => set({ ask: null })}>Weiter trainieren</button>
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
