import { formatDecimal, setEstimateAsk, type TrackedExercise } from '../../session';
import { answered, asksEstimate, estimateStep, NOT_ASKED, setEstimate } from '../../estimate';
import { ladderHere } from '../../steps';
import type { ActiveWorkoutApi } from './useActiveWorkout';

/**
 * "Wie war das Gewicht?" for an exercise with Bo's estimated weight: after the last warm-up set, else after the first work set.
 * "Zu leicht" / "Zu schwer" move the following open sets that still hold the estimate (see estimateStep), with "Rückgängig" until
 * the next confirmed set, and ask once more after the next work set. "Passt" and "Überspringen" end it. The answers stay on the
 * exercise in the workout (see asksEstimate).
 */
export function EstimateQuestion({ a, e, equipment }: { a: ActiveWorkoutApi; e: TrackedExercise; equipment: string }) {
  const { ui, set, act } = a;
  const taken = ui.estimateTaken?.rid === e.rid ? ui.estimateTaken : null;
  if (taken) {
    if (taken.newKg === null) return <p className="muted tk-lift-hint">Leichter geht es an diesem Gerät nicht.</p>;
    const undo = () => {
      act((x) => setEstimateAsk(setEstimate(x, e.rid, taken.prior), e.rid, taken.ask ?? NOT_ASKED));
      set({ estimateTaken: null });
    };
    return (
      <p className="muted tk-lift-hint">
        {`Die nächsten Sätze machst du mit ${formatDecimal(taken.newKg)} kg.`}{' '}
        <button type="button" className="link" onClick={undo}>Rückgängig</button>
      </p>
    );
  }
  if (!asksEstimate(e)) return null;
  const end = () => act((x) => setEstimateAsk(x, e.rid, answered(e, 'end')));
  const step = (dir: 'up' | 'down') => {
    const ladder = ladderHere(e.exerciseId, equipment, a.history, a.studioHere, a.overrides, a.studios.renames, a.bars).ladder;
    const { to, prior } = estimateStep(e, dir, ladder);
    set({ estimateTaken: { rid: e.rid, prior, newKg: to.length ? to[0]!.kg : null, ask: e.estimateAsk } });
    act((x) => setEstimateAsk(setEstimate(x, e.rid, to), e.rid, answered(e, 'step')));
  };
  return (
    <div className="tk-lift-hint">
      <p className="muted">Wie war das Gewicht?</p>
      <div className="tk-row">
        <button type="button" className="secondary" onClick={() => step('up')}>Zu leicht</button>
        <button type="button" className="secondary" onClick={end}>Passt</button>
        <button type="button" className="secondary" onClick={() => step('down')}>Zu schwer</button>
        <button type="button" className="link" onClick={end}>Überspringen</button>
      </div>
    </div>
  );
}
