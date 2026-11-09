import { useState } from 'react';
import { repRangeOf } from '../../../shared/muscle-targets';
import { exerciseImages, videoSearchUrl } from '../../media';
import { resolveExercise } from '../../exercise-identity';
import { describeExercise } from '../../similar';
import { plateLine, stepHere } from '../../steps';
import { addSet, editNotes, editSet, filled, formatDecimal, lastValues, presetOf, type TrackedExercise } from '../../session';
import { ExerciseInfo, StepLine } from '../ExerciseInfo';
import { MuscleIcon } from '../MuscleIcon';
import { NotesField } from '../NotesField';
import { NumField } from '../SetRow';
import { exerciseHasNoWeight, lastTimeLine, setTargetHint } from '../setGrid';
import { BrushTitle, Card, Icon, Kicker, MarkDot, RoundButton, Sheet } from '../kit';
import { ExerciseMenu } from './ExerciseMenu';
import { focusExercise, focusSet, markName, setMarks } from './live-view';
import type { ActiveWorkoutApi } from './useActiveWorkout';

/** The focus of the running workout: the next set of the focus exercise, large, with "Satz geschafft". Below it the sets as circles, Anleitung and the menu. */
export function FocusCard({ a }: { a: ActiveWorkoutApi }) {
  const { w, ui, set, act, store, catalog, studios, overrides, studioHere, statsMuscles, history, chooseStep } = a;
  const e = focusExercise(w, ui.openRid, a.currentRid);
  if (!e) {
    return (
      <Card>
        <p className="tk-maintext">Noch keine Übung im Training.</p>
        <button type="button" className="primary" onClick={() => set({ picker: { mode: 'add' } })}>Übung hinzufügen</button>
      </Card>
    );
  }
  const focus = focusSet(e);
  const timed = !!e.timed;
  const resolved = resolveExercise(e, catalog, statsMuscles);
  const own = resolved.exercise;
  const equipment = own?.equipment ?? 'other';
  const icon = <MuscleIcon group={resolved.group} />;
  const lastTime = lastTimeLine(lastValues(e.exerciseId, history, catalog, studioHere, studios), timed);
  const mates = e.supersetId !== null ? w.exercises.filter((x) => x.supersetId === e.supersetId && x.rid !== e.rid).map((x) => x.title) : [];
  const note = ui.notesOpen.has(e.rid) || e.notes !== '';
  return (
    <Card focus label={e.title}>
      <Kicker>{focus ? focus.kicker : 'Alle Sätze geschafft'}</Kicker>
      <BrushTitle>{e.title}</BrushTitle>
      {focus ? (
        <>
          {lastTime && <p className="tk-maintext">{`Letztes Mal hast du ${lastTime} geschafft.`}</p>}
          {mates.length > 0 && <p className="tk-maintext">{`Im Wechsel mit ${mates.join(' und ')}.`}</p>}
          {exerciseHasNoWeight(e) && <p className="tk-maintext">Das Gewicht wählst du nach Gefühl.</p>}
          <FocusSet key={e.sets[focus.index]!.rid} a={a} e={e} index={focus.index} barbell={equipment === 'barbell'} range={repRangeOf({ primaryMuscle: own?.primaryMuscle })} />
        </>
      ) : (
        <>
          <p className="tk-maintext">{a.currentRid === null
            ? 'Du kannst einen Satz anhängen, eine Übung hinzufügen oder das Training beenden.'
            : 'Du kannst einen Satz anhängen oder zur nächsten Übung gehen.'}</p>
          <button type="button" className="secondary" onClick={() => { if (a.tapOnce('add')) act((x) => addSet(x, e.rid)); }}>Satz hinzufügen</button>
        </>
      )}
      <div className="tk-lift-row">
        <div className="tk-lift-marks">
          {setMarks(e).map((m) => <MarkDot key={m.rid} state={m.state} short={m.short} name={markName(m)} onClick={() => set({ setsRid: e.rid })} />)}
        </div>
        <div className="tk-lift-tools">
          <RoundButton icon="info" name="Anleitung" onClick={() => set({ infoRid: e.rid })} />
          <RoundButton icon="mehr" name={`Mehr zu ${e.title}`} onClick={() => set({ menu: e.rid, menuMore: false })} />
        </div>
      </div>
      {note && <NotesField key={e.rid} store={store} label={`Notiz zu ${e.title}`} value={e.notes} onCommit={(text) => act((x) => editNotes(x, e.rid, text))} />}
      {ui.infoRid === e.rid && (
        <Sheet title={e.title} lead={icon} onClose={() => set({ infoRid: null })}>
          <ExerciseInfo title={e.title} description={describeExercise(e, catalog)} icon={icon}
            images={own ? exerciseImages(own.id) : []} video={videoSearchUrl({ title: e.title, hevyTitle: own?.hevyTitle })}>
            <StepLine title={e.title} step={stepHere(e.exerciseId, equipment, history, studioHere, overrides, studios.renames)} onChoose={(kg) => chooseStep(e.exerciseId, kg)} />
          </ExerciseInfo>
        </Sheet>
      )}
      {ui.menu === e.rid && <ExerciseMenu a={a} e={e} />}
    </Card>
  );
}

