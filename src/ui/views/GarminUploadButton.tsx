import { useState } from 'react';
import { activityName, REPO_DESCRIPTION, type RideUpload } from '../../shared/garmin-upload';
import type { RideSummary } from '../../coach/metrics';

const REASON: Record<string, string> = {
  reauth: 'Die Garmin-Anmeldung ist abgelaufen, bitte neu anmelden.',
  'rate-limit': 'Garmin blockt gerade zu viele Anfragen, bitte später erneut versuchen.',
  'missing-file': 'Zu dieser Fahrt gibt es keine FIT-Datei.',
  failed: 'Das Hochladen hat nicht geklappt. Die Fahrt bleibt hier gespeichert.',
};

const REPO_KEY = 'bike-coach.garmin-repo-link';
const repoStored = (): boolean => { try { return localStorage.getItem(REPO_KEY) === 'on'; } catch { return false; } };

const Preview = ({ ride, onConfirm, onCancel }: { ride: RideSummary; onConfirm: (repoLink: boolean) => void; onCancel: () => void }) => {
  const [repoLink, setRepoLink] = useState(repoStored);
  const toggle = (on: boolean) => {
    setRepoLink(on);
    try { localStorage.setItem(REPO_KEY, on ? 'on' : 'off'); } catch { /* then it only applies now */ }
  };
  const started = new Date(ride.startedAtMs);
  const rows: [string, string | null][] = [
    ['Name', activityName(ride)],
    ['Start', `${started.toLocaleDateString('de-DE')} ${started.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`],
    ['Dauer', `${Math.round(ride.durationS / 60)} Min.`],
    ['Leistung im Schnitt', ride.avgPowerW === null ? null : `${ride.avgPowerW} W`],
    ['Puls im Schnitt', ride.avgHrBpm === null ? null : `${ride.avgHrBpm} bpm`],
    ['Höchster Puls', ride.maxHrBpm === null ? null : `${ride.maxHrBpm} bpm`],
    ['Datei', `${ride.rideId}.fit`],
  ];
  return (
    <div className="card garmin-preview" role="dialog" aria-label="Vorschau für Garmin">
      <h3>Das geht an dein Garmin-Konto</h3>
      <dl>{rows.flatMap(([k, v]) => (v === null ? [] : [<div key={k}><dt>{k}</dt><dd>{v}</dd></div>]))}</dl>
      <p className="muted">Die Datei enthält auch die Sekundenwerte der Fahrt. Hat deine Uhr dieselbe Fahrt aufgezeichnet, steht sie danach doppelt in Garmin Connect.</p>
      <label className="garmin-repo"><input type="checkbox" checked={repoLink} onChange={(e) => toggle(e.target.checked)} /> Link zum Projekt in die Beschreibung</label>
      {repoLink && <p className="muted">Beschreibung: {REPO_DESCRIPTION}</p>}
      <div className="row">
        <button onClick={() => onConfirm(repoLink)}>Jetzt hochladen</button>
        <button className="ghost" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
};

/** Nothing goes up on the first click: the rider sees what would go and confirms it. */
export const GarminUploadButton = ({ ride, status, connected, onUpload }: { ride: RideSummary; status?: RideUpload; connected: boolean; onUpload: (repoLink: boolean) => void }) => {
  const [previewing, setPreviewing] = useState(false);
  if (!connected) return null;
  if (status?.status === 'uploading') return <button className="secondary" disabled>Wird hochgeladen …</button>;
  if (status?.status === 'uploaded') return <button className="secondary" disabled>Bei Garmin</button>;
  if (previewing) return <Preview ride={ride} onConfirm={(repoLink) => { setPreviewing(false); onUpload(repoLink); }} onCancel={() => setPreviewing(false)} />;
  if (status?.status === 'failed') {
    return (
      <div className="garmin-upload">
        <p className="notice" role="alert">{REASON[status.reason ?? 'failed'] ?? REASON.failed}</p>
        <button className="secondary" onClick={() => setPreviewing(true)}>Erneut versuchen</button>
      </div>
    );
  }
  return <button className="secondary" onClick={() => setPreviewing(true)}>Zu Garmin hochladen</button>;
};
