import { uploadSettings } from '../../coach/garmin-upload';
import { GarminUploadButton } from './GarminUploadButton';
import { DebriefCard } from './DebriefCard';
import { useState, type ReactNode } from 'react';
import { bestPowers, loadSeries } from '../../coach/metrics';
import { progressText, rideProgress } from '../../coach/progress';
import { rideStats } from '../../coach/stats';
import type { CoachState } from '../../coach/state';
import type { CoachClientMessage, CoachHome, RideDetail } from '../../shared/coach-protocol';
import { LoadChart } from './LoadChart';
import { RideCharts } from './RideCharts';

const RATING: Record<string, string> = { easy: 'zu leicht', right: 'genau richtig', hard: 'zu hart' };
const date = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

const DURATIONS: Record<string, string> = { 5: '5 Sek.', 60: '1 Min.', 300: '5 Min.', 1200: '20 Min.', 3600: '60 Min.' };
const LOAD_DAYS = 84;

const WeekBars = ({ weeks }: { weeks: { startMs: number; minutes: number }[] }) => {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(30, ...weeks.map((w) => w.minutes));
  const shown = hover === null ? weeks.at(-1)! : weeks[hover];
  return (
    <div>
      <p className="chart-readout">{hover === null ? 'Diese Woche' : `Woche ab ${date(shown.startMs)}`}: <b>{shown.minutes} Min.</b></p>
      <div className="bars" onMouseLeave={() => setHover(null)} role="img" aria-label={weeks.map((w) => `Woche ab ${date(w.startMs)}: ${w.minutes} Minuten`).join(', ')}>
        {weeks.map((w, i) => (
          <div key={w.startMs} className="bar-slot" onMouseEnter={() => setHover(i)}>
            <div className="bar" style={{ height: `${w.minutes ? Math.max(3, (w.minutes / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="bars-axis muted"><span>vor 11 Wochen</span><span>diese Woche</span></div>
    </div>
  );
};

type Props = { coachHome?: CoachHome; state: CoachState; detail: RideDetail | null; send: (m: CoachClientMessage) => void; onBack?: () => void; garminConnected?: boolean; /** The run look back; nothing when there is none. */ lookBack?: ReactNode };

/** One muted line: whether this Mac's rides are on the server. Nothing for a profile that has not moved or where it cannot be told. */
export const backupLine = (home: CoachHome | undefined): string | null => {
  if (home?.where !== 'server' || home.pendingRides === undefined) return null;
  if (home.pendingRides === 0) return 'Alle Fahrten gesichert';
  return home.pendingRides === 1 ? '1 Fahrt wartet auf Upload' : `${home.pendingRides} Fahrten warten auf Upload`;
};

export const HistoryView = ({ coachHome, state, detail, send, onBack, garminConnected = false, lookBack }: Props) => {
  const [open, setOpen] = useState<string | null>(null);
  const stats = rideStats(state.summaries, Date.now());
  const rides = [...state.summaries].sort((a, b) => b.startedAtMs - a.startedAtMs);
  const best = Object.entries(bestPowers(state.summaries)).sort(([a], [b]) => Number(a) - Number(b));
  const load = loadSeries(state.summaries, Date.now(), LOAD_DAYS);
  const backup = backupLine(coachHome);
  const toggle = (rideId: string) => {
    setOpen(open === rideId ? null : rideId);
    if (open !== rideId) send({ type: 'ride-detail', profileId: state.profileId, rideId });
  };
  return (
    <main>
      <div className="top">
        <h1>Verlauf</h1>
        {onBack && <button className="ghost" onClick={onBack}>Zurück</button>}
      </div>
      <div className="stat-row">
        <div className="tile"><span className="label">Fahrten</span><b>{stats.rides}</b></div>
        <div className="tile"><span className="label">Stunden</span><b>{(stats.minutes / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })}</b></div>
        <div className="tile"><span className="label">Längste Fahrt</span><b>{stats.longestMinutes} Min.</b></div>
        <div className="tile"><span className="label">Beste Minute</span><b>{stats.bestMinuteW === null ? '–' : `${stats.bestMinuteW} W`}</b></div>
      </div>
      {lookBack}
      <section className="card">
        <h3>Minuten pro Woche</h3>
        <WeekBars weeks={stats.weeks} />
      </section>
      {best.length > 0 && (
        <section className="card" data-testid="best-powers">
          <h3>Deine besten Werte</h3>
          <div className="best-row">
            {best.map(([d, w]) => <div key={d} className="tile"><span className="label">{DURATIONS[d]}</span><b>{w} W</b></div>)}
          </div>
        </section>
      )}
      {load.length > 1 && <LoadChart points={load} />}
      <section className="card">
        <h3>Deine Fahrten</h3>
        {backup && <p className="muted" data-testid="ride-backup">{backup}</p>}
        {rides.length === 0 && <p className="muted">Noch ganz leer hier. Deine erste Fahrt wartet schon.</p>}
        <ul className="rides">
          {rides.map((r) => (
            <li key={r.rideId}>
              <button className="ride-row" aria-expanded={open === r.rideId} onClick={() => toggle(r.rideId)}>
                <span>{date(r.startedAtMs)}</span>
                <span className="ride-name">{r.sessionName ?? 'Fahrt'}</span>
                <span>{Math.round(r.durationS / 60)} Min.</span>
                <span className="muted">{RATING[state.feedback[r.rideId]] ?? ''}</span>
              </button>
              {open === r.rideId && (
                <div className="ride-detail">
                  {(() => {
                    const progress = rideProgress(r, state.summaries);
                    return progress && <p className="progress-line" data-testid="progress">{progressText(progress)}</p>;
                  })()}
                  <p className="muted">
                    {r.avgHrBpm === null ? '' : `Puls bis ${r.maxHrBpm}. `}
                    {r.intervalsPlanned ? `${r.intervalsDone} von ${r.intervalsPlanned} harten Abschnitten geschafft. ` : ''}
                    {r.onTargetPct === undefined ? '' : `${r.onTargetPct} % der Zeit nah an der Vorgabe. `}
                    {r.status === 'aborted' ? 'Vorzeitig beendet. ' : ''}
                    {r.suspectData ? 'Viele Messfehler, zählt nicht für Bestwerte. ' : ''}
                    Die FIT-Datei für Garmin liegt unter rides/exports.
                  </p>
                  <GarminUploadButton ride={r} status={uploadSettings(state).rides[r.rideId]} connected={garminConnected} onUpload={(repoLink) => send({ type: 'garmin-upload', profileId: state.profileId, rideId: r.rideId, repoLink })} />
                  {state.debriefs?.[r.rideId] && <DebriefCard debrief={state.debriefs[r.rideId]} thinking={false} />}
                  {detail?.rideId === r.rideId ? (
                    <RideCharts detail={detail} />
                  ) : <p className="muted">Lädt…</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
};
