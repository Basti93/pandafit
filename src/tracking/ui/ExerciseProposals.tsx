import { useMemo, useState } from 'react';
import { mergeCatalog } from '../../shared/catalog';
import { EXERCISES, type Exercise } from '../../shared/exercises';
import type { TrackedRecord } from '../../shared/records';
import { isObj } from '../../shared/exercise-links';
import { changeProposal, confirmProposal, proposalOf, recentLinkOf, rejectProposal, relink, undoLinkAndUnused } from '../exercise-proposals';
import type { TrackingPort } from '../ports';
import { ExercisePicker } from './ExercisePicker';
import { loadFedb } from '../fedb-lazy';
import { usePortRecords, useFedb } from './hooks';
import { equipmentSuffix, muscleLabel } from './labels';

/** What the coach sorted for the person: proposals to confirm or change, and recent links to change or take back. Nothing when there is nothing. */
export function ExerciseProposals({ port, now = Date.now, newId }: { port: TrackingPort; now?: () => number; newId?: () => string }) {
  const { records } = usePortRecords(port, 'exercise');
  const fedb = useFedb();
  const catalog = useMemo(() => mergeCatalog(EXERCISES, fedb ?? [], records ?? []), [records, fedb]);
  const [changing, setChanging] = useState<{ r: TrackedRecord; link: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  const proposals = (records ?? []).flatMap((r) => { const p = proposalOf(r); return p ? [{ r, p }] : []; })
    .filter(({ p }) => p.kind === 'new' || catalog.some((e) => e.id === p.targetId))
    .sort((a, b) => a.p.atMs - b.p.atMs);
  // One card per unknown exercise: when two coaches asked at once, the newest proposal shows and withdrawing it withdraws the others.
  const byTitle = new Map<string, { r: TrackedRecord; p: NonNullable<ReturnType<typeof proposalOf>>; others: TrackedRecord[] }>();
  for (const { r, p } of proposals) { const old = byTitle.get(p.forTitle); byTitle.set(p.forTitle, { r, p, others: old ? [...old.others, old.r] : [] }); }
  const cards = [...byTitle.values()];
  const links = (records ?? []).flatMap((r) => { const l = recentLinkOf(r, now()); return l && catalog.some((e) => e.id === l.targetId) ? [{ r, l }] : []; }).sort((a, b) => b.l.atMs - a.l.atMs);
  if (cards.length === 0 && links.length === 0 && !changing) return null;

  // The stored records and catalog are read again just before writing, so a pick that just created an exercise is known.
  // The record a row stands on, as stored now. Gone or changed in the meantime: nothing is written.
  const current = (stored: TrackedRecord[], r: TrackedRecord): TrackedRecord | null => {
    const cur = stored.find((x) => x.id === r.id);
    return cur && JSON.stringify(proposalOf(cur)) === JSON.stringify(proposalOf(r)) && JSON.stringify(recentLinkOf(cur, now())) === JSON.stringify(recentLinkOf(r, now())) ? cur : null;
  };
  async function write(make: (stored: TrackedRecord[], cat: Exercise[]) => TrackedRecord[] | Promise<TrackedRecord[]>, others: TrackedRecord[] = []) {
    try {
      const stored = await port.list('exercise');
      const cat = mergeCatalog(EXERCISES, await loadFedb(), stored);
      const made = await make(stored, cat);
      const twins = made.length === 0 ? [] : others.flatMap((o) => { const cur = stored.find((x) => x.id === o.id); return cur && proposalOf(cur) ? rejectProposal(cur, now()) : []; });
      for (const rec of [...made, ...twins]) await port.put(rec);
      setFailed(false);
    } catch { setFailed(true); }
  }
  const title = (id: string | undefined) => catalog.find((e) => e.id === id)?.title ?? '';

  return (
    <section className="tk-proposals" aria-label="Übungen einordnen">
      <h3>Übungen einordnen</h3>
      {failed && <p role="status" className="tk-note">Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.</p>}
      <ul className="tk-proposal-list">
        {cards.map(({ r, p, others }) => (
          <li key={r.id}>
            <span>
              {p.kind === 'same'
                ? <>‚{p.forTitle}‘ ist vermutlich {title(p.targetId)}</>
                : <>Neue Übung: {isObj(r.body) && typeof r.body.title === 'string' ? r.body.title : p.forTitle}{isObj(r.body) && typeof r.body.primaryMuscle === 'string' ? `, ${muscleLabel(r.body.primaryMuscle)}` : ''}{isObj(r.body) && typeof r.body.equipment === 'string' && equipmentSuffix(String(r.body.title ?? p.forTitle), r.body.equipment) ? `, ${equipmentSuffix(String(r.body.title ?? p.forTitle), r.body.equipment)}` : ''}</>}
            </span>
            <span className="tk-proposal-actions">
              <button type="button" className="secondary" onClick={() => void write((stored, cat) => { const cur = current(stored, r); return cur ? confirmProposal(cur, cat, now(), stored) : []; }, others)}>Bestätigen</button>
              <button type="button" className="link" onClick={() => setChanging({ r, link: false })}>Ändern</button>
              <button type="button" className="link" onClick={() => void write((stored) => { const cur = current(stored, r); return cur ? rejectProposal(cur, now()) : []; }, others)}>Verwerfen</button>
            </span>
          </li>
        ))}
        {links.map(({ r, l }) => (
          <li key={r.id}>
            <span>‚{l.title}‘ als {title(l.targetId)} eingeordnet</span>
            <span className="tk-proposal-actions">
              <button type="button" className="link" onClick={() => setChanging({ r, link: true })}>Ändern</button>
              <button type="button" className="link" onClick={() => void write(async (stored) => { const cur = current(stored, r); return cur ? undoLinkAndUnused(cur, now(), stored, await port.list('workout')) : []; })}>Rückgängig</button>
            </span>
          </li>
        ))}
      </ul>
      {changing && (
        <ExercisePicker port={port} now={now} newId={newId} like={{ title: (changing.link ? recentLinkOf(changing.r, now())?.title : proposalOf(changing.r)?.forTitle) ?? '', exerciseId: '' }} onClose={() => setChanging(null)}
          onPick={(e) => { const { r, link } = changing; setChanging(null); void write((stored, cat) => { const cur = current(stored, r); return !cur ? [] : link ? relink(cur, e.id, cat, now()) : changeProposal(cur, e.id, cat, now(), stored); }, link ? [] : (cards.find((c) => c.r.id === r.id)?.others ?? [])); }} />
      )}
    </section>
  );
}
