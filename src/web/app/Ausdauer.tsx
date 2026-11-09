import { useState } from 'react';
import { PageHead } from '../../tracking/ui/kit';
import { BikeScreen, RunScreen } from '../../tracking/ui';
import { useApp } from '../AppContext';
import { Endurance, readEndurance, saveEndurance } from './tabs';

export function Ausdauer({ hasRun, hasBike }: { hasRun: boolean; hasBike: boolean }) {
  const { port, env, account } = useApp();
  const stored = readEndurance(env, account);
  const [kind, setKind] = useState<Endurance>(stored ?? (hasBike ? 'rad' : 'laufen'));
  const shown: Endurance = kind === 'rad' && !hasBike ? 'laufen' : kind === 'laufen' && !hasRun ? 'rad' : kind;
  const pick = (k: Endurance) => { setKind(k); saveEndurance(env, account, k); };
  // One page head: the title on top, the switch below it, no second title in the screen.
  return (
    <>
      <div className="tk-screen tk-headblock">
        <PageHead title="Ausdauer" />
        {hasRun && hasBike && (
          <div className="tk-seg" role="group" aria-label="Ausdauer">
            <button type="button" aria-pressed={shown === 'rad'} onClick={() => pick('rad')}>Rad</button>
            <button type="button" aria-pressed={shown === 'laufen'} onClick={() => pick('laufen')}>Laufen</button>
          </div>
        )}
      </div>
      {shown === 'rad' ? <BikeScreen port={port} now={env.now} /> : <RunScreen port={port} now={env.now} newId={env.newId} />}
    </>
  );
}
