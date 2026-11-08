import { restOf, restChoices } from '../../shared/rest';
import { needsWarmup, warmupRamp, workingWeightOf } from '../../shared/warmup';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GymWorkout } from '../../coach/gym/types';
import type { Exercise } from '../../shared/exercises';
import { readStats, STATS_ID } from '../../shared/stats';
import { excludedIds } from '../../shared/personal';
import { exerciseImages, videoSearchUrl } from '../media';
import { resolveExercise } from '../exercise-identity';
import { dateKey } from '../../shared/day-rating';
import { hasSport, planFor } from '../../shared/week-plan';
import { describeExercise } from '../similar';
import type { LoggedWorkout, TrackedRecord } from '../../shared/records';
import type { TrackingPort } from '../ports';
import {
  addExercise, addSet, addWarmup, confirmSet, extendRest, setRest, editNotes, editSet, lastValues, removeExercise, removeSet, restRemainingS, linkWith, supersetPartners, currentSet, unlinkSuperset, moveExercise, moveExerciseTo, startEmpty, startFromPlan, isExcludedExercise,
  setEffort, setStudio, swapExercise, unconfirmSet, type FinishChoice, type TrackedWorkout,
} from '../session';
import { acquireStore, closeStore, releaseStore } from '../registry';
import { createWorkoutStore } from '../store';
import { ExerciseInfo, StepLine } from './ExerciseInfo';
import { ExercisePicker } from './ExercisePicker';
import { MuscleIcon } from './MuscleIcon';
import { finishedWorkouts, useCatalog, useExcluded, usePortRecords, useStoreView, useTick, useWakeLock, type WorkoutStore } from './hooks';
import { clock, dateLabel } from './labels';
import { NotesField } from './NotesField';
import { EffortQuestion, EFFORT_LABEL, effortQuestionsOn } from './EffortQuestion';
import { asksEffort } from '../effort';
import { WorkoutCoach } from './WorkoutCoach';
import { takenChanges, usedMarks } from '../../shared/changes';
import { takeChange, undoChange } from '../workout-change';
import { SetHead, SetRow } from './SetRow';
import { ReorderSheet, type DragStart } from './ReorderSheet';
import { exerciseHasNoWeight, previousSets, setLabels, setLastHint, setTargetHint } from './setGrid';
import { SyncNote } from './SyncNote';
import { StudioRow, StudioSheet } from './StudioSheet';
import { ChoiceRow, ConfirmLink, Sheet } from './kit';
import { WorkoutSummary, pendingSummary, setPendingSummary } from './WorkoutSummary';
import { defaultStudio, knownStudios, resolveStudio, studioName, studioStateOf } from '../../shared/studio';
import { hideStudio, rememberStudio, removeStudio, renameStudio } from '../studios';
import { repRangeOf } from '../../shared/muscle-targets';
import { loadStepOverrides } from '../../shared/loads';
import { hereKey, ladderHere, plateLine, stepChange, stepHere } from '../steps';

