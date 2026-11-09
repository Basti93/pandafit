import { useState } from 'react';
import { uploadSettings, type GarminUploadSettings, type UploadMode } from '../../shared/garmin-upload';
import type { CoachClientMessage, GarminStatus, GarminSyncInfo } from '../../coach/protocol';

const REASON: Record<string, string> = {
  credentials: 'Die Anmeldung wurde abgelehnt. Bitte E-Mail und Passwort prüfen.',
  'rate-limit': 'Garmin blockt gerade zu viele Anmeldeversuche. Bitte erst später erneut versuchen, frühes Wiederholen kann die Sperre verlängern.',
  setup: 'Das Garmin-Hilfsprogramm fehlt auf diesem Mac.',
  failed: 'Die Verbindung hat nicht geklappt. Bitte später erneut versuchen.',
};

const syncText = (sync: GarminSyncInfo): string => {
  const parts: string[] = [];
  if (sync.running) parts.push('Daten werden gerade geholt');
  else if (sync.lastRunMs) {
    const at = new Date(sync.lastRunMs);
    parts.push(`Zuletzt aktualisiert: ${at.toLocaleDateString('de-DE')} ${at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`);
  }
  if (!sync.complete && sync.problem === null) parts.push('Verlauf wird noch geladen');
  if (sync.problem === 'rate-limit') parts.push('Abruf pausiert: Garmin blockt gerade, es geht später von selbst weiter');
  if (sync.problem === 'failed') parts.push('Abruf gerade nicht möglich, es geht später von selbst weiter');
  return parts.join(' · ');
};

const MODES: [UploadMode, string][] = [['off', 'Aus'], ['ask', 'Jedes Mal fragen']];

/** What goes to Garmin is the rider's choice. Off until switched on, and never without a confirmation. */
const UploadChoice = ({ profileId, upload, send }: { profileId: string; upload?: GarminUploadSettings; send: (m: CoachClientMessage) => void }) => {
  const u = uploadSettings({ garminUpload: upload });
  return (
    <fieldset className="garmin-upload-choice">
      <legend>Fahrten zu Garmin hochladen</legend>
      {MODES.map(([mode, label]) => (
        <label key={mode}><input type="radio" name={`garmin-upload-${profileId}`} checked={u.mode === mode} onChange={() => send({ type: 'garmin-upload-settings', profileId, mode })} /> {label}</label>
      ))}
      {u.mode === 'ask' && <p className="muted">Nach jeder Fahrt siehst du eine Vorschau, hochgeladen wird nur nach deiner Bestätigung.</p>}
    </fieldset>
  );
};

/** Connects a profile to Garmin Connect. The password stays in the form only until it is submitted. */
export const GarminCard = ({ profileId, status, sync, send, upload }: { profileId: string; status: GarminStatus; sync?: GarminSyncInfo | null; send: (m: CoachClientMessage) => void; upload?: GarminUploadSettings }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const reauth = sync?.problem === 'reauth';
  if (status.state === 'connected' && !reauth) {
    return (
      <details className="card garmin-later">
        <summary><span className="dot on">Garmin verbunden</span></summary>
        {sync && <p className="muted" role="status">{syncText(sync)}</p>}
        <UploadChoice profileId={profileId} upload={upload} send={send} />
        <button className="ghost" onClick={() => send({ type: 'garmin-disconnect', profileId })}>Trennen</button>
      </details>
    );
  }
  if (status.state === 'connecting') return <section className="card garmin" role="status">Garmin wird verbunden…</section>;
  if (status.state === 'needs-mfa') {
    return (
      <form className="card form garmin-form" onSubmit={(e) => { e.preventDefault(); if (!code.trim()) return; send({ type: 'garmin-mfa', profileId, code: code.trim() }); setCode(''); }}>
        <label>Zwei-Faktor-Code<input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <button type="submit">Code senden</button>
      </form>
    );
  }
  return (
    <form className="card form garmin-form" onSubmit={(e) => {
      e.preventDefault();
      if (!email.trim() || !password) return;
      send({ type: 'garmin-login', profileId, email: email.trim(), password });
      setPassword('');
    }}>
      <h3>Garmin verbinden</h3>
      {reauth && <p className="notice" role="alert">Die Garmin-Anmeldung ist abgelaufen. Bitte erneut anmelden.</p>}
      {status.state === 'failed' && <p className="notice" role="alert">{REASON[status.reason]}</p>}
      <label>E-Mail<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button type="submit">Mit Garmin verbinden</button>
      <p className="muted">Inoffizieller Zugang, den Garmin jederzeit ändern kann. Das Passwort wird nicht gespeichert, nur ein Zugangstoken auf diesem Mac.</p>
    </form>
  );
};
