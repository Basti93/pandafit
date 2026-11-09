import { useEffect, useRef, useState } from 'react';
import type { CoachClientMessage } from '../../coach/protocol';
import type { Pass } from '../../shared/passes';
import { beep, soundEnabled } from '../countdown';
import { heightAt, nextPosition, topOf } from './riding';

const SAVE_EVERY_MS = 30_000;
const TICK_MS = 1000;
const num = (v: number) => Math.round(v).toLocaleString('de-DE');

export const Mountain = ({ pass, distanceM }: { pass: Pass; distanceM: number }) => {
  const top = topOf(pass), low = Math.min(...pass.heights);
  const x = (d: number) => (d / pass.lengthM) * 1000;
  const y = (h: number) => 330 - ((h - low) / Math.max(1, top - low)) * 290;
  const line = pass.heights.map((h, i) => [Math.min(pass.lengthM, i * pass.stepM), h] as const);
  const points = (list: readonly (readonly [number, number])[]) => list.map(([d, h]) => `${x(d).toFixed(1)},${y(h).toFixed(1)}`).join(' ');
  const here = heightAt(pass, distanceM);
  const done = [...line.filter(([d]) => d < distanceM), [distanceM, here] as const];
  const toRight = distanceM / pass.lengthM > 0.85;
  return (
    <svg className="mountain" viewBox="0 0 1000 345" preserveAspectRatio="none" role="img" aria-label={`Höhenprofil ${pass.name}, ${num(pass.lengthM - distanceM)} Meter bis oben`}>
      <defs><linearGradient id="pass-done" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent)" stopOpacity=".18" /></linearGradient></defs>
      <polygon points={`0,345 ${points(line)} 1000,345`} fill="var(--line)" />
      <polygon points={`0,345 ${points(done)} ${x(distanceM).toFixed(1)},345`} fill="url(#pass-done)" />
      <polyline points={points(line)} fill="none" stroke="var(--muted)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <line x1={x(distanceM)} x2={x(distanceM)} y1={y(here)} y2="345" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={x(distanceM)} cy={y(here)} r="7" fill="#fff" />
      <text x={x(distanceM) + (toRight ? -14 : 14)} y={y(here) - 14} textAnchor={toRight ? 'end' : 'start'} className="mountain-you">Du</text>
    </svg>
  );
};

type Props = { pass: Pass; profileId: string; startM: number; powerW: number | null | undefined; paused: boolean; send: (m: CoachClientMessage) => void };

/** Only looks: nothing here reaches the trainer or the recording. */
export const PassView = ({ pass, profileId, startM, powerW, paused, send }: Props) => {
  const [position, setPosition] = useState({ distanceM: startM, arrived: false });
  const power = useRef<number | null>(null);
  power.current = paused ? null : powerW ?? null;
  const state = useRef(position);
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    state.current = { distanceM: startM, arrived: false };
    setPosition(state.current);
    let last = performance.now(), saved = last;
    const save = () => { if (!state.current.arrived) sendRef.current({ type: 'pass-progress', profileId, passId: pass.id, distanceM: Math.round(state.current.distanceM) }); };
    const timer = setInterval(() => {
      if (state.current.arrived) return;
      const now = performance.now();
      const next = nextPosition(pass, state.current.distanceM, power.current, Math.min(5, (now - last) / 1000));
      last = now;
      state.current = next;
      setPosition(next);
      if (next.arrived) {
        sendRef.current({ type: 'pass-summit', profileId, passId: pass.id });
        if (soundEnabled()) { beep(1); setTimeout(() => beep(1), 350); }
      } else if (now - saved > SAVE_EVERY_MS) { saved = now; save(); }
    }, TICK_MS);
    return () => { clearInterval(timer); save(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass.id, profileId]);

  const here = heightAt(pass, position.distanceM);
  return (
    <section className="pass" data-testid="pass">
      <header className="pass-head">
        <b>{pass.name}</b>
        <span data-testid="pass-left">{position.arrived ? 'Oben!' : `${num(here)} m · noch ${num(Math.max(0, topOf(pass) - here))} Höhenmeter bis oben`}</span>
      </header>
      <div className="pass-plot">
        <Mountain pass={pass} distanceM={position.distanceM} />
        {position.arrived && <div className="pass-summit" role="status" data-testid="pass-summit">🏔 Gipfel! {pass.name}, {num(pass.gainM)} Höhenmeter geschafft.</div>}
      </div>
    </section>
  );
};
