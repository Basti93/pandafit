import { useMemo, useState } from 'react';
import type { GymWorkout } from '../../shared/gym/types';
import { bodyOf } from '../../shared/record-bodies';
import { dedupeSessions } from '../../shared/history';
import { PageHead, RowCard, StandCard, useBackEntry } from '../../tracking/ui/kit';
import { ExercisesScreen, RoutinesScreen, WorkoutScreen } from '../../tracking/ui';
import { usePortRecords } from '../../tracking/ui/hooks';
import { exercisesSentence, routinesSentence } from '../../tracking/ui/kraft-view';
import { useSportWeek } from '../../tracking/ui/sport-week';
import { liftTrends } from '../../tracking/progress';
import { useApp } from '../AppContext';
import { planDateText, readPlan } from '../logic';

/** A sub page of Kraft: the page head with the back pill "Kraft", and the browser's Back goes the same way. */
function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  useBackEntry(onBack);
  return (
    <>
      <div className="tk-screen tk-headblock"><PageHead title={title} back={{ label: 'Kraft', onClick: onBack }} /></div>
      {children}
    </>
  );
}

export function Training({ entry, onEntryDone, onDone, onLive }: { entry: 'resume' | 'plan' | null; /** The plan sheet asked for by Heute has opened: the request is used up. */ onEntryDone: () => void; onDone: () => void; /** Told whether the running workout is shown, so the app frame (tab bar, profile, wordmark) can step aside. */ onLive?: (live: boolean) => void }) {
  const { port, env, account } = useApp();
  const [running, setRunning] = useState(false);
  const plans = usePortRecords(port, 'plan').records;
  const workouts = usePortRecords(port, 'workout').records;
  const routineRecords = usePortRecords(port, 'routine').records;
  const [page, setPage] = useState<'start' | 'routines' | 'exercises'>('start');
  const [routine, setRoutine] = useState<GymWorkout | null>(null);
  const plan = readPlan((plans ?? []).find((r) => r.id === 'current'));
  const week = useSportWeek(port, env.now(), 'kraft');
  const trends = useMemo(() => liftTrends(dedupeSessions((workouts ?? []).map((r) => bodyOf('workout', r))), env.now()), [workouts, env]);
  const routineCount = (routineRecords ?? []).filter((r) => !r.deleted).length;
  const back = () => setPage('start');
  if (page === 'routines') {
    return (
      <SubPage title="Deine Routinen" onBack={back}>
        <RoutinesScreen port={port} now={env.now} newId={env.newId} onStart={(r) => { setRoutine(r); setPage('start'); }} />
      </SubPage>
    );
  }
  if (page === 'exercises') {
    return <SubPage title="Deine Übungen" onBack={back}><ExercisesScreen port={port} now={env.now} newId={env.newId} /></SubPage>;
  }
  return (
    <>
      {/* No visible title: the stand card says where you are. A running workout has the whole screen. */}
      {!running && (
        <div className="tk-screen tk-headblock">
          <h1 className="tk-sr">Kraft</h1>
          {week.loaded && <StandCard kicker="Kraft · diese Woche" text={week.text} marks={week.marks} marksLabel={week.label} />}
        </div>
      )}
      <WorkoutScreen key={routine ? 'routine' : 'plan'} port={port} resume={entry === 'resume'} onActive={(v) => { setRunning(v); onLive?.(v); }} onDone={onDone} plan={plan?.workout ?? null} routine={routine}
        planMeta={plan ? { atMs: plan.atMs, dateText: planDateText(plan.atMs), reason: plan.reason, note: plan.note, outlook: plan.outlook } : null} account={account} storage={env.storage} openPlan={entry === 'plan'} onOpened={onEntryDone} now={env.now} newId={env.newId} />
      {!running && (
        <div className="tk-screen tk-tiles">
          <RowCard icon="routinen" title="Deine Routinen" sub={routinesSentence(routineCount)} end="none" onClick={() => setPage('routines')} />
          <RowCard icon="uebungen" title="Deine Übungen" sub={exercisesSentence(trends)} end="none" onClick={() => setPage('exercises')} />
        </div>
      )}
    </>
  );
}
