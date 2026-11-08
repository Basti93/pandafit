import { useState } from 'react';
import type { Exercise } from '../../shared/exercises';
import type { GymOutlook as Outlook } from '../../shared/gym-outlook';
import type { LoggedWorkout } from '../../shared/records';
import type { StudioState } from '../../shared/studio';
import { exerciseImages, videoSearchUrl } from '../media';
import { resolveExercise } from '../exercise-identity';
import { describeExercise } from '../similar';
import { addExercise, addSet, editSet, presetOf, removeExercise, removeSet, swapExercise, type TrackedWorkout } from '../session';
import type { TrackingPort } from '../ports';
import { ExerciseInfo } from './ExerciseInfo';
import { ExercisePicker } from './ExercisePicker';
import { GymOutlook } from './GymOutlook';
import { MuscleIcon } from './MuscleIcon';
import { SetHead, SetRow } from './SetRow';
import { setLabels } from './setGrid';
import { Sheet } from './kit';

type Picker = { mode: 'add' } | { mode: 'swap'; ex: string } | null;

/**
 * "Nächstes Training": the workout the start would create, to look at and change before it starts. Each change goes to `onChange`
 * (the caller keeps it as the draft). The sets have the same fields as in the running workout, without the done tick.
 * "Training starten" starts what is shown; "Fertig" closes and keeps the changes.
 */
export function PlanSheet({ port, workout, dateText, reason, note, notice, outlook, history, studios, catalog, now, newId, onChange, onStart, onClose }: {
  port: TrackingPort; workout: TrackedWorkout; dateText: string | null; reason: string | null; note: string | null; notice: string | null; outlook: Outlook | null;
  history: LoggedWorkout[]; studios: StudioState; catalog: Exercise[]; now: () => number; newId: () => string;
  onChange: (w: TrackedWorkout) => void; onStart: () => void; onClose: () => void;
}) {
  const [picker, setPicker] = useState<Picker>(null);
  const [info, setInfo] = useState<string | null>(null);
  const act = (f: (w: TrackedWorkout) => TrackedWorkout) => onChange(f(workout));
  return (
    <Sheet title="Nächstes Training" display onClose={onClose}
      actions={<>
        <button type="button" disabled={workout.exercises.length === 0} onClick={onStart}>Training starten</button>
        <button type="button" className="link" onClick={onClose}>Fertig</button>
      </>}>
      {(dateText || reason || note || notice) && (
        <div className="tk-plan-top muted">
          {reason && <p>{reason}</p>}
          {note && <p>{note}</p>}
          {notice && <p>{notice}</p>}
          {dateText && <p>{dateText}</p>}
        </div>
      )}
      {workout.exercises.map((e) => {
        const timed = !!e.timed;
        const resolved = resolveExercise(e, catalog);
        const own = resolved.exercise;
        const icon = <MuscleIcon group={resolved.group} />;
        const labels = setLabels(e.sets);
        const showInfo = info === e.rid;
        return (
          <section key={e.rid} className="tk-ex tk-plan-ex" aria-label={e.title}>
            <div className="tk-ex-head">
              <span className="tk-ex-icon">{icon}</span>
              <h2>{e.title}</h2>
              <button type="button" className="link tk-info-btn" aria-label={`Anleitung ${e.title}`} aria-expanded={showInfo} onClick={() => setInfo(showInfo ? null : e.rid)}><span aria-hidden="true">i</span></button>
              <button type="button" className="danger-link tk-del-ex" aria-label={`Übung entfernen ${e.title}`} onClick={() => act((x) => removeExercise(x, e.rid))}>×</button>
            </div>
            {showInfo && (
              <ExerciseInfo title={e.title} description={describeExercise(e, catalog)} icon={icon}
                images={own ? exerciseImages(own.id) : []} video={videoSearchUrl({ title: e.title, hevyTitle: own?.hevyTitle })} />
            )}
            {e.sets.length > 0 && <SetHead timed={timed} />}
            {e.sets.map((s, si) => (
              <SetRow key={s.rid} index={si} set={s} timed={timed} label={labels[si]} preset={presetOf(e.sets, si)}
                onEdit={(patch) => act((x) => editSet(x, e.rid, s.rid, patch))}
                onRemove={() => act((x) => removeSet(x, e.rid, s.rid))} />
            ))}
            <div className="tk-plan-steps">
              <div className="tk-stepper">
              <button type="button" className="tk-step-btn" aria-label={`Satz entfernen ${e.title}`} disabled={e.sets.length <= 1}
                onClick={() => { const last = e.sets[e.sets.length - 1]; if (last) act((x) => removeSet(x, e.rid, last.rid)); }}>−</button>
              <span className="tk-stepcount">{e.sets.length} {e.sets.length === 1 ? 'Satz' : 'Sätze'}</span>
              <button type="button" className="tk-step-btn" aria-label={`Satz hinzufügen ${e.title}`} onClick={() => act((x) => addSet(x, e.rid))}>+</button>
              </div>
              <button type="button" className="link tk-plan-swap" aria-label={`Andere Übung statt ${e.title}`} onClick={() => setPicker({ mode: 'swap', ex: e.rid })}>Andere Übung</button>
            </div>
          </section>
        );
      })}
      <button type="button" className="secondary" onClick={() => setPicker({ mode: 'add' })}>Übung hinzufügen</button>
      <GymOutlook outlook={outlook} />
      {picker && (
        <ExercisePicker port={port} now={now} newId={newId} onClose={() => setPicker(null)}
          like={picker.mode === 'swap' ? workout.exercises.find((x) => x.rid === picker.ex) : undefined}
          onPick={(ex: Exercise) => {
            const p = picker; setPicker(null);
            act((x) => (p.mode === 'swap' ? swapExercise(x, p.ex, ex, history, studios) : addExercise(x, ex, history, studios)));
          }} />
      )}
    </Sheet>
  );
}
