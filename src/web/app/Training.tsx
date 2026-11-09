import { useState } from 'react';
import type { GymWorkout } from '../../shared/gym/types';
import { PageHead } from '../../tracking/ui/kit';
import { ExercisesScreen, RoutinesScreen, WorkoutScreen } from '../../tracking/ui';
import { usePortRecords } from '../../tracking/ui/hooks';
import { useApp } from '../AppContext';
import { planDateText, readPlan } from '../logic';
import { Heute } from './Heute';

export function Training({ entry, onEntryDone, onDone }: { entry: 'resume' | 'plan' | null; /** The plan sheet asked for by Heute has opened: the request is used up. */ onEntryDone: () => void; onDone: () => void }) {
  const { port, env, account } = useApp();
  const [running, setRunning] = useState(false);
  const plans = usePortRecords(port, 'plan').records;
  const [screen, setScreen] = useState<'workout' | 'routines' | 'exercises'>('workout');
  const [routine, setRoutine] = useState<GymWorkout | null>(null);
  const plan = readPlan((plans ?? []).find((r) => r.id === 'current'));
  return (
    <>
      {/* One page head: the title, the three sub-pages below. A running workout has the whole screen: no head until it is done. */}
      {!(running && screen === 'workout') && <div className="tk-screen tk-headblock">
        <PageHead title="Kraft" />
        <div className="tk-seg" role="group" aria-label="Kraft">
          <button type="button" aria-pressed={screen === 'workout'} onClick={() => { setRoutine(null); setScreen('workout'); }}>Training</button>
          <button type="button" aria-pressed={screen === 'routines'} onClick={() => setScreen('routines')}>Routinen</button>
          <button type="button" aria-pressed={screen === 'exercises'} onClick={() => setScreen('exercises')}>Übungen</button>
        </div>
      </div>}
      {screen === 'workout' && <WorkoutScreen key={routine ? 'routine' : 'plan'} port={port} resume={entry === 'resume'} onActive={setRunning} onDone={onDone} plan={routine ? null : plan?.workout ?? null} routine={routine}
        planMeta={plan ? { atMs: plan.atMs, dateText: planDateText(plan.atMs), reason: plan.reason, note: plan.note, outlook: plan.outlook } : null} account={account} storage={env.storage} openPlan={entry === 'plan'} onOpened={onEntryDone} now={env.now} newId={env.newId} />}
      {screen === 'exercises' && <ExercisesScreen port={port} now={env.now} newId={env.newId} />}
      {screen === 'routines' && <RoutinesScreen port={port} now={env.now} newId={env.newId} onStart={(r) => { setRoutine(r); setScreen('workout'); }} />}
    </>
  );
}
