import { formatDecimal, type TrackedExercise } from '../../session';
import { asksEstimate, estimateStep, NOT_ASKED, setEstimate, type EstimateAsk } from '../../estimate';
import { ladderHere } from '../../steps';
import type { ActiveWorkoutApi } from './useActiveWorkout';

/**
 * "Wie war das Gewicht?" for an exercise with Bo's estimated weight: after the last warm-up set, else after the first work set.
 * "Zu leicht" / "Zu schwer" move the following open sets that still hold the estimate (see estimateStep), with "Rückgängig" until
 * the next confirmed set, and ask once more after the next work set. "Passt" and "Überspringen" end it.
 */
export function EstimateQuestion({ a, e, equipment }: { a: ActiveWorkoutApi; e: TrackedExercise; equipment: string }) {
  const { ui, set, act } = a;
  const taken = ui.estimateTaken?.rid === e.rid ? ui.estimateTaken : null;
  if (taken) {
    return (
      <p className="muted tk-lift-hint">
        {`Die restlichen Sätze sind jetzt mit ${formatDecimal(taken.newKg)} kg.`}{' '}
        <button type="button" className="link" onClick={() => { act((x) => setEstimate(x, e.rid, taken.prior)); set({ estimateTaken: null }); }}>Rückgängig</button>
      </p>
    );
  }
  const ask = ui.estimateAsks.get(e.rid) ?? NOT_ASKED;
  if (!asksEstimate(e, ask)) return null;
  const answer = (next: EstimateAsk) => new Map([...ui.estimateAsks, [e.rid, next]]);
  const end = () => set({ estimateAsks: answer({ ...ask, ended: true }) });
  const step = (dir: 'up' | 'down') => {
    const ladder = ladderHere(e.exerciseId, equipment, a.history, a.studioHere, a.overrides, a.studios.renames, a.bars).ladder;
    const { to, prior } = estimateStep(e, dir, ladder);
    const atDone = e.sets.filter((s) => s.type !== 'warmup' && s.doneMs !== null).length;
    set({ estimateAsks: answer({ n: ask.n + 1, atDone, ended: false }), estimateTaken: to.length ? { rid: e.rid, prior, newKg: to[0]!.kg } : null });
    if (to.length) act((x) => setEstimate(x, e.rid, to));
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
