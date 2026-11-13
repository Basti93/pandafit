import { snapDown } from '../../../shared/loads';
import { formatDecimal, type TrackedExercise } from '../../session';
import { lighterRest, setWeights } from '../../lighter-rest';
import { ladderHere } from '../../steps';
import type { ActiveWorkoutApi } from './useActiveWorkout';

/**
 * One calm line under "Satz geschafft": after a set below the planned weight, offer the same lighter weight for the open sets.
 * After "Übernehmen" the line says so and offers "Rückgängig" until the next confirmed set.
 */
export function LighterRest({ a, e, equipment }: { a: ActiveWorkoutApi; e: TrackedExercise; equipment: string }) {
  const { w, ui, set, act, history, studioHere, overrides, studios } = a;
  const ladder = () => ladderHere(e.exerciseId, equipment, history, studioHere, overrides, studios.renames).ladder;
  const undo = ui.lighterUndo?.rid === e.rid ? ui.lighterUndo : null;
  if (undo) {
    return (
      <p className="muted tk-lift-hint">
        Die restlichen Sätze sind jetzt leichter.{' '}
        <button type="button" className="link" onClick={() => { act((x) => setWeights(x, e.rid, undo.prior)); set({ lighterUndo: null }); }}>Rückgängig</button>
      </p>
    );
  }
  if (ui.lighterNo.has(e.rid)) return null;
  const proposal = lighterRest(w, e.rid, (kg) => snapDown(kg, ladder()));
  if (!proposal) return null;
  const take = () => {
    const prior = proposal.sets.map((p) => ({ rid: p.rid, kg: e.sets.find((s) => s.rid === p.rid)!.weightKg as number }));
    set({ lighterUndo: { rid: e.rid, prior } });
    act((x) => setWeights(x, e.rid, proposal.sets));
  };
  return (
    <div className="tk-lift-hint">
      <p className="muted">{proposal.kg !== null ? `Die restlichen Sätze auch mit ${formatDecimal(proposal.kg)} kg?` : 'Die restlichen Sätze im selben Verhältnis leichter machen?'}</p>
      <div className="tk-row">
        <button type="button" className="secondary" onClick={take}>Übernehmen</button>
        <button type="button" className="link" onClick={() => set({ lighterNo: new Set([...ui.lighterNo, e.rid]) })}>Nein danke</button>
      </div>
    </div>
  );
}
