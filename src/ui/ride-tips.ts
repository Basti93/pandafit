import { useEffect, useRef, useState } from 'react';
import { stepTargetZone, zoneOf } from '../shared/hr-zones';
import type { StateMessage } from '../shared/protocol';
import { stepFtpFraction } from '../shared/session';

export const TIP_GAP_S = 300;
export const TIP_SHOW_S = 15;
const HISTORY_S = 60;
const LOW_CADENCE = 60;
const HARD_FRACTION = 0.75;
// Own setting: personal tips from the coach come after minute 10.
const PERSONAL_FROM_S = 600;

export type Tip = { id: string; text: string };
export type TipContext = {
  engine: NonNullable<StateMessage['engine']>;
  session: NonNullable<StateMessage['session']>;
  /** Last minute of readings, empty until a full minute is there. */
  cadences: number[];
  zones: number[];
};

/** The most useful tip right now that has not been given yet. Body first, encouragement after. */
export const pickTip = ({ engine, session, cadences, zones }: TipContext, given: ReadonlySet<string>): Tip | null => {
  const { stepIndex, stepRemainingS, rideElapsedS: t } = engine;
  const step = session.steps[stepIndex];
  if (!step) return null;
  const next = session.steps[stepIndex + 1];
  const total = session.steps.reduce((a, s) => a + s.durationS, 0);
  const left = total - t;
  const hard = stepFtpFraction(step) >= HARD_FRACTION;
  const hold = step.kind === 'erg' && step.hrHold;
  const candidates: (Tip | false)[] = [
    !hold && zones.length > 0 && zones.every((z) => z > stepTargetZone(step)) && { id: `hr-${stepIndex}`, text: 'Puls über dem Ziel: ruhig ausatmen, Schultern locker.' },
    cadences.length > 0 && cadences.every((c) => c < LOW_CADENCE) && { id: `cadence-${Math.floor(t / 600)}`, text: 'Dreh etwas schneller, das nimmt Druck aus den Beinen.' },
    !!next && stepRemainingS <= 90 && stepRemainingS > 30 && stepFtpFraction(next) >= HARD_FRACTION && stepFtpFraction(next) >= stepFtpFraction(step) + 0.15 && { id: `prepare-${stepIndex}`, text: 'Gleich wird es härter: jetzt noch locker treten und trinken.' },
    // The coach's own tips: after the body tips, never early and never in a hard section.
    ...(t >= PERSONAL_FROM_S && !hard ? (session.tips ?? []).map((text, i): Tip => ({ id: `coach-${i}`, text })) : []),
    hard && { id: 'hard-cadence', text: 'Im harten Block helfen meist 80 bis 95 Umdrehungen.' },
    left <= 300 && left > 120 && { id: 'final', text: 'Fast geschafft, nur noch wenige Minuten.' },
    t >= total / 2 && t < total / 2 + 120 && { id: 'half', text: 'Halbzeit, du liegst gut im Plan.' },
    t >= 1200 && { id: `drink-${Math.floor(t / 1200)}`, text: 'Zeit für einen Schluck.' },
    t >= 600 && { id: `relax-${Math.floor(t / 900)}`, text: 'Kurz prüfen: Griff locker, Schultern unten.' },
  ];
  return candidates.find((c): c is Tip => !!c && !given.has(c.id)) ?? null;
};

/** One short tip at a time, at least TIP_GAP_S apart. Each window decides for itself, nothing is saved. */
export const useRideTip = (state: StateMessage, hrMaxBpm: number | undefined, blocked: boolean): string | null => {
  const [tip, setTip] = useState<{ text: string; untilS: number } | null>(null);
  const memory = useRef({ given: new Set<string>(), lastS: state.engine?.rideElapsedS ?? 0, seenS: -1, cadences: [] as number[], zones: [] as number[] });
  const { engine, session, latest } = state;
  const elapsed = engine?.rideElapsedS;
  useEffect(() => {
    const m = memory.current;
    if (!engine || !session || elapsed === undefined || elapsed === m.seenS) return;
    m.seenS = elapsed;
    if (latest.cadenceRpm && latest.cadenceRpm > 5) m.cadences = [...m.cadences, latest.cadenceRpm].slice(-HISTORY_S);
    else m.cadences = [];
    if (latest.hrBpm && hrMaxBpm) m.zones = [...m.zones, zoneOf(latest.hrBpm, hrMaxBpm)].slice(-HISTORY_S);
    else m.zones = [];
    if (engine.paused || blocked || elapsed - m.lastS < TIP_GAP_S) return;
    const full = (a: number[]) => (a.length === HISTORY_S ? a : []);
    const next = pickTip({ engine, session, cadences: full(m.cadences), zones: full(m.zones) }, m.given);
    if (!next) return;
    m.given.add(next.id);
    m.lastS = elapsed;
    setTip({ text: next.text, untilS: elapsed + TIP_SHOW_S });
  }, [elapsed]);
  if (!tip || elapsed === undefined || elapsed >= tip.untilS || engine?.paused || blocked) return null;
  return tip.text;
};
