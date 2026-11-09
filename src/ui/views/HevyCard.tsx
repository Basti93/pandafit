import { useState } from 'react';
import type { CoachClientMessage, HevyStatus } from '../../coach/protocol';
import { BO } from '../../shared/bo';
import { COACH_LABEL } from '../../shared/tasks';

const REASON = {
  invalid: 'Dieser Schlüssel funktioniert nicht. Bitte prüfen, ob er vollständig ist und ob Hevy Pro aktiv ist.',
  expired: 'Der Schlüssel gilt nicht mehr. Bitte einen neuen eintragen, deine Workouts bleiben solange hier.',
  failed: 'Hevy ist gerade nicht erreichbar. Bitte später erneut versuchen.',
} as const;

const syncText = (status: Extract<HevyStatus, { state: 'connected' }>): string => {
  const parts = [`${status.workouts} Workouts`];
  if (status.loading) parts.push('Verlauf wird noch geladen');
  else if (status.lastSyncMs) {
    const at = new Date(status.lastSyncMs);
    parts.push(`Zuletzt aktualisiert: ${at.toLocaleDateString('de-DE')} ${at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`);
  }
  return parts.join(' · ');
};

/** Optional, each profile with its own key. The key stays in the form only until it is submitted. */
export const HevyCard = ({ profileId, status, send }: { profileId: string; status: HevyStatus; send: (m: CoachClientMessage) => void }) => {
  const [key, setKey] = useState('');
  const [separated, setSeparated] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  if (status.state === 'connecting') return <section className="card garmin" role="status">Hevy wird verbunden…</section>;
  if (status.state === 'connected') {
    return (
      <details className="card garmin-later">
        <summary><span className="dot on">Hevy verbunden</span></summary>
        <p className="muted">{syncText(status)}</p>
        <p className="muted">{BO.name} sieht dein Krafttraining und plant damit. Eine Routine legt er nur nach deiner Bestätigung an. Beim Trennen werden Schlüssel und Workouts von diesem Mac gelöscht, bei Hevy bleibt alles.</p>
        <button className="ghost" onClick={() => { setSeparated(true); send({ type: 'hevy-disconnect', profileId }); }}>Trennen</button>
      </details>
    );
  }
  return (
    <details className="card garmin-later" open={status.state === 'failed'}>
      <summary>Hevy verbinden (optional)</summary>
      <form className="form garmin-form" onSubmit={(e) => {
        e.preventDefault();
        if (!key.trim()) return;
        send({ type: 'hevy-connect', profileId, key: key.trim() });
        setKey('');
      }}>
        {status.state === 'failed' && <p className="notice" role="alert">{REASON[status.reason]}</p>}
        <p className="muted">{BO.name} sieht dann dein Krafttraining, zum Beispiel schwere Beine vom Vortag. Dafür brauchst du Hevy Pro. Den Schlüssel findest du unter <a href="https://hevy.com/settings?developer" target="_blank" rel="noreferrer">hevy.com, Einstellungen, Developer</a>.</p>
        <label>API-Schlüssel<input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></label>
        <button type="submit">Verbinden</button>
        {separated && !forgotten && (
          <div className="row">
            <p className="muted">Die {COACH_LABEL.gym} behält ihr Gedächtnis, falls du Hevy wieder verbindest.</p>
            <button type="button" className="ghost" onClick={() => { setForgotten(true); send({ type: 'gym-forget', profileId }); }}>Gedächtnis löschen</button>
          </div>
        )}
        {forgotten && <p className="muted">Das Gedächtnis der {COACH_LABEL.gym} ist gelöscht.</p>}
        <p className="muted">Der Schlüssel bleibt nur auf diesem Mac. Pandafit liest dein Training. Eine Routine legt er in Hevy nur nach deiner Bestätigung an, bestehende Routinen bleiben unberührt.</p>
      </form>
    </details>
  );
};