type Picker = { mode: 'add' } | { mode: 'swap'; ex: string } | null;
/** "39 Min", from an hour on "1 Std 5 Min". */
const sinceLabel = (ms: number): string => { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} Std ${m % 60} Min` : `${m} Min`; };
type Ask = { question: 'nothing-confirmed' } | { question: 'open-sets'; open: number } | null;

/** A finished workout uses up the taken changes it lists. A workout thrown away never gets here, so its changes stay taken for the next one. */
async function markUsed(port: TrackingPort, workouts: { id: string; changes?: { id: string }[] }[], nowMs: number): Promise<void> {
  try { for (const r of usedMarks(await port.list('change'), workouts, nowMs)) await port.put(r); } catch { /* the next start marks them */ }
}

function ActiveWorkout({ port, store, history, now, newId, autoEnd, startNotice, onLeave }: {
  port: TrackingPort; store: WorkoutStore; history: LoggedWorkout[]; now: () => number; newId: () => string; autoEnd: boolean; startNotice?: string | null; onLeave: (message: string, finishedId?: string) => void;
}) {
  const { workout: w, save } = useStoreView(store);
  const [picker, setPicker] = useState<Picker>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuMore, setMenuMore] = useState(false);
  const [topMenu, setTopMenu] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [coachAsk, setCoachAsk] = useState(0);
  // Holding an exercise title (about half a second, the finger hardly moving) opens the "Reihenfolge" mode; the same finger then drags.
  const [reorder, setReorder] = useState<DragStart | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; rid: string; id: number } | null>(null);
  const held = useRef(false); // the click that ends a long press must not also open the row
  const stopHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } };
  useEffect(() => stopHold, []);
  const holdProps = (rid: string) => ({
    onPointerDown: (ev: React.PointerEvent) => {
      if (ev.button !== 0 && ev.button !== undefined) return;
      stopHold();
      const h = { x: ev.clientX, y: ev.clientY, rid, id: ev.pointerId, timer: setTimeout(() => {
        const at = hold.current;
        hold.current = null;
        if (!at) return;
        held.current = true;
        setReorder({ rid: at.rid, pointerId: at.id, y: at.y });
      }, 450) };
      hold.current = h;
    },
    onPointerMove: (ev: React.PointerEvent) => {
      const h = hold.current;
      if (!h) return;
      if (Math.hypot(ev.clientX - h.x, ev.clientY - h.y) > 8) stopHold();
      else h.y = ev.clientY;
    },
    onPointerUp: stopHold, onPointerCancel: stopHold, onPointerLeave: stopHold,
    onContextMenu: (ev: React.MouseEvent) => ev.preventDefault(),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState<ReadonlySet<string>>(new Set());
  const [info, setInfo] = useState<ReadonlySet<string>>(new Set());
  const toggleInfo = (rid: string) => setInfo((s) => { const n = new Set(s); if (!n.delete(rid)) n.add(rid); return n; });
  const ending = useRef(false);
  const leaving = useRef(false);
  const remote = usePortRecords(port, 'workout').all;
  const catalog = useCatalog(port);
  const excluded = useExcluded(port);
  const statsRecords = usePortRecords(port, 'stats').records;
  const loadSteps = usePortRecords(port, 'loadstep').records;
  const studioRecords = usePortRecords(port, 'studio').records;
  const studios = useMemo(() => studioStateOf(studioRecords ?? []), [studioRecords]);
  const overrides = useMemo(() => loadStepOverrides(loadSteps ?? [], studios.renames), [loadSteps, studios]);
  const studioHere = hereKey(w, [...history], studios);
  const chooseStep = (exerciseId: string, stepKg: number | null) => {
    void port.list('loadstep').then((stored) => port.put(stepChange(stored, exerciseId, studioHere, stepKg, now()))).catch(() => setNotice('Gerade nicht gespeichert. Versuch es gleich nochmal.'));
  };
  const statsMuscles = useMemo(() => {
    const r = (statsRecords ?? []).find((x) => x.id === STATS_ID && !x.deleted);
    return (r && readStats(r.body)?.muscles) || null;
  }, [statsRecords]);
  const [notice, setNotice] = useState<string | null>(startNotice ?? null);
  const [effortOn, setEffortOn] = useState(effortQuestionsOn);
  const pendingLeave = useRef<string | null>(null);
  const finishedMsg = 'Training gespeichert. Gut gemacht.';
  useWakeLock(true);
  useTick(true); // the rest countdown and the total time
  // Leaving the screen: a clean store is let go, a dirty one keeps retrying in the registry until it is clean.
  useEffect(() => () => releaseStore(port, store), [store, port]);
  const remaining = restRemainingS(w, now());

  // Opening (or continuing) a workout scrolls once to the exercise with the next open set.
  const current = currentSet(w);
  const currentRid = current?.ex ?? null;
  // Only the current exercise is open; tapping another opens it and closes the previous one. The open one follows the next open set.
  const [openRid, setOpenRid] = useState<string | null>(currentRid);
  useEffect(() => { if (currentRid) setOpenRid(currentRid); }, [currentRid]);
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = screenRef.current?.querySelector('[aria-current="step"]');
    if (el && el !== screenRef.current?.querySelector('.tk-ex')) el.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The rest end is armed once per rest (not per tick); skipping or leaving cancels it.
  const restEnd = w.rest ? w.rest.startMs + w.rest.durationS * 1000 : null;
  useEffect(() => { port.restAlarm?.(restEnd !== null && restEnd > now() ? restEnd : null); }, [restEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { port.restAlarm?.(null); }, [port]);

  // Unsaved work on this device always wins. Only a clean store steps aside for what happened elsewhere.
  useEffect(() => {
    if (!remote || leaving.current) return;
    const rec = remote.find((r) => r.id === w.id);
    if (rec && rec.updatedMs <= store.updatedMs()) return; // ours, or older
    const copyNote = () => (remote.some((r) => !r.deleted && (r.body as LoggedWorkout).keptCopyOf === w.id) ? ' Die Fassung mit mehr Sätzen liegt als Kopie im Verlauf.' : '');
    const stepAside = (leave: string, stay: string) => {
      store.flushDrafts(); // a note still being typed counts as unsaved work
      if (store.dirty()) { if (rec) store.reload(rec); setNotice(stay); return; }
      closeStore(port, store);
      onLeave(leave);
    };
    if (!rec) {
      if (!store.everSaved()) return; // never saved yet: the list cannot know it, keep it open and keep retrying
      stepAside(`Dieses Training wurde auf einem anderen Gerät gelöscht. Die Ansicht wurde neu geladen.${copyNote()}`, 'Dieses Training wurde auf einem anderen Gerät gelöscht. Deine Änderungen hier bleiben offen und werden weitergeschrieben.');
    } else if (rec.deleted) {
      stepAside(`Dieses Training wurde auf einem anderen Gerät gelöscht. Die Ansicht wurde neu geladen.${copyNote()}`, 'Dieses Training wurde auf einem anderen Gerät gelöscht. Deine Änderungen hier bleiben offen und werden weitergeschrieben.');
    } else if ((rec.body as LoggedWorkout).endMs !== null) {
      stepAside('Dieses Training wurde auf einem anderen Gerät beendet. Die Ansicht wurde neu geladen.', 'Dieses Training wurde auf einem anderen Gerät beendet. Deine ungespeicherten Änderungen hier bleiben offen und werden weitergeschrieben.');
    } else {
      store.reload(rec);
    }
  }, [remote]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finish that could not be saved at first leaves the screen once a retry succeeds.
  useEffect(() => {
    if (pendingLeave.current && save === 'saved' && w.endMs !== null) { const m = pendingLeave.current; pendingLeave.current = null; void markUsed(port, [w], now()); closeStore(port, store); onLeave(m, m === finishedMsg ? w.id : undefined); }
  }, [save, w]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (fn: (x: TrackedWorkout) => TrackedWorkout) => void store.apply(fn);

  async function end(choice?: FinishChoice) {
    if (ending.current) return;
    ending.current = true; leaving.current = true;
    try {
      store.flushDrafts(); // a note still being typed is part of what gets finished
      const r = await store.finish(choice);
      if (r.status === 'ask') { leaving.current = false; setAsk(r); return; }
      setAsk(null);
      const msg = r.status === 'discard' ? 'Das Training wurde verworfen.' : finishedMsg;
      if (!r.saved) {
        if (r.status === 'finished') pendingLeave.current = msg; // stays here, calmly, until a retry works
        else leaving.current = false;
        return;
      }
      if (r.status === 'finished') await markUsed(port, [w], now());
      closeStore(port, store);
      onLeave(msg, r.status === 'finished' ? w.id : undefined);
    } finally { ending.current = false; }
  }
  useEffect(() => { if (autoEnd) void end(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Throw the workout away on purpose, after the confirm: the same one-shot delete as "Verwerfen" on the open card.
  async function discard() {
    if (ending.current) return;
    ending.current = true; leaving.current = true;
    try {
      store.flushDrafts();
      if (!(await store.remove())) { leaving.current = false; setNotice('Gerade nicht gespeichert. Das Training bleibt offen, versuch es gleich nochmal.'); return; }
      closeStore(port, store);
      onLeave('Das Training wurde verworfen.');
    } finally { ending.current = false; }
  }

  const known = knownStudios([...history, w], studios.renames, studios.picks, studios.hidden);
  const toggleNote = (rid: string) => setNotesOpen((s) => { const n = new Set(s); if (!n.delete(rid)) n.add(rid); return n; });

  return (
    <div className="tk-screen tk-live" ref={screenRef}>
      <div className="tk-live-head">
        <h1 className="tk-title">{w.title}</h1>
        <button type="button" className="link tk-more" aria-label="Mehr zum Training" onClick={() => setTopMenu(true)}>⋯</button>
      </div>
      {save === 'unsaved' && (
        <p role="status" className="tk-note">
          Gerade nicht gespeichert. Dein Training bleibt hier offen und wird mit dem nächsten Schritt erneut gespeichert.
          {' '}<button type="button" className="secondary" onClick={() => act((x) => x)}>Jetzt nochmal speichern</button>
        </p>
      )}
      {notice && <p role="note" className="tk-note">{notice}</p>}
      <WorkoutCoach port={port} workout={w} catalog={catalog} now={now} newId={newId} openSignal={coachAsk}
        onTake={(id, c) => act((x) => takeChange(x, id, c, history, catalog, studios, now(), excluded).workout)} onUndo={(id) => act((x) => undoChange(x, id).workout)} />
      {w.exercises.map((e) => {
        const partners = supersetPartners(w, e.rid);
        const labels = setLabels(e.sets);
        const nextOpen = e.sets.findIndex((x) => x.doneMs === null);
        const firstWork = e.sets.findIndex((x) => x.type !== 'warmup');
        const before = previousSets(e.sets, lastValues(e.exerciseId, history, catalog, studioHere, studios));
        const timed = !!e.timed;
        const description = describeExercise(e, catalog);
        const resolved = resolveExercise(e, catalog, statsMuscles);
        const own = resolved.exercise;
        const equipment = own?.equipment ?? 'other';
        const range = repRangeOf({ primaryMuscle: own?.primaryMuscle });
        const plateRid = equipment === 'barbell' ? e.sets.find((x) => x.doneMs === null && x.weightKg !== null && x.weightKg > 0)?.rid : undefined;
        const icon = <MuscleIcon group={resolved.group} />;
        const showInfo = info.has(e.rid);
        const allDone = e.sets.length > 0 && e.sets.every((st) => st.doneMs !== null);
        const isCurrent = e.rid === currentRid;
        const isOpen = openRid === e.rid;
        const counted = e.sets.filter((x) => x.type !== 'warmup');
        const doneCount = counted.filter((x) => x.doneMs !== null).length;
        const mates = e.supersetId !== null ? w.exercises.filter((x) => x.supersetId === e.supersetId && x.rid !== e.rid).map((x) => x.title) : [];
        const superset = mates.length > 0 ? `mit ${mates.join(', ')}` : e.supersetId !== null ? 'Supersatz' : null;
        const value = [superset, counted.length > 0 ? `${doneCount} von ${counted.length}${allDone ? ' ✓' : ''}` : null].filter(Boolean).join(' · ');
        const warmupOffered = needsWarmup(w, e.rid, catalog) && warmupRamp({ workingKg: workingWeightOf(e), equipment, type: own?.type, ladder: ladderHere(e.exerciseId, equipment, history, studioHere, overrides, studios.renames).ladder }).length > 0;
        const note = notesOpen.has(e.rid) || e.notes !== '';
        const item = (label: string, onClick: () => void, opts: { aria?: string; disabled?: boolean; expanded?: boolean } = {}) => (
          <li className="tk-rowitem"><button type="button" className="tk-rowbtn" aria-label={opts.aria} aria-expanded={opts.expanded} disabled={opts.disabled} onClick={onClick}><span className="tk-row-title">{label}</span></button></li>
        );
        return (
          <section key={e.rid} className={`tk-ex${allDone ? ' tk-ex-done' : ''}${isCurrent ? ' tk-ex-current' : ''}${isOpen ? ' tk-ex-open' : ''}`} aria-label={e.title}
            aria-current={isCurrent ? 'step' : undefined}>
            <div className="tk-ex-head">
              <h2>
                <button type="button" className="tk-rowbtn tk-hold" aria-expanded={isOpen} {...holdProps(e.rid)}
                  onClick={() => { if (held.current) { held.current = false; return; } setOpenRid(isOpen ? null : e.rid); }}>
                  <span className="tk-ex-icon">{icon}</span>
                  <span className="tk-row-title">{e.title}</span>
                  {value && <span className="tk-row-value muted">{value}</span>}
                  <span className={`tk-chevron${isOpen ? ' open' : ''}`} aria-hidden="true">›</span>
                </button>
              </h2>
              <button type="button" className="link tk-more" aria-label={`Mehr zu ${e.title}`} aria-expanded={menu === e.rid} onClick={() => { if (menu !== e.rid) setOpenRid(e.rid); setMenuMore(false); setMenu(menu === e.rid ? null : e.rid); }}>⋯</button>
            </div>
            {menu === e.rid && (
              <Sheet size="small" title={e.title} onClose={() => { setMenu(null); setMenuMore(false); }}>
              {!menuMore ? (
                <ul className="tk-rows tk-menu" aria-label={`Menü ${e.title}`}>
                  {item('Satz hinzufügen', () => { setMenu(null); act((x) => addSet(x, e.rid)); }, { aria: `Satz hinzufügen ${e.title}` })}
                  {!note && item('Notiz', () => { setMenu(null); toggleNote(e.rid); }, { aria: `Notiz hinzufügen ${e.title}` })}
                  {item('Tauschen', () => { setMenu(null); setPicker({ mode: 'swap', ex: e.rid }); }, { aria: `${e.title} tauschen` })}
                  <li className="tk-rowitem"><ChoiceRow label="Pause ändern" value={restOf(e, catalog)} onChange={(n) => act((x) => setRest(x, e.rid, n))}
                    options={[...new Set([...restChoices(), restOf(e, catalog)])].sort((a, b) => a - b).map((n) => ({ value: n, label: `${n} s` }))} /></li>
                  <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => setMenuMore(true)}><span className="tk-row-title">Mehr</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>
                </ul>
              ) : (
                <>
                <ul className="tk-rows tk-menu" aria-label={`Mehr zu ${e.title}`}>
                  {warmupOffered && item('Aufwärmen hinzufügen', () => { setMenu(null); setMenuMore(false); act((x) => addWarmup(x, e.rid, ladderHere(e.exerciseId, equipment, history, studioHere, overrides, studios.renames).ladder, catalog)); }, { aria: `Aufwärmen hinzufügen ${e.title}` })}
                  {item(editing === e.rid ? 'Sätze fertig bearbeiten' : 'Sätze bearbeiten', () => { setMenu(null); setMenuMore(false); setEditing(editing === e.rid ? null : e.rid); }, { aria: `Sätze bearbeiten ${e.title}` })}
                  {partners.length > 0 && <li className="tk-rowitem"><ChoiceRow label="Supersatz mit" value="" onChange={(p) => { if (p) { setMenu(null); setMenuMore(false); act((x) => linkWith(x, e.rid, p)); } }}
                    options={[{ value: '', label: '…' }, ...partners.map((p) => ({ value: p.rid, label: p.title }))]} /></li>}
                  {e.supersetId !== null && item('Aus Superset lösen', () => { setMenu(null); setMenuMore(false); act((x) => unlinkSuperset(x, e.rid)); }, { aria: `${e.title} aus dem Superset lösen` })}
                  {item('Nach oben', () => act((x) => moveExercise(x, e.rid, -1)), { aria: `${e.title} nach oben`, disabled: moveExercise(w, e.rid, -1) === w })}
                  {item('Nach unten', () => act((x) => moveExercise(x, e.rid, 1)), { aria: `${e.title} nach unten`, disabled: moveExercise(w, e.rid, 1) === w })}
                  {item('Ausführung', () => { setMenu(null); setMenuMore(false); toggleInfo(e.rid); }, { aria: `Ausführung ${e.title}`, expanded: showInfo })}
                </ul>
                <div className="tk-links"><ConfirmLink label="Entfernen" question={store.current().exercises.find((x) => x.rid === e.rid)?.sets.some((s) => s.doneMs !== null) ? 'Die erledigten Sätze dieser Übung gehen dabei weg. Wirklich entfernen?' : 'Übung wirklich entfernen?'}
                  onConfirm={() => { setMenu(null); setMenuMore(false); act((x) => removeExercise(x, e.rid)); }} /></div>
                </>
              )}
              </Sheet>
            )}
            {isOpen && (
              <div className="tk-ex-body">
                {showInfo && (
                  <ExerciseInfo title={e.title} description={description} icon={icon}
                    images={own ? exerciseImages(own.id) : []} video={videoSearchUrl({ title: e.title, hevyTitle: own?.hevyTitle })}>
                    <StepLine title={e.title} step={stepHere(e.exerciseId, equipment, history, studioHere, overrides, studios.renames)} onChoose={(kg) => chooseStep(e.exerciseId, kg)} />
                    <button type="button" className="ghost tk-info-close" aria-label="Ausführung ausblenden" onClick={() => toggleInfo(e.rid)}>Ausblenden</button>
                  </ExerciseInfo>
                )}
                {exerciseHasNoWeight(e) && <p className="muted tk-sub">Gewicht nach Gefühl</p>}
                {e.sets.length > 0 && <SetHead timed={timed} editing={editing === e.rid} />}
                {e.sets.map((s, si) => (
                  <SetRow key={s.rid} index={si} set={s} timed={timed} label={labels[si]} editing={editing === e.rid} hint={si === nextOpen ? setLastHint(before[si] ?? null, timed) : null} target={si === nextOpen && si === firstWork ? setTargetHint(s, timed, range) : null}
                    plates={s.rid === plateRid ? plateLine(s.weightKg as number) : null}
                    confirmedNow={() => store.current().exercises.find((x) => x.rid === e.rid)?.sets.find((x) => x.rid === s.rid)?.doneMs != null}
                    onEdit={(patch) => act((x) => editSet(x, e.rid, s.rid, patch))}
                    onToggle={() => act((x) => (s.doneMs === null ? confirmSet(x, e.rid, s.rid, now(), catalog) : unconfirmSet(x, e.rid, s.rid)))}
                    onRemove={() => act((x) => removeSet(x, e.rid, s.rid))} />
                ))}
                {effortOn && asksEffort(w, e.rid, history, catalog, studios) && (
                  <EffortQuestion title={e.title} onAnswer={(a) => act((x) => setEffort(x, e.rid, a))}
                    onOff={() => { setEffortOn(false); act((x) => setEffort(x, e.rid, 'skip')); }} />
                )}
                {e.effort && e.effort !== 'skip' && <><p className="muted tk-sub">Noch möglich: {EFFORT_LABEL[e.effort]}</p><p className="muted tk-sub">Danke – das fließt in den nächsten Vorschlag ein.</p></>}
                {note && <NotesField store={store} label={`Notiz zu ${e.title}`} value={e.notes} onCommit={(text) => act((x) => editNotes(x, e.rid, text))} />}
              </div>
            )}
          </section>
        );
      })}
      {reorder && (
        <ReorderSheet workout={w} start={reorder}
          onDrop={(rid, to) => act((x) => moveExerciseTo(x, rid, to))} onStep={(rid, dir) => act((x) => moveExercise(x, rid, dir))}
          onClose={() => { held.current = false; setReorder(null); }} />
      )}
      <div className="tk-end">
        <button type="button" className="secondary" onClick={() => setPicker({ mode: 'add' })}>Übung hinzufügen</button>
        <button type="button" className="link" onClick={() => void end()}>Training beenden</button>
      </div>
      {w.rest && remaining > 0 && !ask && (
        <div role="timer" aria-label="Satzpause" className="tk-rest">
          <button type="button" className="tk-rest-main" aria-label="Pause überspringen" onClick={() => act((x) => ({ ...x, rest: null }))}>Pause {clock(remaining)}</button>
          <button type="button" className="tk-skip" onClick={() => act((x) => extendRest(x))}>+30 s</button>
        </div>
      )}
      {topMenu && (
        <Sheet size="small" title="Training" onClose={() => setTopMenu(false)}>
          <p role="timer" aria-label="Trainingsdauer" className="muted tk-elapsed">Läuft seit {sinceLabel(now() - w.startMs)}</p>
          <ul className="tk-rows">
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { setTopMenu(false); setStudioOpen(true); }}><span className="tk-row-title">Studio wechseln</span><span className="tk-row-value muted">{w.studio ?? '–'}</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { setTopMenu(false); setCoachAsk((n) => n + 1); }}><span className="tk-row-title">Coach fragen</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { setTopMenu(false); void end(); }}><span className="tk-row-title">Training beenden</span></button></li>
          </ul>
          <div className="tk-links"><ConfirmLink label="Training verwerfen" question="Training samt erledigter Sätze wirklich verwerfen?" onConfirm={() => { setTopMenu(false); void discard(); }} /></div>
        </Sheet>
      )}
      {studioOpen && (
        <StudioSheet value={w.studio} known={known} onClose={() => setStudioOpen(false)}
          onChange={(n, created) => { act((x) => setStudio(x, n ?? '', { history, catalog, studios, overrides })); if (n && created) void rememberStudio(port, n, now()).catch(() => setNotice('Gerade nicht gespeichert. Versuch es gleich nochmal.')); }}
          onRename={(from, to) => { void renameStudio(port, from, to, now()).then(() => act((x) => setStudio(x, to))).catch(() => setNotice('Gerade nicht gespeichert. Versuch es gleich nochmal.')); }} />
      )}
      {ask && ask.question === 'open-sets' && (
        <Sheet title={ask.open === 1 ? 'Ein Satz offen' : `${ask.open} Sätze offen`} onClose={() => setAsk(null)}
          actions={<>
            <button type="button" onClick={() => void end('omit')}>Weglassen</button>
            <button type="button" className="secondary" onClick={() => void end('complete')}>Als erledigt zählen</button>
            <button type="button" className="link" onClick={() => setAsk(null)}>Zurück</button>
          </>}>
          <p>Was soll mit {ask.open === 1 ? 'ihm' : 'ihnen'} passieren?</p>
        </Sheet>
      )}
      {ask && ask.question === 'nothing-confirmed' && (
        <Sheet title="Noch nichts erledigt" onClose={() => setAsk(null)}
          actions={<>
            <button type="button" onClick={() => setAsk(null)}>Weiter trainieren</button>
            <button type="button" className="secondary" onClick={() => void end('complete')}>Alle Sätze als erledigt markieren</button>
          </>}>
          <p>Noch kein Satz ist als erledigt markiert. Was soll mit dem Training passieren?</p>
          <div className="tk-links"><ConfirmLink label="Training verwerfen" question="Training wirklich verwerfen?" onConfirm={() => void end('discard')} /></div>
        </Sheet>
      )}
      {picker && (
        <ExercisePicker port={port} now={now} newId={newId} onClose={() => setPicker(null)}
          like={picker.mode === 'swap' ? w.exercises.find((x) => x.rid === picker.ex) : undefined}
          onPick={(ex: Exercise) => {
            const p = picker; setPicker(null);
            act((x) => (p.mode === 'swap' ? swapExercise(x, p.ex, ex, history, studios) : addExercise(x, ex, history, studios)));
          }} />
      )}
    </div>
  );
}

/** One exercise of the plan in a line: "Bankdrücken · 3 × 8 · 60 kg". Warm-ups are not counted. */
export function planLine(e: GymWorkout['exercises'][number]): string {
  const work = e.sets.filter((s) => s.type !== 'warmup');
  const reps = [...new Set(work.map((s) => (s.repRange ? `${s.repRange.start}–${s.repRange.end}` : s.reps)).filter((r) => r != null))];
  const kg = [...new Set(work.map((s) => s.weightKg).filter((w): w is number => w != null && w > 0))];
  const parts = [e.title];
  if (work.length > 0) parts.push(reps.length === 1 ? `${work.length} × ${reps[0]}` : `${work.length} Sätze`);
  if (kg.length === 1) parts.push(`${String(kg[0]).replace('.', ',')} kg`);
  return parts.join(' · ');
}

function OpenCard({ rec, primary, onResume, onEnd, onDiscard }: { rec: TrackedRecord; primary: boolean; onResume: () => void; onEnd: () => void; onDiscard: () => Promise<void> }) {
  const w = rec.body as LoggedWorkout;
  const [asking, setAsking] = useState(false);
  const sfx = primary ? '' : ` ${w.title} ${dateLabel(w.startMs)}`;
  return (
    <section className="card tk-open" aria-label={`${w.title} läuft noch`}>
      <h2>{w.title} läuft noch</h2>
      <p className="muted">Gestartet {dateLabel(w.startMs)} · alles gespeichert</p>
      <button type="button" onClick={onResume}>{`Weitermachen${sfx}`}</button>
      <div className="tk-links">
        <button type="button" className="link" aria-label={`Training beenden${sfx}`} onClick={onEnd}>Beenden</button>
      </div>
      <div className="tk-links tk-apart">
        <button type="button" className="danger-link" aria-label={`Training verwerfen${sfx}`} onClick={() => setAsking(true)}>Verwerfen</button>
      </div>
      {asking && (
        <p className="tk-note">Verwerfen löscht dieses Training samt erledigter Sätze. Wirklich verwerfen?{' '}
          <button type="button" className="danger-link" onClick={() => void onDiscard().then(() => setAsking(false))}>Ja, verwerfen</button>{' '}
          <button type="button" className="link" onClick={() => setAsking(false)}>Behalten</button>
        </p>
      )}
    </section>
  );
}

export function WorkoutScreen({ port, plan = null, routine = null, resume = false, onActive, now = Date.now, newId = () => crypto.randomUUID() }: {
  port: TrackingPort; plan?: GymWorkout | null; routine?: GymWorkout | null;
  /** Open the newest open workout at once (from "Weitermachen" on Heute), once. */
  resume?: boolean;
  /** Told whether a workout is running on this screen, so the page around it can drop its own navigation. */
  onActive?: (active: boolean) => void;
  now?: () => number; newId?: () => string;
}) {
  const workoutsQ = usePortRecords(port, 'workout');
  const routinesQ = usePortRecords(port, 'routine');
  const workouts = workoutsQ.records;
  const catalog = useCatalog(port);
  const excluded = useExcluded(port);
  const [store, setStore] = useState<{ s: WorkoutStore; autoEnd: boolean; notice?: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [summaryId, setSummaryId] = useState<string | null>(pendingSummary);
  const statsQ = usePortRecords(port, 'stats').records;
  const starting = useRef(false);
  const started = useRef<GymWorkout | null>(null);
  const history = finishedWorkouts(workouts);
  const openRecs = (workouts ?? []).filter((r) => (r.body as LoggedWorkout).endMs === null).sort((a, b) => (b.body as LoggedWorkout).startMs - (a.body as LoggedWorkout).startMs);

  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [studioOpen, setStudioOpen] = useState(false);
  const [others, setOthers] = useState(false);
  const resumed = useRef(false);
  const running = store !== null;
  useEffect(() => { onActive?.(running); return () => onActive?.(false); }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!resume || resumed.current || store || !workouts || openRecs.length === 0) return;
    resumed.current = true;
    setStore({ s: acquireStore(port, openRecs[0]!, now), autoEnd: false });
  }, [resume, workouts]); // eslint-disable-line react-hooks/exhaustive-deps
  const logged = (workouts ?? []).filter((r) => !r.deleted).map((r) => r.body as LoggedWorkout);
  const studioRecords = usePortRecords(port, 'studio').records;
  const studios = useMemo(() => studioStateOf(studioRecords ?? []), [studioRecords]);
  const studio = chosen ?? defaultStudio(logged, studios.renames, studios.picks);
  const summary = summaryId ? logged.find((x) => x.id === summaryId && x.endMs !== null) ?? null : null;
  const nextSteps = useMemo(() => {
    const r = (statsQ ?? []).find((x) => x.id === STATS_ID && !x.deleted);
    return (r && readStats(r.body)?.next) || [];
  }, [statsQ]);
  const saveFailed = () => setMessage('Gerade nicht gespeichert. Versuch es gleich nochmal.');
  // A studio with workouts is hidden (they keep it), one without is removed. Another known studio takes its place.
  const awayStudio = (name: string, used: boolean) => {
    const gone = resolveStudio(name, studios.renames).toLowerCase();
    const other = knownStudios(logged, studios.renames, studios.picks, studios.hidden).find((n) => n.toLowerCase() !== gone);
    setChosen(other);
    void (used ? hideStudio(port, name, now()) : removeStudio(port, name, now()))
      .then(() => (other ? rememberStudio(port, other, now() + 1) : undefined)).catch(saveFailed);
  };

  async function begin(w: TrackedWorkout, startNotice: string | null = null): Promise<boolean> {
    if (starting.current) return false; // a double tap makes one workout
    starting.current = true;
    try {
      const s = acquireStore(port, studio ? { ...w, studio } : w, now);
      await s.apply((x) => x); // saved (or flagged) before the screen shows it
      setMessage(null); setPendingSummary(null); setSummaryId(null);
      setStore({ s, autoEnd: false, notice: startNotice });
      return true;
    } finally { starting.current = false; }
  }
  // The changes taken for the next workout go in when it starts and are listed in the workout; each is marked used only when the
  // workout is finished (a thrown-away one leaves them taken). A listing workout stops a change from applying twice, and a
  // finished one whose mark got lost is made up here.
  // The start notice (ops that no longer fit) is for the rider's screen only; it is not workout data.
  const startPlan = async (g: GymWorkout) => {
    let changeRecs: TrackedRecord[] = [], all: LoggedWorkout[] = [], overrides = loadStepOverrides([], studios.renames), excludedNow: ReadonlySet<string> = new Set();
    try { excludedNow = excludedIds(await port.list('rule'), catalog); } catch { /* start without them */ }
    try { overrides = loadStepOverrides(await port.list('loadstep'), studios.renames); changeRecs = await port.list('change'); all = (await port.list('workout')).filter((r) => !r.deleted).map((r) => r.body as LoggedWorkout); } catch { /* start without them: they stay taken for the next time */ }
    let noLegs = false;
    try { const day = planFor(await port.list('weekplan'), dateKey(now())); noLegs = !!day && day.legs === false && hasSport(day, 'gym'); } catch { /* start with the plan as it is */ }
    let skipped: string[] = [];
    const w = startFromPlan(g, history, now(), newId(), catalog, studio, studios, { changes: takenChanges(changeRecs), workouts: all, overrides, excluded: excludedNow, noLegs, onSkipped: (l) => { skipped = l; } });
    if (!(await begin(w, skipped.length ? skipped.join(' ') : null))) return;
    await markUsed(port, all.filter((x) => x.endMs !== null), now());
  };

  useEffect(() => {
    if (routine && workouts && openRecs.length === 0 && !store && started.current !== routine) { started.current = routine; void startPlan(routine); }
  }, [routine, workouts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (store) return <ActiveWorkout port={port} store={store.s} history={history} now={now} newId={newId} autoEnd={store.autoEnd} startNotice={store.notice} onLeave={(m, finishedId) => { setStore(null); if (finishedId) { setPendingSummary(finishedId); setSummaryId(finishedId); setMessage(null); } else setMessage(m); }} />;
  if (workoutsQ.failed) {
    return (
      <div className="tk-screen">
        <p role="status" className="tk-note">Deine Trainings konnten gerade nicht gelesen werden. Es ist nichts verloren, versuch es gleich nochmal.</p>
        <button type="button" onClick={workoutsQ.retry}>Nochmal versuchen</button>
      </div>
    );
  }
  if (workouts === null) return <div className="tk-screen"><p className="muted">Einen Moment …</p></div>;

  if (resume && !resumed.current && openRecs.length > 0) return <div className="tk-screen"><p className="muted">Einen Moment …</p></div>; // opening it at once, no card in between
  if (openRecs.length > 0) {
    return (
      <div className="tk-screen">
        {message && <p role="status" className="tk-note">{message}</p>}
        {openRecs.map((rec, i) => (
          <OpenCard key={rec.id} rec={rec} primary={i === 0}
            onResume={() => setStore({ s: acquireStore(port, rec, now), autoEnd: false })}
            onEnd={() => setStore({ s: acquireStore(port, rec, now), autoEnd: true })}
            onDiscard={async () => {
              // One-shot: a throwaway store, disposed at once, so a failed delete is never retried.
              const once = createWorkoutStore(port, rec, now);
              const ok = await once.remove().finally(() => once.dispose());
              if (!ok) setMessage('Gerade nicht gespeichert. Das Training bleibt offen, versuch es gleich nochmal.');
            }} />
        ))}
      </div>
    );
  }

  const routines = routinesQ.records ?? [];
  const studioKnown = knownStudios(logged, studios.renames, studios.picks, studios.hidden);
  const manyStudios = studioKnown.length > 1;
  return (
    <div className="tk-screen">
      {message && <p role="status" className="tk-note">{message}</p>}
      {summary && <WorkoutSummary workout={summary} next={nextSteps} onDone={() => { setPendingSummary(null); setSummaryId(null); }} />}
      <SyncNote port={port} />
      {!summary && (
        <>
          <h1 className="tk-title">Training starten</h1>
          {plan ? (
            <section className="card tk-plan-preview" aria-label="Heutiger Plan">
              <h2>{plan.name}</h2>
              <p className="muted tk-clamp">{plan.exercises.filter((e) => !isExcludedExercise(e, catalog, excluded)).map((e) => e.title).join(', ')}</p>
              {manyStudios && <button type="button" className="link tk-studio-line" onClick={() => setStudioOpen(true)}>{studio ?? 'Studio wählen'} ›</button>}
              <button type="button" aria-label={`${plan.name} starten`} onClick={() => void startPlan(plan)}>Training starten</button>
            </section>
          ) : (
            <button type="button" onClick={() => void begin(startEmpty(now(), newId()))}>Leeres Training starten</button>
          )}
          <div className="tk-rows">
            {!(plan && manyStudios) && <StudioRow value={studio} onOpen={() => setStudioOpen(true)} />}
            {(plan || routines.length > 0) && (
              <button type="button" className="tk-rowbtn tk-choice" onClick={() => setOthers(true)}>
                <span className="tk-row-title">Anderes Training</span><span className="tk-chevron" aria-hidden="true">›</span>
              </button>
            )}
          </div>
        </>
      )}
      {studioOpen && (
        <StudioSheet value={studio} known={studioKnown} onClose={() => setStudioOpen(false)}
          onAway={studio ? { used: logged.some((x) => x.studio && resolveStudio(x.studio, studios.renames).toLowerCase() === resolveStudio(studio, studios.renames).toLowerCase()), run: awayStudio } : undefined}
          onChange={(n) => { setChosen(n); if (n) void rememberStudio(port, n, now()).catch(saveFailed); }}
          onRename={(from, to) => { setChosen(to); void renameStudio(port, from, to, now()).catch(saveFailed); }} />
      )}
      {others && (
        <Sheet size="small" title="Anderes Training" onClose={() => setOthers(false)}>
          <ul className="tk-rows">
            {routines.map((r) => {
              const body = r.body as GymWorkout;
              return <li key={r.id} className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { setOthers(false); void startPlan(body); }}><span className="tk-row-title">{body.name} starten</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>;
            })}
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => { setOthers(false); void begin(startEmpty(now(), newId())); }}><span className="tk-row-title">Leeres Training starten</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>
          </ul>
        </Sheet>
      )}
    </div>
  );
}
