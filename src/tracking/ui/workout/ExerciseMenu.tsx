import { restOf, restChoices } from '../../../shared/rest';
import { needsWarmup, warmupRamp, workingWeightOf } from '../../../shared/warmup';
import { resolveExercise } from '../../exercise-identity';
import { ladderHere } from '../../steps';
import { addWarmup, linkWith, removeExercise, setRest, supersetPartners, unlinkSuperset, type TrackedExercise } from '../../session';
import { ChoiceRow, ConfirmLink, Sheet } from '../kit';
import type { ActiveWorkoutApi } from './useActiveWorkout';

/** The menu of one exercise ("Menü …"): one flat list of actions, "Entfernen" below it. Adding a set is the "+" on the focus card. */
export function ExerciseMenu({ a, e }: { a: ActiveWorkoutApi; e: TrackedExercise }) {
  const { w, store, act, set, toggleNote, catalog, studios, overrides, studioHere, statsMuscles, history } = a;
  const { notesOpen } = a.ui;
  const partners = supersetPartners(w, e.rid);
  const own = resolveExercise(e, catalog, statsMuscles).exercise;
  const equipment = own?.equipment ?? 'other';
  const ladder = () => ladderHere(e.exerciseId, equipment, history, studioHere, overrides, studios.renames).ladder;
  const warmupOffered = needsWarmup(w, e.rid, catalog) && warmupRamp({ workingKg: workingWeightOf(e), equipment, type: own?.type, ladder: ladder() }).length > 0;
  const note = notesOpen.has(e.rid) || e.notes !== '';
  const close = { menu: null };
  const item = (label: string, onClick: () => void, opts: { aria?: string; disabled?: boolean; expanded?: boolean } = {}) => (
    <li className="tk-rowitem"><button type="button" className="tk-rowbtn" aria-label={opts.aria} aria-expanded={opts.expanded} disabled={opts.disabled} onClick={onClick}><span className="tk-row-title">{label}</span></button></li>
  );
  return (
    <Sheet size="small" title={e.title} onClose={() => set(close)}>
      <ul className="tk-rows tk-menu" aria-label={`Menü ${e.title}`}>
        {!note && item('Notiz', () => { set({ menu: null, openRid: e.rid }); toggleNote(e.rid); }, { aria: `Notiz hinzufügen ${e.title}` })}
        {item('Tauschen', () => { set({ menu: null, picker: { mode: 'swap', ex: e.rid } }); }, { aria: `${e.title} tauschen` })}
        <li className="tk-rowitem"><ChoiceRow label="Pause ändern" value={restOf(e, catalog)} onChange={(n) => act((x) => setRest(x, e.rid, n))}
          options={[...new Set([...restChoices(), restOf(e, catalog)])].sort((p, q) => p - q).map((n) => ({ value: n, label: `${n} s` }))} /></li>
        {warmupOffered && item('Aufwärmen hinzufügen', () => { set(close); act((x) => addWarmup(x, e.rid, ladder(), catalog)); }, { aria: `Aufwärmen hinzufügen ${e.title}` })}
        {partners.length > 0 && <li className="tk-rowitem"><ChoiceRow label="Supersatz mit" value="" onChange={(p) => { if (p) { set(close); act((x) => linkWith(x, e.rid, p)); } }}
          placeholder="wählen" options={[{ value: '', label: 'wählen' }, ...partners.map((p) => ({ value: p.rid, label: p.title }))]} /></li>}
        {e.supersetId !== null && item('Aus Superset lösen', () => { set(close); act((x) => unlinkSuperset(x, e.rid)); }, { aria: `${e.title} aus dem Superset lösen` })}
        {w.exercises.length > 1 && item('Reihenfolge ändern', () => { set({ ...close, reorder: { rid: e.rid, pointerId: -1, y: 0 } }); }, { aria: `Reihenfolge ändern ${e.title}` })}
      </ul>
      <div className="tk-links"><ConfirmLink label="Entfernen" question={store.current().exercises.find((x) => x.rid === e.rid)?.sets.some((s) => s.doneMs !== null) ? 'Die erledigten Sätze dieser Übung gehen dabei weg. Wirklich entfernen?' : 'Übung wirklich entfernen?'}
        onConfirm={() => { set(close); act((x) => removeExercise(x, e.rid)); }} /></div>
    </Sheet>
  );
}
