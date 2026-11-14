import { createContext, useContext, useEffect, useState } from 'react';
import { REPO_DESCRIPTION, STRENGTH_ACTIVITY_NAME, type RideUpload } from '../../shared/garmin-upload';
import { reasonText, repoLinkStored, storeRepoLink } from '../../shared/garmin-upload-ui';
import type { LoggedWorkout } from '../../shared/records';

type Shown = { id: string; startMs: number; endMs: number };

const Preview = ({ workout, onConfirm, onCancel }: { workout: Shown; onConfirm: (repoLink: boolean) => void; onCancel: () => void }) => {
  const [repoLink, setRepoLink] = useState(repoLinkStored);
  const toggle = (on: boolean) => { setRepoLink(on); storeRepoLink(on); };
  const started = new Date(workout.startMs);
  const rows: [string, string][] = [
    ['Name', STRENGTH_ACTIVITY_NAME],
    ['Start', `${started.toLocaleDateString('de-DE')} ${started.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`],
    ['Dauer', `${Math.max(1, Math.round((workout.endMs - workout.startMs) / 60000))} Min.`],
  ];
  return (
    <div className="card tk-garmin-preview" role="dialog" aria-label="Vorschau für Garmin">
      <h3>Das geht an dein Garmin-Konto</h3>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="muted">Garmin bekommt nur die Sportart, den Start und die Dauer, keine Übungen. Hat deine Uhr das Training aufgezeichnet, steht es danach doppelt in Garmin Connect.</p>
      <label className="tk-garmin-repo"><input type="checkbox" checked={repoLink} onChange={(e) => toggle(e.target.checked)} /> Link zum Projekt in die Beschreibung</label>
      {repoLink && <p className="muted">Beschreibung: {REPO_DESCRIPTION}</p>}
      <div className="row">
        <button type="button" onClick={() => onConfirm(repoLink)}>Jetzt hochladen</button>
        <button type="button" className="link" onClick={onCancel}>Abbrechen</button>
      </div>
    </div>
  );
};

/** Nothing goes up on the first click: the person sees what would go and confirms it. */
export const GarminWorkoutUpload = ({ workout, status, connected, mode, onUpload }: { workout: Shown; status?: RideUpload; connected: boolean; mode: 'off' | 'ask'; onUpload: (repoLink: boolean) => void }) => {
  const [previewing, setPreviewing] = useState(false);
  if (!connected || mode === 'off') return null;
  if (status?.status === 'uploading') return <button type="button" className="secondary" disabled>Wird hochgeladen …</button>;
  if (status?.status === 'uploaded') return <button type="button" className="secondary" disabled>Bei Garmin</button>;
  if (previewing) return <Preview workout={workout} onConfirm={(repoLink) => { setPreviewing(false); onUpload(repoLink); }} onCancel={() => setPreviewing(false)} />;
  if (status?.status === 'failed') {
    return (
      <div className="tk-garmin-upload">
        <p className="notice" role="alert">{reasonText(status.reason)}</p>
        <button type="button" className="secondary" onClick={() => setPreviewing(true)}>Erneut versuchen</button>
      </div>
    );
  }
  return <button type="button" className="secondary" onClick={() => setPreviewing(true)}>Zu Garmin hochladen</button>;
};

/** What the app shell knows about the Garmin link; the screens read it here so they need no link of their own. */
export type GarminUploadAccess = {
  connected: boolean;
  mode: 'off' | 'ask';
  workouts: Record<string, RideUpload>;
  /** Keeps the link open while a button is shown, so the status arrives. Returns the release. */
  hold: () => () => void;
  /** True when the message went out. */
  upload: (workoutId: string, repoLink: boolean) => Promise<boolean>;
};
export const GarminUploadContext = createContext<GarminUploadAccess | null>(null);

/** The button for one finished Pandafit workout; nothing for a Hevy workout, an open one, or without the web link. */
export function GarminWorkoutUploadFor({ workout }: { workout: Pick<LoggedWorkout, 'id' | 'source' | 'startMs' | 'endMs'> | null }) {
  const access = useContext(GarminUploadContext);
  const [offline, setOffline] = useState(false);
  const shown = !!access && access.connected && access.mode === 'ask' && workout?.source === 'pandafit' && workout.endMs !== null;
  const hold = access?.hold;
  useEffect(() => (shown && hold ? hold() : undefined), [shown, hold]);
  if (!access || !shown || !workout || workout.endMs === null) return null;
  return (
    <>
      {offline && <p className="notice" role="alert">Pandafit erreicht gerade den Server nicht. Versuch es gleich noch einmal.</p>}
      <GarminWorkoutUpload workout={{ id: workout.id, startMs: workout.startMs, endMs: workout.endMs }} connected={access.connected} mode={access.mode}
        status={access.workouts[workout.id]} onUpload={(repoLink) => { setOffline(false); void access.upload(workout.id, repoLink).then((ok) => setOffline(!ok)); }} />
    </>
  );
}
