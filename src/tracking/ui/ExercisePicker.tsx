import { useMemo, useState } from 'react';
import { descriptionOf } from '../../shared/exercise-descriptions';
import type { Exercise } from '../../shared/exercises';
import { muscleGroupOf } from '../../shared/muscle-targets';
import { exerciseImages, videoSearchUrl } from '../media';
import type { TrackingPort } from '../ports';
import { ChoiceRow, ExpandMark, RowList, Sheet } from './kit';
import { ExerciseGroups } from './ExerciseGroups';
import { ExerciseInfo } from './ExerciseInfo';
import { MuscleIcon } from './MuscleIcon';
import { matchesSearch, similarExercises } from '../similar';
import { finishedWorkouts, useCatalog, useExcluded, usePortRecords } from './hooks';
import { EQUIPMENT, MUSCLES, TYPES } from './labels';

/** `like` is the exercise being swapped; similar ones then come first. */
export function ExercisePicker({ port, onPick, onClose, like, title = 'Übung wählen', now = Date.now, newId = () => crypto.randomUUID() }: {
  port: TrackingPort; onPick: (e: Exercise) => void; onClose: () => void; like?: { title: string; exerciseId: string }; title?: string;
  now?: () => number; newId?: () => string;
}) {
  const catalog = useCatalog(port);
  const workouts = usePortRecords(port, 'workout').records;
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', muscle: '', equipment: '', type: 'weight_reps' });
  const [error, setError] = useState(false);
  const excluded = useExcluded(port);
  const done = useMemo(() => new Set(finishedWorkouts(workouts).flatMap((w) => w.exercises.map((x) => x.exerciseId))), [workouts]);

  const needle = q.trim().toLowerCase();
  const hit = useMemo(() => catalog.filter((e) => matchesSearch(e, needle)), [catalog, needle]);
  const found = useMemo(() => [...hit].sort((a, b) => a.title.localeCompare(b.title, 'de')), [hit]);
  // The last exercises from finished workouts, newest first.
  const recent = useMemo(() => {
    const byId = new Map(catalog.map((e) => [e.id, e] as [string, Exercise]));
    const ids = new Set<string>();
    for (const w of finishedWorkouts(workouts)) for (const x of w.exercises) ids.add(x.exerciseId);
    return [...ids].map((id) => byId.get(id)).filter((e): e is Exercise => !!e && !excluded.has(e.id)).slice(0, 6);
  }, [catalog, workouts, excluded]);
  const similar = useMemo(() => (like && !needle ? similarExercises(like, catalog, done, excluded).slice(0, 8) : []), [like, catalog, needle, done, excluded]);

  const choose = (e: Exercise) => onPick(e);
  const valid = draft.name.trim() !== '' && draft.muscle !== '' && draft.equipment !== '' && draft.type !== '';
  async function save() {
    const ex: Exercise = { id: newId(), title: draft.name.trim(), type: draft.type, primaryMuscle: draft.muscle, equipment: draft.equipment };
    try {
      await port.put({ kind: 'exercise', id: ex.id, updatedMs: now(), deleted: false, body: ex });
      onPick(ex);
    } catch { setError(true); }
  }

  // One tap on the row chooses it; the mark at its end opens the how-to in place.
  const item = (e: Exercise) => {
    const icon = <MuscleIcon group={muscleGroupOf(e)} />;
    return (
      <li key={e.id} className="tk-rowitem">
        <div className="tk-pick-row">
          <button type="button" className="tk-rowbtn" onClick={() => choose(e)}>
            <span className="tk-row-title">{e.title}</span>
          </button>
          <button type="button" className="link tk-info-toggle" aria-label={`Anleitung ${e.title}`} aria-expanded={info === e.id}
            onClick={() => setInfo(info === e.id ? null : e.id)}><ExpandMark open={info === e.id} /></button>
        </div>
        {info === e.id && (
          <div className="tk-row-more"><ExerciseInfo title={e.title} description={descriptionOf(e)} images={exerciseImages(e.id)} video={videoSearchUrl(e)} icon={icon} /></div>
        )}
      </li>
    );
  };
  const options = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

  if (creating) {
    return (
      <Sheet title="Eigene Übung" onClose={() => setCreating(false)}
        actions={<>
          <button type="submit" form="tk-own-exercise" disabled={!valid}>Übung speichern</button>
          <button type="button" className="link" onClick={() => setCreating(false)}>Abbrechen</button>
        </>}>
        <form id="tk-own-exercise" className="tk-form" onSubmit={(e) => { e.preventDefault(); if (valid) void save(); }}>
          <label className="tk-field">Name<input value={draft.name} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <ChoiceRow label="Muskelgruppe" placeholder="Wählen" value={draft.muscle} options={options(MUSCLES)} onChange={(muscle) => setDraft({ ...draft, muscle })} />
          <ChoiceRow label="Gerät" placeholder="Wählen" value={draft.equipment} options={options(EQUIPMENT)} onChange={(equipment) => setDraft({ ...draft, equipment })} />
          <ChoiceRow label="Zählt nach" placeholder="Wählen" value={draft.type} options={options(TYPES)} onChange={(type) => setDraft({ ...draft, type })} />
          {!valid && <p className="muted">Es fehlt noch: {[draft.name.trim() === '' && 'Name', draft.muscle === '' && 'Muskelgruppe', draft.equipment === '' && 'Gerät'].filter(Boolean).join(', ')}.</p>}
          {error && <p role="status" className="tk-note">Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.</p>}
        </form>
      </Sheet>
    );
  }

  const own = <button type="button" className="secondary" onClick={() => setCreating(true)}>Eigene Übung anlegen</button>;
  return (
    <Sheet title={title} onClose={onClose}>
      <input className="tk-search" aria-label="Suchen" placeholder="Übung oder Muskel suchen" value={q} onChange={(e) => setQ(e.target.value)} />
      {needle ? (
        found.length > 0 ? <RowList label="Gefunden">{found.map(item)}</RowList> : <p className="muted">Nichts gefunden.</p>
      ) : (
        <>
          {similar.length > 0 && (
            <section aria-label="Ähnliche Übungen">
              <h3 className="tk-section">Ähnlich wie {like!.title}</h3>
              <RowList>{similar.map(item)}</RowList>
            </section>
          )}
          {recent.length > 0 && (
            <section aria-label="Zuletzt benutzt">
              <h3 className="tk-section">Zuletzt benutzt</h3>
              <RowList>{recent.map(item)}</RowList>
            </section>
          )}
          <h3 className="tk-section">Muskelgruppen</h3>
          <ExerciseGroups exercises={found} used={done} searching={false} item={item} />
        </>
      )}
      {own}
    </Sheet>
  );
}
