import { useMemo, useState } from 'react';
import { descriptionOf } from '../../shared/exercise-descriptions';
import type { Exercise } from '../../shared/exercises';
import { familyLabel, familyOf } from '../../shared/families';
import { excludeRuleRecord, moveRule, rulesExcluding } from '../../shared/personal';
import { exerciseImages, videoSearchUrl } from '../media';
import type { TrackingPort } from '../ports';
import { matchesSearch } from '../similar';
import { ExerciseInfo } from './ExerciseInfo';
import { finishedWorkouts, useCatalog, useExcluded, usePortRecords } from './hooks';
import { ExerciseGroups } from './ExerciseGroups';
import { ExerciseProposals } from './ExerciseProposals';
import { Row, RowList, Sheet } from './kit';

/**
 * All exercises of the catalog to browse: search, then about eight groups as an accordion (one open, no counts), one row
 * per exercise. A tap opens its description; from there the person rules it out (one or the whole family) or allows it again.
 */
export function CatalogScreen({ port, now = Date.now, newId = () => crypto.randomUUID() }: { port: TrackingPort; now?: () => number; newId?: () => string }) {
  const catalog = useCatalog(port);
  const excluded = useExcluded(port);
  const rules = usePortRecords(port, 'rule').all;
  const [q, setQ] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [asking, setAsking] = useState<Exercise | null>(null);
  const [error, setError] = useState(false);
  const needle = q.trim().toLowerCase();

  const hits = useMemo(() => catalog.filter((e) => matchesSearch(e, needle)), [catalog, needle]);
  const workouts = usePortRecords(port, 'workout').records;
  const used = useMemo(() => new Set(finishedWorkouts(workouts).flatMap((w) => w.exercises.map((x) => x.exerciseId))), [workouts]);

  const attempt = async (f: () => Promise<unknown>) => {
    try { await f(); setError(false); } catch { setError(true); }
  };
  const exclude = (e: Exercise, wholeFamily?: string) => attempt(() => port.put(excludeRuleRecord(e, wholeFamily, newId(), now())));
  /** Pauses the person's own rules that cover the exercise. Rules from the chat are left to the rules card. */
  const allow = (e: Exercise) => attempt(async () => {
    const live = await port.list('rule');
    for (const r of rulesExcluding(live, e).filter((x) => x.source !== 'chat')) {
      const cur = live.find((x) => x.id === r.id);
      const next = cur ? moveRule(cur, 'paused', now()) : null;
      if (next) await port.put(next);
    }
  });

  const details = (e: Exercise) => {
    const fam = familyOf(e);
    const isOut = excluded.has(e.id);
    const covering = isOut ? rulesExcluding(rules ?? [], e) : [];
    const own = covering.filter((r) => r.source !== 'chat');
    const fromChat = covering.filter((r) => r.source === 'chat');
    return (
      <ExerciseInfo title={e.title} description={descriptionOf(e)} images={exerciseImages(e.id)} video={videoSearchUrl(e)}>
        {fam !== 'other' && <p className="muted tk-family">Gleiche Übungsart: {familyLabel(fam)}</p>}
        {isOut ? (
          <>
            <p className="muted">Der Coach schlägt sie nicht mehr vor. Du kannst das unter Woche &gt; Regeln zurücknehmen.</p>
            {fromChat.length > 0 && <p className="muted tk-note">Ausgeschlossen durch die Regel „{fromChat[0].text}“. Du findest sie unter Woche.</p>}
            {own.length > 0 && <div className="tk-cat-actions"><button type="button" className="secondary" onClick={() => void allow(e)}>Wieder erlauben</button></div>}
          </>
        ) : (
          <div className="tk-cat-actions">
            <button type="button" className="link" onClick={() => (fam === 'other' ? void exclude(e) : setAsking(e))}>Nicht mehr vorschlagen{fam !== 'other' && ' ›'}</button>
          </div>
        )}
      </ExerciseInfo>
    );
  };

  const askFam = asking ? familyOf(asking) : 'other';
  return (
    <div className="tk-screen">
      <h2 className="tk-section">Anleitungen nachschlagen</h2>
      {/* Unknown exercises wait here to be sorted in (not on the training screen); nothing shows when none wait. */}
      <ExerciseProposals port={port} now={now} newId={newId} />
      <input className="tk-search" aria-label="Übung suchen" placeholder="Übung oder Muskel suchen" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p role="alert" className="tk-note">Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.</p>}
      {hits.length === 0 && <p className="muted">Nichts gefunden.</p>}
      <ExerciseGroups exercises={hits} used={used} searching={needle !== ''} item={(e) => (
        <Row key={e.id} title={e.title} value={excluded.has(e.id) ? 'ausgeschlossen' : undefined} expanded={info === e.id} onClick={() => setInfo(info === e.id ? null : e.id)}>
          {details(e)}
        </Row>
      )} />
      {asking && (
        <Sheet size="small" title="Nicht mehr vorschlagen" onClose={() => setAsking(null)}>
          <RowList>
            <Row title="Nur diese Übung" onClick={() => { const e = asking; setAsking(null); void exclude(e); }} />
            <Row title={`Alle Varianten (${familyLabel(askFam)})`} onClick={() => { const e = asking; setAsking(null); void exclude(e, askFam); }} />
          </RowList>
        </Sheet>
      )}
    </div>
  );
}
