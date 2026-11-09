import { useEffect, useState, type ReactNode } from 'react';
import type { ClientMessage, StateMessage } from '../../shared/protocol';
import { stepTargetZone, zoneBounds, zoneOf } from '../../shared/hr-zones';
import { clampTargetW } from '../../shared/target-power';
import { stepFtpFraction, type Step } from '../../shared/session';
import { beep, beepsAt, saveSoundEnabled, soundEnabled } from '../countdown';
import { hrZoneColor, ZoneChip } from '../hr-zone-style';
import { useRideTip } from '../ride-tips';
import { powerZone, WorkoutBar } from './WorkoutBar';

const WARN_BEFORE_S = 15;
const ON_TARGET = 0.05;
const value = (n: number | null | undefined) => (n === null || n === undefined ? '–' : String(Math.round(n)));
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const powerClass = (power: number | null | undefined, target: number | null): string => {
  if (power === null || power === undefined || target === null) return '';
  const off = (power - target) / target;
  if (off < -ON_TARGET) return 'low';
  if (off > ON_TARGET) return 'high';
  return 'good';
};

/** What the next section asks for. Pulse-hold sections have no fixed watts, so they name the heart rate zone. */
const FilmNext = ({ step, ftpW }: { step: Step; ftpW: number | undefined }) => {
  const fraction = stepFtpFraction(step);
  const hold = step.kind === 'erg' && step.hrHold;
  return (
    <div className="film-next" data-testid="film-next" style={{ borderLeftColor: hold ? hrZoneColor(step.hrZone) : `var(--z${powerZone(fraction)})` }}>
      <span className="label">Danach</span>
      {hold
        ? <b>Puls{step.hrZone ? <> <ZoneChip zone={step.hrZone}>Zone {step.hrZone}</ZoneChip></> : ''}</b>
        : <b>{ftpW ? `${Math.round(clampTargetW(fraction * ftpW, ftpW))} W · ` : ''}Z{powerZone(fraction)}</b>}
      <span className="film-next-label">{step.label}</span>
    </div>
  );
};

