import { bodyOf } from '../../shared/record-bodies';
import { useMemo, useState } from 'react';
import { dedupeSessions } from '../../shared/history';
import type { LoggedWorkout } from '../../shared/records';
import type { TrackingPort } from '../ports';
import { liftTrends } from '../progress';
import { CatalogScreen } from './CatalogScreen';
import { Development, doneExercises } from './HistoryScreen';
import { usePortRecords } from './hooks';
import { Row, RowList } from './kit';
import { ReadFailed } from './ReadFailed';
import { SyncNote } from './SyncNote';

/**
 * Kraft > Übungen: one list place. "Deine Übungen" on top, each with one word for how it moves (a tap shows it over time),
 * then the whole catalog to look up how an exercise is done.
 */
export function ExercisesScreen({ port, now = Date.now, newId = () => crypto.randomUUID() }: { port: TrackingPort; now?: () => number; newId?: () => string }) {
  const q = usePortRecords(port, 'workout');
  const records = q.records;
  const history = useMemo(() => dedupeSessions((records ?? []).map((r) => bodyOf('workout', r))), [records]);
  const [exercise, setExercise] = useState<string | null>(null);
  const exercises = doneExercises(history);
  const trends = useMemo(() => liftTrends(history, now()), [history, now]);
  if (exercise !== null) return <Development exerciseId={exercise} title={exercises.get(exercise) ?? ''} history={history} onBack={() => setExercise(null)} />;
  return (
    <>
      <div className="tk-screen">
        <SyncNote port={port} />
        {q.failed && <ReadFailed text="Deine Übungen konnten gerade nicht gelesen werden." retry={q.retry} />}
        {exercises.size > 0 && (
          <section aria-label="Deine Übungen">
            <h2 className="tk-section">Deine Übungen</h2>
            <RowList label="Deine Übungen">
              {[...exercises.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de')).map(([id, title]) => (
                <Row key={id} title={title} value={trends.get(id)} onClick={() => setExercise(id)} />
              ))}
            </RowList>
          </section>
        )}
      </div>
      <CatalogScreen port={port} now={now} newId={newId} />
    </>
  );
}
