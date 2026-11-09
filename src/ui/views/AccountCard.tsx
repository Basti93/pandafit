import { useState } from 'react';
import { MovingNote } from './CoachHomeNote';
import type { AccountStatus, CoachClientMessage, CoachHome } from '../../coach/protocol';

const REASON = {
  invalid: 'Name oder Passwort stimmen nicht. Bitte noch einmal prüfen.',
  limited: 'Es gab zu viele Versuche. Bitte in ein paar Minuten noch einmal probieren.',
  url: 'Die Adresse muss mit https:// beginnen.',
  failed: 'Der Server ist gerade nicht erreichbar. Bitte später erneut versuchen.',
} as const;

const syncText = (s: AccountStatus): string => {
  if (s.offline) return 'Der Server ist gerade nicht erreichbar. Alles bleibt sicher auf diesem Mac und wird später nachgereicht.';
  if (!s.lastSyncMs) return 'Der erste Abgleich folgt gleich.';
  const at = new Date(s.lastSyncMs);
  return `Zuletzt abgeglichen: ${at.toLocaleDateString('de-DE')} ${at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Optional, each profile with its own account. The password stays in the form only until it is submitted and is never stored. */
export const AccountCard = ({ profileId, status, send, coachHome }: { profileId: string; status: AccountStatus; send: (m: CoachClientMessage) => void; coachHome?: CoachHome }) => {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  if (status.state === 'linking') return <section className="card garmin" role="status">Konto wird verbunden…</section>;
  if (status.state === 'linked' || status.state === 'rejected') {
    return (
      <details className="card garmin-later" open={status.state === 'rejected'}>
        <summary><span className={status.state === 'linked' ? 'dot on' : 'dot'}>Konto: {status.name}</span></summary>
        {status.state === 'rejected'
          ? <p className="notice" role="status">Der Server erkennt dieses Gerät nicht mehr. Bitte das Konto neu verbinden. Deine Daten bleiben solange hier.</p>
          : <p className="muted">{syncText(status)}</p>}
        {coachHome && <MovingNote coachHome={coachHome} />}
        {status.refused > 0 && <p className="notice" role="status">Ein Eintrag wurde vom Server nicht angenommen. Er bleibt sicher auf diesem Mac gespeichert.</p>}
        <p className="muted">Dein Training wird mit deinem Pandafit-Konto abgeglichen, damit du es auch am Handy siehst. Beim Trennen bleiben alle Daten auf diesem Mac.</p>
        <button className="ghost" onClick={() => send({ type: 'account-unlink', profileId })}>Trennen</button>
      </details>
    );
  }
  return (
    <details className="card garmin-later" open={status.state === 'failed'}>
      <summary>Pandafit-Konto verbinden (optional)</summary>
      <form className="form garmin-form" onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim() || !name.trim() || !password) return;
        send({ type: 'account-link', profileId, url: url.trim(), name: name.trim(), password });
        setPassword('');
      }}>
        {status.state === 'failed' && status.reason && <p className="notice" role="alert">{REASON[status.reason]}</p>}
        <p className="muted">Mit einem Konto siehst du dein Training auch im Browser und am Handy. Ohne Konto läuft alles wie bisher nur auf diesem Mac.</p>
        <label>Adresse des Servers<input type="url" autoComplete="off" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label>Name<input type="text" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Passwort<input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button type="submit">Verbinden</button>
        <p className="muted">Das Passwort wird nur einmal gesendet und nicht gespeichert. Dieser Mac bekommt dafür einen eigenen Zugang, den du hier jederzeit trennen kannst.</p>
      </form>
    </details>
  );
};