export const RideView = ({ state, send, compact = false, extra, tools, hrMaxBpm, mountain }: { state: StateMessage; send: (m: ClientMessage) => void; compact?: boolean; extra?: ReactNode; tools?: ReactNode; hrMaxBpm?: number; mountain?: ReactNode }) => {
  const [ending, setEnding] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'm') send({ type: 'mark' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const { engine, latest, devices, session } = state;
  const [sound, setSound] = useState(soundEnabled);
  const secondsToNext = engine?.secondsToNext;
  // Only the main window sounds, the film window runs alongside it.
  const beepNow = !compact && sound && !!engine && beepsAt(engine.secondsToNext, engine);
  useEffect(() => { if (beepNow && secondsToNext !== undefined) beep(secondsToNext); }, [secondsToNext, beepNow]);
  const warnSoon = !!engine?.nextLabel && engine.secondsToNext <= WARN_BEFORE_S;
  const tip = useRideTip(state, hrMaxBpm, warnSoon || state.storageError);
  if (!engine) return null;
  const target = value(engine.targetW);
  const warn = engine.nextLabel && engine.secondsToNext <= WARN_BEFORE_S;
  const totalLeft = session ? Math.max(0, session.steps.reduce((a, s) => a + s.durationS, 0) - engine.rideElapsedS) : null;
  const totalS = session ? session.steps.reduce((a, s) => a + s.durationS, 0) : null;
  const progressPct = totalS ? Math.min(100, Math.max(0, (engine.rideElapsedS / totalS) * 100)) : 0;
  const nextStep = session?.steps[engine.stepIndex + 1];
  const sudden = nextStep?.kind === 'grade' && nextStep.sudden;
  const step = session?.steps[engine.stepIndex];
  const hr = latest.hrBpm;
  const zone = hrMaxBpm && hr ? zoneOf(hr, hrMaxBpm) : null;
  const zoneTarget = step ? stepTargetZone(step) : null;
  const holdZone = step?.kind === 'erg' && step.hrHold && step.hrZone && hrMaxBpm ? zoneBounds(step.hrZone, hrMaxBpm) : null;
  const banners = (
    <>
      {state.storageError && <div className="banner danger" role="alert">Speichern schlägt gerade fehl. Die Fahrt läuft weiter, bitte Speicherplatz prüfen.</div>}
      {warn && <div className="banner warn" role="alert">In {engine.secondsToNext} s: {engine.nextLabel}{sudden ? ', plötzlicher Anstieg' : ''}</div>}
      {tip && <div className="banner tip" role="status" data-testid="ride-tip"><b>Coach:</b> {tip}</div>}
      {engine.paused && <div className="banner info" role="status">Pause. Tritt an, dann geht es weiter.</div>}
    </>
  );
  if (compact) {
    return (
      <main className="film">
        {banners}
        <div className="film-main">
          <div><span className="label" title="Vorgabe">Soll</span><b data-testid="target">{target}<small>W</small></b></div>
          <div><span className="label" title="Leistung">Ist</span><b data-testid="power" className={powerClass(latest.powerW, engine.targetW)}>{value(latest.powerW)}</b></div>
        </div>
        <div className="film-side">
          <span><span data-testid="film-heart" className={hr ? 'heart beating' : 'heart'} style={hr ? { animationDuration: `${60 / hr}s` } : undefined}>♥</span> <b data-testid="hr" style={{ color: hrZoneColor(zone) }}>{value(latest.hrBpm)}</b></span>
          <span>↻ <b>{value(latest.cadenceRpm)}</b></span>
          <span>⏱ <b data-testid="remaining">{mmss(engine.stepRemainingS)}</b></span>
        </div>
        {session && <WorkoutBar session={session} elapsedS={engine.rideElapsedS} />}
        {nextStep && <FilmNext step={nextStep} ftpW={state.profiles.find((p) => p.id === state.ride?.profileId)?.ftpW} />}
      </main>
    );
  }
  return (
    <main className={mountain ? 'ride with-pass' : 'ride'}>
      <header className="ride-head">
        <div>
          <h2>{engine.label}</h2>
          {engine.nextLabel && <span className="muted">Danach: {engine.nextLabel}</span>}
        </div>
        <div className="devices">
          <span className={devices.trainer === 'connected' ? 'dot on' : 'dot'}>Trainer</span>
          <span className={devices.hr === 'connected' ? 'dot on' : 'dot'}>Puls</span>
          <span className={devices.clicker === 'connected' ? 'dot on' : 'dot'}>Clicker</span>
        </div>
      </header>
      {totalS !== null && totalS > 0 && <div className="session-progress" role="progressbar" aria-label="Fortschritt der Einheit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPct)}><i style={{ width: `${progressPct}%` }} /></div>}
      {banners}
      {devices.trainer !== 'connected' && <div className="banner warn" role="status">Trainer wird gesucht. Die Fahrt läuft weiter und ist gespeichert.</div>}
      {hrMaxBpm !== undefined && devices.hr !== 'connected' && <div className="banner info" role="status">Kein Puls, die Fahrt läuft nach Watt weiter.</div>}
      {engine.autoReducedPct > 0 && <div className="banner info" role="status">Vorgabe automatisch um {engine.autoReducedPct} % gesenkt.</div>}
      {holdZone && step?.hrZone && <div className="banner info" role="status">Die Watt folgen deinem Puls: <ZoneChip zone={step.hrZone}>Zone {step.hrZone}</ZoneChip>, {holdZone.fromBpm} bis {holdZone.toBpm} bpm.</div>}
      {extra}
      {mountain}
      <section className="hero">
        <div className="hero-tile power">
          <span className="label">Leistung</span>
          <b data-testid="power" className={powerClass(latest.powerW, engine.targetW)}>{value(latest.powerW)}<small>W</small></b>
        </div>
        <div className="hero-tile target">
          <span className="label">Vorgabe</span>
          <b data-testid="target">{target}<small>W</small></b>
        </div>
        <div className="hero-tile countdown">
          <span className="label">Restzeit Abschnitt</span>
          <b data-testid="remaining">{mmss(engine.stepRemainingS)}</b>
        </div>
      </section>
      <section className="stats">
        <div className="tile"><span className="label">Puls</span><b data-testid="hr" style={{ color: hrZoneColor(zone) }}>{value(latest.hrBpm)}</b>{zone !== null && zoneTarget !== null && <span data-testid="hr-zone" className={zone > zoneTarget ? 'hr-zone high' : 'hr-zone'}>{zone === 0 ? 'Unter Zone 1' : <ZoneChip zone={zone}>Zone {zone}</ZoneChip>} · <ZoneChip zone={zoneTarget}>Ziel {zoneTarget}</ZoneChip></span>}</div>
        <div className="tile"><span className="label">Trittfrequenz</span><b>{value(latest.cadenceRpm)}</b></div>
        <div className="tile"><span className="label">Noch insgesamt</span><b>{totalLeft === null ? '–' : mmss(totalLeft)}</b></div>
      </section>
      {session && <WorkoutBar session={session} elapsedS={engine.rideElapsedS} currentW={engine.targetW} />}
      <footer className="row">
        <button className="secondary" onClick={() => send({ type: 'adjust', deltaPct: -5 })}>Leichter −5 %</button>
        <button className="secondary" onClick={() => send({ type: 'adjust', deltaPct: 5 })}>Härter +5 %</button>
        <button className="secondary" onClick={() => window.open('#film', 'film')}>Film-Modus</button>
        <button className="secondary" onClick={() => { saveSoundEnabled(!sound); setSound(!sound); }}>Ton: {sound ? 'an' : 'aus'}</button>
        {tools}
        <span className="spacer" />
        <button className="ghost" onClick={() => setEnding(true)}>Beenden</button>
      </footer>
      {ending && (
        <div className="overlay">
          <div role="dialog" className="card dialog">
            <h2>Training beenden?</h2>
            <p>Beim Verwerfen zählt diese Fahrt nicht: keine Bewertung, keine Änderung am Plan, kein Export.</p>
            <div className="row">
              <button onClick={() => { setEnding(false); send({ type: 'stop' }); }}>Speichern und beenden</button>
              <button className="secondary" onClick={() => setEnding(false)}>Weiterfahren</button>
              <span className="spacer" />
              <button className="danger" onClick={() => { setEnding(false); send({ type: 'discard' }); }}>Verwerfen</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
