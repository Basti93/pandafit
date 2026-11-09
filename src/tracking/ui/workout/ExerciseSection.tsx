import { restOf, restChoices } from '../../../shared/rest';
import { needsWarmup, warmupRamp, workingWeightOf } from '../../../shared/warmup';
import { exerciseImages, videoSearchUrl } from '../../media';
import { resolveExercise } from '../../exercise-identity';
import { describeExercise } from '../../similar';
import { repRangeOf } from '../../../shared/muscle-targets';
import { ladderHere, plateLine, stepHere } from '../../steps';
import { asksEffort } from '../../effort';
import { addSet, addWarmup, confirmSet, editNotes, editSet, lastValues, removeExercise, removeSet, linkWith, supersetPartners, unlinkSuperset, setEffort, presetOf, setRest, unconfirmSet } from '../../session';
import { ExerciseInfo, StepLine } from '../ExerciseInfo';
import { MuscleIcon } from '../MuscleIcon';
import { NotesField } from '../NotesField';
import { EffortQuestion, EFFORT_LABEL } from '../EffortQuestion';
import { SetHead, SetRow } from '../SetRow';
import { exerciseHasNoWeight, lastTimeLine, setLabels, setTargetHint } from '../setGrid';
import { ChoiceRow, ConfirmLink, ExpandMark, Sheet } from '../kit';
import type { ActiveWorkoutApi } from './useActiveWorkout';