/**
 * The shown set: its values as two large fields (the same names as in the set table) and "Satz geschafft".
 * Keyed by the set: a draft and an unreadable entry belong to this one set; the next set starts fresh.
 */
function FocusSet({ a, e, index, barbell, range }: { a: ActiveWorkoutApi; e: TrackedExercise; index: number; barbell: boolean; range?: { min: number; max: number } }) {
  const { act, tapOnce, confirmShown } = a;
  const s = e.sets[index]!;
  const n = index + 1;
  const timed = !!e.timed;
  const [bad, setBad] = useState({ w: false, r: false });
  const shown = filled(s, presetOf(e.sets, index)); // an empty field shows what "Satz geschafft" would put in it
  const firstWork = e.sets.findIndex((x) => x.type !== 'warmup');
  const target = index === firstWork ? setTargetHint(s, timed, range) : null;
  const kg = s.weightKg ?? shown.weightKg ?? null;
  const plates = barbell && !timed && kg !== null && kg > 0 ? plateLine(kg) : null;
  const edit = (patch: Parameters<typeof editSet>[3]) => act((x) => editSet(x, e.rid, s.rid, patch));
  // Exactly this set (see confirmShown); a double tap never reaches the set that takes its place.
  const confirm = () => { if (tapOnce('confirm')) confirmShown(e.rid, s.rid); };
  return (
    <>
      <div className="tk-lift-fields">
        {!timed && <NumField big={{ unit: 'Kilogramm' }} label={`Gewicht Satz ${n}`} value={s.weightKg} placeholder={shown.weightKg != null ? formatDecimal(shown.weightKg) : '–'}
          onValidity={(w) => setBad((b) => ({ ...b, w }))} onCommit={(weightKg) => edit({ weightKg })} />}
        {timed
          ? <NumField big={{ unit: 'Sekunden' }} label={`Sekunden Satz ${n}`} value={s.durationS} placeholder={shown.durationS != null ? String(shown.durationS) : '–'} integer
            onValidity={(r) => setBad((b) => ({ ...b, r }))} onCommit={(durationS) => edit({ durationS })} />
          : <NumField big={{ unit: 'Wiederholungen' }} label={`Wiederholungen Satz ${n}`} value={s.reps} placeholder={shown.reps != null ? String(shown.reps) : '–'} integer
            onValidity={(r) => setBad((b) => ({ ...b, r }))} onCommit={(reps) => edit({ reps })} />}
      </div>
      {target && <p className="muted tk-lift-hint">{target}</p>}
      {plates && <p className="muted tk-lift-hint">{plates}</p>}
      <button type="button" className="primary tk-iconbtn" disabled={bad.w || bad.r} onClick={confirm}><Icon name="haken" size={20} /><span>Satz geschafft</span></button>
    </>
  );
}
