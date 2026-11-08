import { useMemo, useState, useEffect } from 'react';
import { dedupeSessions } from '../../shared/history';
import { monthLabel } from '../../shared/dates';
import type { LoggedWorkout, TrackedRecord } from '../../shared/records';
import type { TrackingPort } from '../ports';
import { editSet, formatDecimal, removeSet, type TrackedSet, type TrackedWorkout } from '../session';
import { acquireStore, releaseStore } from '../registry';
import { usePortRecords, useStoreView, type WorkoutStore } from './hooks';
import { ConfirmLink, Row, RowList } from './kit';
import { dateLabel } from './labels';
import { SetHead, SetRow } from './SetRow';
import { setLabels } from './setGrid';
import { SyncNote } from './SyncNote';
import { nextLine, nextOf as nextFor } from './next-line';
import { readStats, STATS_ID, type NextStep } from '../../shared/stats';

const WEEK_MS = 7 * 24 * 3600 * 1000;
const done = (sets: TrackedSet[]): TrackedSet[] => sets.filter((s) => s.doneMs !== null);
const working = (sets: TrackedSet[]): TrackedSet[] => { const d = done(sets); const w = d.filter((s) => s.type !== 'warmup'); return w.length > 0 ? w : d; };
const best = (sets: TrackedSet[], timed: boolean): TrackedSet | null =>
  working(sets).reduce<TrackedSet | null>((b, s) => {
    const v = (x: TrackedSet) => (timed ? x.durationS : x.weightKg) ?? 0;
    return !b || v(s) > v(b) ? s : b;
  }, null);
const describe = (s: TrackedSet, timed: boolean): string =>
  timed ? `${s.durationS ?? 0} Sek.` : `${s.weightKg !== null ? `${formatDecimal(s.weightKg)} kg` : 'nach Gefühl'}${s.reps !== null ? ` × ${s.reps}` : ''}`;

/** "70 kg × 8, 8, 8, 7": the working sets, same weights joined. */
function setsLine(sets: TrackedSet[], timed: boolean): string {
  const w = working(sets);
  if (w.length === 0) return 'Nichts erledigt';
  if (timed) return w.map((s) => `${s.durationS ?? 0} Sek.`).join(', ');
  const groups: { kg: number | null; reps: string[] }[] = [];
  for (const s of w) {
    const last = groups[groups.length - 1];
    const reps = s.reps !== null ? String(s.reps) : '–';
    if (last && last.kg === s.weightKg) last.reps.push(reps); else groups.push({ kg: s.weightKg, reps: [reps] });
  }
  return groups.map((g) => (g.kg !== null ? `${formatDecimal(g.kg)} kg × ${g.reps.join(', ')}` : `${g.reps.join(', ')} Wdh.`)).join(' · ');
}
const warmups = (sets: TrackedSet[]): number => done(sets).filter((s) => s.type === 'warmup').length > 0 && working(sets).some((s) => s.type !== 'warmup') ? done(sets).filter((s) => s.type === 'warmup').length : 0;

