import { repRangeOf } from '../../../shared/muscle-targets';
import { resolveExercise } from '../../exercise-identity';
import { plateLine } from '../../steps';
import { addSet, editSet, lastValues, presetOf, removeSet, unconfirmSet } from '../../session';
import { EFFORT_LABEL } from '../EffortQuestion';
import { SetHead, SetRow } from '../SetRow';
import { lastTimeLine, setLabels, setTargetHint } from '../setGrid';
import { Sheet } from '../kit';
import type { ActiveWorkoutApi } from './useActiveWorkout';

/** The set table of one exercise in a sheet: every set to fill in, tick or remove. The same SetRow as everywhere. */
export function SetsSheet({ a, rid }: { a: ActiveWorkoutApi; rid: string }) {
  const { w, store, act, set, catalog, studios, studioHere, statsMuscles, history, confirmShown } = a;
  const e = w.exercises.find((x) => x.rid === rid);
  if (!e) return null;
  const timed = !!e.timed;
  const labels = setLabels(e.sets);
  const nextOpen = e.sets.findIndex((x) => x.doneMs === null);
  const firstWork = e.sets.findIndex((x) => x.type !== 'warmup');
  const own = resolveExercise(e, catalog, statsMuscles).exercise;
  const range = repRangeOf({ primaryMuscle: own?.primaryMuscle });
  const plateRid = own?.equipment === 'barbell' ? e.sets.find((x) => x.doneMs === null && x.weightKg !== null && x.weightKg > 0)?.rid : undefined;
  const lastTime = lastTimeLine(lastValues(e.exerciseId, history, catalog, studioHere, studios), timed);
  const confirmedNow = (setRid: string) => store.current().exercises.find((x) => x.rid === e.rid)?.sets.find((x) => x.rid === setRid)?.doneMs != null;
  return (
    <Sheet title={e.title} onClose={() => set({ setsRid: null })}>
      <div className="tk-sets">
        {lastTime && <p className="muted tk-sub">{`Zuletzt ${lastTime}`}</p>}
        {e.sets.length > 0 && <SetHead timed={timed} editing />}
        {e.sets.map((s, si) => (
          <SetRow key={s.rid} index={si} set={s} timed={timed} label={labels[si]} editing preset={presetOf(e.sets, si)} target={si === nextOpen && si === firstWork ? setTargetHint(s, timed, range) : null}
            plates={s.rid === plateRid ? plateLine(s.weightKg as number) : null}
            confirmedNow={() => confirmedNow(s.rid)}
            onEdit={(patch) => act((x) => editSet(x, e.rid, s.rid, patch))}
            onToggle={() => (s.doneMs === null ? confirmShown(e.rid, s.rid) : act((x) => unconfirmSet(x, e.rid, s.rid)))}
            onRemove={() => act((x) => removeSet(x, e.rid, s.rid))} />
        ))}
        <button type="button" className="secondary" onClick={() => { if (a.tapOnce('add')) act((x) => addSet(x, e.rid)); }}>Satz hinzufügen</button>
        {e.effort && e.effort !== 'skip' && <p className="muted tk-sub">Noch möglich: {EFFORT_LABEL[e.effort]}</p>}
      </div>
    </Sheet>
  );
}
