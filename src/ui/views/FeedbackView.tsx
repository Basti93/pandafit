import { ZoneChip } from '../hr-zone-style';
import { useEffect } from 'react';
import type { RideSummary } from '../../coach/metrics';
import { progressText, rideProgress } from '../../coach/progress';
import type { Together } from '../../coach/together';
import type { CoachClientMessage, RideDetail } from '../../coach/protocol';
import type { RideDebrief } from '../../coach/debrief';
import type { CoachState } from '../../coach/state';
import { DebriefCard, debriefHandlers } from './DebriefCard';
import type { GarminUploadSettings } from '../../coach/garmin-upload';
import { GarminUploadButton } from './GarminUploadButton';
import { PandaMark } from './PandaMark';
import { RideCharts } from './RideCharts';

type Props = {
  profileId: string; rideId: string; send: (m: CoachClientMessage) => void; together?: Together | null;
  summary?: RideSummary; summaries?: RideSummary[]; detail: RideDetail | null;
  debrief?: RideDebrief; debriefing?: boolean; next?: CoachState['next'];
  garminConnected?: boolean; upload?: GarminUploadSettings;
};

const value = (v: number | null, unit: string) => (v === null ? '–' : `${v} ${unit}`);

/** First show how the ride went, then ask how it felt. */
export const FeedbackView = ({ profileId, rideId, send, together, summary, summaries = [], detail, debrief, debriefing = false, next, garminConnected = false, upload }: Props) => {
  const progress = summary ? rideProgress(summary, summaries) : null;
  const summit = summary && together?.summits?.filter((s) => s.atMs === summary.startedAtMs).at(-1);
  // Without send in the dependencies: useCoach returns a new one on every render, and the response would re-request endlessly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { send({ type: 'ride-detail', profileId, rideId }); }, [profileId, rideId]);
  const rate = (rating: 'easy' | 'right' | 'hard') => send({ type: 'feedback', profileId, rideId, rating });
  return (
    <main>
      <PandaMark small />
      <p className="muted">Schön gemacht, deine Fahrt ist gespeichert.{together ? ` Das waren ${together.lastRideMetres} Höhenmeter auf dem Weg zum ${together.peak.name}.` : ''}</p>
      {summary && (
        <>
          <h1>{summary.sessionName ?? 'Deine Fahrt'}</h1>
 {summit && <p className="progress-line" data-testid="summit">🏔 Gipfel! Ihr habt gemeinsam {summit.name} erreicht.</p>}
          {progress && <p className="progress-line" data-testid="progress">{progressText(progress)}</p>}
          <div className="stat-row">
            <div className="tile"><span className="label">Dauer</span><b>{Math.round(summary.durationS / 60)} Min.</b></div>
            <div className="tile"><span className="label">Leistung im Schnitt</span><b>{value(summary.avgPowerW, 'W')}</b></div>
            <div className="tile"><span className="label">Puls im Schnitt</span><b>{value(summary.avgHrBpm, 'bpm')}</b></div>
            <div className="tile"><span className="label">Höchster Puls</span><b>{value(summary.maxHrBpm, 'bpm')}</b></div>
          </div>
        </>
      )}
      {detail?.rideId === rideId && <section className="card"><RideCharts detail={detail} /></section>}
      {summary?.hrZoneMinutes && <p className="muted" data-testid="ride-zones">Minuten je Pulszone: {summary.hrZoneMinutes.map((m, i) => <span key={i}>{i > 0 && ' · '}<ZoneChip zone={i + 1}>{i + 1}</ZoneChip>: {m}</span>)}{summary.hrTargetPct === undefined ? '' : `. ${summary.hrTargetPct} % der Zeit im Ziel oder darunter.`}</p>}
      {debrief && <DebriefCard debrief={debrief} next={next} thinking={debriefing} {...debriefHandlers(profileId, rideId, send)} />}
      {summary && upload && upload.mode !== 'off' && <GarminUploadButton ride={summary} status={upload.rides[rideId]} connected={garminConnected} onUpload={(repoLink) => send({ type: 'garmin-upload', profileId, rideId, repoLink })} />}
      <h2>Wie war’s heute?</h2>
      <div className="choices">
        <button className="choice" onClick={() => rate('easy')}><span aria-hidden="true">🌱 </span>Zu leicht</button>
        <button className="choice" onClick={() => rate('right')}><span aria-hidden="true">🍂 </span>Genau richtig</button>
        <button className="choice" onClick={() => rate('hard')}><span aria-hidden="true">🔥 </span>Zu hart</button>
      </div>
      <button className="ghost" onClick={() => send({ type: 'skip-feedback', profileId })}>Überspringen</button>
    </main>
  );
};
