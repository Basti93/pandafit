import { useState } from 'react';
import { Segments } from '../../tracking/ui/kit';
import { BikeScreen, RunScreen } from '../../tracking/ui';
import { useApp } from '../AppContext';
import { Endurance, readEndurance, saveEndurance } from './tabs';

export function Ausdauer({ hasRun, hasBike }: { hasRun: boolean; hasBike: boolean }) {
  const { port, env, account } = useApp();
  const stored = readEndurance(env, account);
  const [kind, setKind] = useState<Endurance>(stored ?? (hasBike ? 'rad' : 'laufen'));
  const shown: Endurance = kind === 'rad' && !hasBike ? 'laufen' : kind === 'laufen' && !hasRun ? 'rad' : kind;
  const pick = (k: Endurance) => { setKind(k); saveEndurance(env, account, k); };
  // No visible title: the switch (when there are two sports) comes first, the screen below says where you are.
  return (
    <>
      <div className="tk-screen tk-headblock">
        <h1 className="tk-sr">Ausdauer</h1>
        {hasRun && hasBike && (
          <Segments<Endurance> label="Ausdauer" value={shown} onChange={pick}
            options={[{ value: 'rad', label: 'Rad', icon: 'ausdauer' }, { value: 'laufen', label: 'Laufen', icon: 'lauf' }]} />
        )}
      </div>
      {shown === 'rad' ? <BikeScreen port={port} now={env.now} /> : <RunScreen port={port} now={env.now} newId={env.newId} />}
    </>
  );
}