/** One exercise of the running workout: its header, its menu sheet and, when open, its sets. */
export function ExerciseSection({ e, a }: { e: ActiveWorkoutApi['w']['exercises'][number]; a: ActiveWorkoutApi }) {
  const { w, store, act, set, toggleNote, toggleInfo, holdProps, held, catalog, studios, overrides, studioHere, statsMuscles, history, now, chooseStep, currentRid } = a;
  const { menu, menuMore, editing, notesOpen, info, openRid, effortOn } = a.ui;
  const partners = supersetPartners(w, e.rid);
  const labels = setLabels(e.sets);
  const nextOpen = e.sets.findIndex((x) => x.doneMs === null);
  const firstWork = e.sets.findIndex((x) => x.type !== 'warmup');
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
  const supersetNote = e.supersetId !== null ? (mates.length > 0 ? `Supersatz mit ${mates.join(', ')}` : 'Supersatz') : null;
  const value = counted.length > 0 ? `${doneCount} von ${counted.length}${allDone ? ' ✓' : ''}` : '';
  const lastTime = lastTimeLine(lastValues(e.exerciseId, history, catalog, studioHere, studios), timed);
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
            onClick={() => { if (held.current) { held.current = false; return; } set({ openRid: isOpen ? null : e.rid }); }}>
            <span className="tk-ex-icon">{icon}</span>
            <span className="tk-row-title">{e.title}{(value || supersetNote) && <small className="tk-ex-sub muted">{[value, supersetNote].filter(Boolean).join(' · ')}</small>}</span>
            <ExpandMark open={isOpen} />
          </button>
        </h2>
        <button type="button" className="link tk-info-btn" aria-label={`Anleitung ${e.title}`} aria-expanded={showInfo} onClick={() => { if (!showInfo) set({ openRid: e.rid }); toggleInfo(e.rid); }}><span aria-hidden="true">i</span></button>
        <button type="button" className="link tk-more" aria-label={`Mehr zu ${e.title}`} aria-expanded={menu === e.rid} onClick={() => { set({ ...(menu !== e.rid ? { openRid: e.rid } : {}), menuMore: false, menu: menu === e.rid ? null : e.rid }); }}>⋯</button>
      </div>
      {menu === e.rid && (
        <Sheet size="small" title={e.title} onClose={() => set({ menu: null, menuMore: false })}>
        {!menuMore ? (
          <ul className="tk-rows tk-menu" aria-label={`Menü ${e.title}`}>
            {item('Satz hinzufügen', () => { set({ menu: null }); act((x) => addSet(x, e.rid)); }, { aria: `Satz hinzufügen ${e.title}` })}
            {!note && item('Notiz', () => { set({ menu: null }); toggleNote(e.rid); }, { aria: `Notiz hinzufügen ${e.title}` })}
            {item('Tauschen', () => { set({ menu: null, picker: { mode: 'swap', ex: e.rid } }); }, { aria: `${e.title} tauschen` })}
            <li className="tk-rowitem"><ChoiceRow label="Pause ändern" value={restOf(e, catalog)} onChange={(n) => act((x) => setRest(x, e.rid, n))}
              options={[...new Set([...restChoices(), restOf(e, catalog)])].sort((a, b) => a - b).map((n) => ({ value: n, label: `${n} s` }))} /></li>
            <li className="tk-rowitem"><button type="button" className="tk-rowbtn" onClick={() => set({ menuMore: true })}><span className="tk-row-title">Mehr</span><span className="tk-chevron" aria-hidden="true">›</span></button></li>
          </ul>
        ) : (
          <>
          <ul className="tk-rows tk-menu" aria-label={`Mehr zu ${e.title}`}>
            {warmupOffered && item('Aufwärmen hinzufügen', () => { set({ menu: null, menuMore: false }); act((x) => addWarmup(x, e.rid, ladderHere(e.exerciseId, equipment, history, studioHere, overrides, studios.renames).ladder, catalog)); }, { aria: `Aufwärmen hinzufügen ${e.title}` })}
            {item(editing === e.rid ? 'Sätze fertig bearbeiten' : 'Sätze bearbeiten', () => { set({ menu: null, menuMore: false, editing: editing === e.rid ? null : e.rid }); }, { aria: `Sätze bearbeiten ${e.title}` })}
            {partners.length > 0 && <li className="tk-rowitem"><ChoiceRow label="Supersatz mit" value="" onChange={(p) => { if (p) { set({ menu: null, menuMore: false }); act((x) => linkWith(x, e.rid, p)); } }}
              placeholder="wählen" options={[{ value: '', label: 'wählen' }, ...partners.map((p) => ({ value: p.rid, label: p.title }))]} /></li>}
            {e.supersetId !== null && item('Aus Superset lösen', () => { set({ menu: null, menuMore: false }); act((x) => unlinkSuperset(x, e.rid)); }, { aria: `${e.title} aus dem Superset lösen` })}
            {w.exercises.length > 1 && item('Reihenfolge ändern', () => { set({ menu: null, menuMore: false, reorder: { rid: e.rid, pointerId: -1, y: 0 } }); }, { aria: `Reihenfolge ändern ${e.title}` })}
          </ul>
          <div className="tk-links"><ConfirmLink label="Entfernen" question={store.current().exercises.find((x) => x.rid === e.rid)?.sets.some((s) => s.doneMs !== null) ? 'Die erledigten Sätze dieser Übung gehen dabei weg. Wirklich entfernen?' : 'Übung wirklich entfernen?'}
            onConfirm={() => { set({ menu: null, menuMore: false }); act((x) => removeExercise(x, e.rid)); }} /></div>
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
            </ExerciseInfo>
          )}
          {lastTime && <p className="muted tk-sub">{`Zuletzt ${lastTime}`}</p>}
          {exerciseHasNoWeight(e) && <p className="muted tk-sub">Gewicht nach Gefühl</p>}
          {e.sets.length > 0 && <SetHead timed={timed} editing={editing === e.rid} />}
          {e.sets.map((s, si) => (
            <SetRow key={s.rid} index={si} set={s} timed={timed} label={labels[si]} editing={editing === e.rid} preset={presetOf(e.sets, si)} target={si === nextOpen && si === firstWork ? setTargetHint(s, timed, range) : null}
              plates={s.rid === plateRid ? plateLine(s.weightKg as number) : null}
              confirmedNow={() => store.current().exercises.find((x) => x.rid === e.rid)?.sets.find((x) => x.rid === s.rid)?.doneMs != null}
              onEdit={(patch) => act((x) => editSet(x, e.rid, s.rid, patch))}
              onToggle={() => act((x) => (s.doneMs === null ? confirmSet(x, e.rid, s.rid, now(), catalog) : unconfirmSet(x, e.rid, s.rid)))}
              onRemove={() => act((x) => removeSet(x, e.rid, s.rid))} />
          ))}
          {effortOn && asksEffort(w, e.rid, history, catalog, studios) && (
            <EffortQuestion title={e.title} onAnswer={(a) => act((x) => setEffort(x, e.rid, a))}
              onOff={() => { set({ effortOn: false }); act((x) => setEffort(x, e.rid, 'skip')); }} />
          )}
          {e.effort && e.effort !== 'skip' && <><p className="muted tk-sub">Noch möglich: {EFFORT_LABEL[e.effort]}</p><p className="muted tk-sub">Danke! Das fließt in den nächsten Vorschlag ein.</p></>}
          {note && <NotesField store={store} label={`Notiz zu ${e.title}`} value={e.notes} onCommit={(text) => act((x) => editNotes(x, e.rid, text))} />}
        </div>
      )}
    </section>
  );
}
