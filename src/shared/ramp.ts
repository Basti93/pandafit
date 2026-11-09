import { RAMP_ID, type Session, type Step } from './session';

const erg = (minutes: number, ftpFraction: number, label: string): Step => ({ kind: 'erg', durationS: minutes * 60, ftpFraction, label });

export const rampTest = (_ftpW: number): Session => {
  const steps: Step[] = [];
  steps.push(erg(5, 0.45, 'Warmup'));
  for (let pct = 50; pct <= 150; pct += 5) steps.push(erg(1, pct / 100, `Rampe ${pct} %`));
  return { id: RAMP_ID, name: 'Rampentest', steps };
};