/** "Entwicklung": the last time on top, then date and best working set per workout; a tap shows all sets. */
function Development({ exerciseId, title, history, onBack }: { exerciseId: string; title: string; history: LoggedWorkout[]; onBack: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => history.filter((w) => w.exercises.some((e) => e.exerciseId === exerciseId)).sort((a, b) => (b.endMs ?? b.startMs) - (a.endMs ?? a.startMs)).map((w) => {
    const ex = w.exercises.filter((e) => e.exerciseId === exerciseId);
    const sets = ex.flatMap((e) => e.sets as TrackedSet[]);
    const timed = ex.some((e) => (e as { timed?: boolean }).timed);
    const b = best(sets, timed);
    return b ? { id: w.id, end: w.endMs ?? w.startMs, best: describe(b, timed), all: setsLine(sets, timed), warm: warmups(sets) } : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null), [exerciseId, history]);
  return (
    <div className="tk-screen">
      <button type="button" className="link tk-back" onClick={onBack}>Zurück</button>
      <h1 className="tk-title">{title}</h1>
      {rows.length === 0 ? <p className="muted">Noch keine erledigten Sätze.</p> : (
        <>
          <p>Letztes Mal: {rows[0]!.best}</p>
          <RowList label="Entwicklung">
            {rows.map((r) => (
              <Row key={r.id} title={dateLabel(r.end)} value={r.best} expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <p>{r.all}</p>
                {r.warm > 0 && <p className="muted">{r.warm === 1 ? '1 Aufwärmsatz' : `${r.warm} Aufwärmsätze`}</p>}
              </Row>
            ))}
          </RowList>
        </>
      )}
    </div>
  );
}

function Detail({ port, store, history, onBack, onDeleted, latest, next }: { port: TrackingPort; store: WorkoutStore; history: LoggedWorkout[]; onBack: () => void; onDeleted: () => void; latest: boolean; next: NextStep[] }) {
  const { workout: w, save } = useStoreView(store);
  useEffect(() => () => releaseStore(port, store), [port, store]);
  const [editing, setEditing] = useState(false);
  const [exercise, setExercise] = useState<string | null>(null);
  const act = (fn: (x: TrackedWorkout) => TrackedWorkout) => void store.apply(fn);
  // Only the latest workout has a next step. The coach's steps count for it when they name it (by id or start).
  const mine = latest ? next.filter((n) => n.forWorkoutId === w.id || n.atMs === w.startMs) : [];
  const nextOf = (e: { exerciseId: string; title: string }) => nextFor(mine, e);
  const open = exercise !== null ? w.exercises.find((e) => e.exerciseId === exercise) : undefined;
  if (open) return <Development exerciseId={open.exerciseId} title={open.title} history={history} onBack={() => setExercise(null)} />;
  return (
    <div className="tk-screen">
      <button type="button" className="link tk-back" onClick={onBack}>Zurück</button>
      <h1 className="tk-title">{w.title}</h1>
      <p className="muted">{dateLabel(w.startMs)}</p>
      {save === 'unsaved' && <p role="status" className="tk-note">Gerade nicht gespeichert. Die Änderung bleibt hier und wird beim nächsten Schritt erneut gespeichert.</p>}
      {editing ? (
        w.exercises.map((e) => (
          <section key={e.rid} className="tk-ex" aria-label={e.title}>
            <h2>{e.title}</h2>
            {latest && nextOf(e) && <p className="tk-sub">{nextLine(nextOf(e)!)}</p>}
            {e.sets.length > 0 && <SetHead timed={!!e.timed} editing />}
            {e.sets.map((s, si) => (
              <SetRow key={s.rid} index={si} set={s} timed={!!e.timed} label={setLabels(e.sets)[si]} editing
                confirmedNow={() => store.current().exercises.find((x) => x.rid === e.rid)?.sets.find((x) => x.rid === s.rid)?.doneMs != null}
                onEdit={(patch) => act((x) => editSet(x, e.rid, s.rid, patch))} onRemove={() => act((x) => removeSet(x, e.rid, s.rid))} />
            ))}
          </section>
        ))
      ) : (
        <RowList label="Übungen">
          {w.exercises.map((e) => {
            const sets = e.sets as TrackedSet[];
            const n = latest ? nextOf(e) : undefined;
            const warm = warmups(sets);
            return (
              <Row key={e.rid} onClick={() => setExercise(e.exerciseId)} title={
                <>
                  <span className="tk-ex-name">{e.title}</span>
                  <span className="tk-setline">{setsLine(sets, !!e.timed)}</span>
                  {warm > 0 && <span className="tk-setline muted">{warm === 1 ? '+ 1 Aufwärmsatz' : `+ ${warm} Aufwärmsätze`}</span>}
                  {n && <span className="tk-setline muted">{nextLine(n)}</span>}
                </>
              } />
            );
          })}
        </RowList>
      )}
      <button type="button" className="secondary" onClick={() => setEditing(!editing)}>{editing ? 'Fertig' : 'Bearbeiten'}</button>
      <div className="tk-links tk-end">
        <ConfirmLink label="Training löschen" question="Dieses Training wirklich löschen? Es lässt sich nicht zurückholen." onConfirm={() => void store.remove().then((ok) => { if (ok) onDeleted(); })} />
      </div>
    </div>
  );
}

/** One finished workout from the shared history: the detail view with its own store, history and next steps. */
export function WorkoutDetail({ port, record, now, onBack }: { port: TrackingPort; record: TrackedRecord; now: () => number; onBack: () => void }) {
  const records = usePortRecords(port, 'workout').records;
  const history = useMemo(() => dedupeSessions((records ?? []).map((r) => r.body as LoggedWorkout)), [records]);
  const statsRecords = usePortRecords(port, 'stats').records;
  const next = useMemo(() => {
    const r = (statsRecords ?? []).find((x) => x.id === STATS_ID && !x.deleted);
    return (r && readStats(r.body)?.next) || [];
  }, [statsRecords]);
  const [store] = useState(() => acquireStore(port, record, now));
  const newest = history.reduce<LoggedWorkout | null>((a, w) => (!a || (w.endMs ?? w.startMs) > (a.endMs ?? a.startMs) ? w : a), null);
  return <Detail port={port} store={store} history={history} latest={newest !== null && record.id === newest.id} next={next} onBack={onBack} onDeleted={onBack} />;
}

export function HistoryScreen({ port, now = Date.now }: { port: TrackingPort; now?: () => number; newId?: () => string }) {
  const q = usePortRecords(port, 'workout');
  const records = q.records;
  // One performed session counts once: an overlapping Hevy copy of an own workout is left out.
  const history = dedupeSessions((records ?? []).map((r) => r.body as LoggedWorkout));
  const recOf = new Map((records ?? []).map((r) => [r.id, r] as [string, TrackedRecord]));
  const [store, setStore] = useState<WorkoutStore | null>(null);
  const statsRecords = usePortRecords(port, 'stats').records;
  const next = useMemo(() => {
    const r = (statsRecords ?? []).find((x) => x.id === STATS_ID && !x.deleted);
    return (r && readStats(r.body)?.next) || [];
  }, [statsRecords]);
  const [tab, setTab] = useState<'workouts' | 'exercises'>('workouts');
  const [exercise, setExercise] = useState<string | null>(null);
  const [older, setOlder] = useState(false);

  const newest = history.reduce<LoggedWorkout | null>((a, w) => (!a || (w.endMs ?? w.startMs) > (a.endMs ?? a.startMs) ? w : a), null);
  if (store) return <Detail port={port} store={store} history={history} latest={newest !== null && store.current().id === newest.id} next={next} onBack={() => setStore(null)} onDeleted={() => setStore(null)} />;
  const exercises = new Map<string, string>();
  for (const w of history) for (const e of w.exercises) if (e.sets.some((s) => s.doneMs !== null) && !exercises.has(e.exerciseId)) exercises.set(e.exerciseId, e.title);
  if (exercise !== null) return <Development exerciseId={exercise} title={exercises.get(exercise) ?? ''} history={history} onBack={() => setExercise(null)} />;

  // The last 8 weeks, newest first, by month; the rest behind "Ältere anzeigen".
  const at = (w: LoggedWorkout) => w.endMs ?? w.startMs;
  const sorted = [...history].sort((a, b) => at(b) - at(a));
  const cutoff = now() - 8 * WEEK_MS;
  const shown = older ? sorted : sorted.filter((w) => at(w) >= cutoff);
  const months: { label: string; items: LoggedWorkout[] }[] = [];
  for (const w of shown) {
    const label = monthLabel(at(w));
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(w); else months.push({ label, items: [w] });
  }

  return (
    <div className="tk-screen">
      <h1 className="tk-title">Verlauf</h1>
      <SyncNote port={port} />
      {q.failed && <p role="status" className="tk-note">Der Verlauf konnte gerade nicht gelesen werden. <button type="button" onClick={q.retry}>Nochmal versuchen</button></p>}
      <div className="tk-textseg" role="group" aria-label="Ansicht">
        <button type="button" className="link" aria-pressed={tab === 'workouts'} onClick={() => setTab('workouts')}>Trainings</button>
        <button type="button" className="link" aria-pressed={tab === 'exercises'} onClick={() => setTab('exercises')}>Je Übung</button>
      </div>
      {records !== null && history.length === 0 && <p className="muted">Hier erscheinen deine abgeschlossenen Trainings.</p>}
      {tab === 'workouts' ? (
        <>
          {months.map((m) => (
            <section key={m.label} aria-label={m.label}>
              <h2 className="tk-section">{m.label}</h2>
              <RowList>
                {m.items.map((w) => <Row key={w.id} title={w.title} value={dateLabel(at(w))} onClick={() => setStore(acquireStore(port, recOf.get(w.id) ?? (w as TrackedWorkout), now))} />)}
              </RowList>
            </section>
          ))}
          {!older && shown.length < sorted.length && <button type="button" className="link" onClick={() => setOlder(true)}>Ältere anzeigen</button>}
        </>
      ) : (
        <RowList label="Übungen">
          {[...exercises.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de')).map(([id, title]) => (
            <Row key={id} title={title} onClick={() => setExercise(id)} />
          ))}
        </RowList>
      )}
    </div>
  );
}
