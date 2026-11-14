import { formatDecimal, type TrackedExercise } from '../../session';
import { followingSameWeight, setWeights } from '../../lighter-rest';
import type { ActiveWorkoutApi } from './useActiveWorkout';

/**
 * One calm line right after a new weight was typed into an open set: offer it for the following open sets that still have the old weight.
 * After "Übernehmen" the line says so and offers "Rückgängig" until the next confirmed set.
 */
export function WeightOffer({ a, e }: { a: ActiveWorkoutApi; e: TrackedExercise }) {
  const { ui, set, act } = a;
  const taken = ui.weightTaken?.rid === e.rid ? ui.weightTaken : null;
  if (taken) {
    return (
      <p className="muted tk-lift-hint">
        {`Die restlichen Sätze sind jetzt auch mit ${formatDecimal(taken.newKg)} kg.`}{' '}
        <button type="button" className="link" onClick={() => { act((x) => setWeights(x, e.rid, taken.prior)); set({ weightTaken: null }); }}>Rückgängig</button>
      </p>
    );
  }
  const offer = ui.weightOffer;
  if (!offer || offer.exRid !== e.rid) return null;
  const edited = e.sets.find((s) => s.rid === offer.setRid);
  if (!edited || edited.doneMs !== null || edited.weightKg !== offer.newKg) return null;
  const key = `${offer.setRid}:${offer.newKg}`;
  if (ui.weightOfferNo.has(key)) return null;
  const following = followingSameWeight(a.w, e.rid, offer.setRid, offer.oldKg);
  if (following.length === 0) return null;
  const take = () => {
    set({ weightTaken: { rid: e.rid, prior: following.map((f) => ({ rid: f.rid, kg: offer.oldKg })), newKg: offer.newKg }, weightOffer: null });
    act((x) => setWeights(x, e.rid, following.map((f) => ({ rid: f.rid, kg: offer.newKg }))));
  };
  return (
    <div className="tk-lift-hint">
      <p className="muted">{`Die restlichen Sätze auch mit ${formatDecimal(offer.newKg)} kg?`}</p>
      <div className="tk-row">
        <button type="button" className="secondary" onClick={take}>Übernehmen</button>
        <button type="button" className="link" onClick={() => set({ weightOfferNo: new Set([...ui.weightOfferNo, key]) })}>Nein danke</button>
      </div>
    </div>
  );
}
