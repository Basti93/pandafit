import { useState } from 'react';
import { HeadCard, Row, RowList, Segments, Sheet } from '../../tracking/ui/kit';
import { CoachPrefs } from '../../tracking/ui/CoachPrefs';
import { timeLabel } from '../../shared/dates';
import { bikeOf, hasBike as bikeVisible, ridesOf, RunSettingsCard } from '../../tracking/ui';
import { usePortRecords, useSyncState } from '../../tracking/ui/hooks';
import { useApp } from '../AppContext';
import { ContactSettings } from '../ContactSettings';
import { ConnectionSettings, ProfileGroup } from '../ConnectionSettings';
import { readTheme, saveTheme, type Theme } from '../theme';
import { CoachLink } from '../coachLink';
import { Env } from './env';
import { PushState, PushSettings } from './Push';

export const syncText = (status: 'ok' | 'login' | 'offline', c: { pending: number; lastOkMs: number | null; refused?: number }): string => {
  if (status === 'login') return 'Bitte melde dich neu an. Bis dahin bleibt alles auf diesem Gerät.';
  if (status === 'offline') return `Gerade gibt es keine Verbindung. Alles bleibt auf diesem Gerät.${c.lastOkMs === null ? '' : ` Zuletzt gesichert um ${timeLabel(c.lastOkMs)}.`}`;
  if ((c.refused ?? 0) > 0) return 'Ein Eintrag wurde nicht angenommen. Er bleibt auf diesem Gerät.';
  if (c.pending > 0) return c.pending === 1 ? 'Ein Eintrag wartet aufs Senden.' : `${c.pending} Einträge warten aufs Senden.`;
  if (c.lastOkMs === null) return 'Der erste Abgleich folgt gleich.';
  return 'Alles ist gesichert.';
};

const QUIET = 'Alles ist gesichert.';

/** The account on this device, a few switches, the coach's timing, and the way out. */
export function Profil({ now, status, onLogout, push, link, storage }: { link: CoachLink | null; now: () => number; status: 'ok' | 'login' | 'offline'; onLogout: () => void; push: PushState | null; storage: Env['storage'] }) {
  const { port, account } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [timing, setTiming] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => readTheme(storage));
  const pickTheme = (t: Theme) => { saveTheme(storage, t); setTheme(t); };
  const hasBike = bikeVisible(bikeOf(usePortRecords(port, 'bike').records), ridesOf(usePortRecords(port, 'ride').records));
  const c = useSyncState(port);
  const tryLogout = () => { if (c.pending > 0 || (c.refused ?? 0) > 0) setConfirming(true); else onLogout(); };
  const sync = syncText(status, c);
  const quiet = sync === QUIET;
  return (
    <div className="tk-screen">
      <h1 className="tk-sr">Profil</h1>
      <HeadCard icon="profil" level={2} title={account} text={quiet ? sync : <span role="status">{sync}</span>} />
      <ConnectionSettings link={link} hasBike={hasBike} plan={<RunSettingsCard port={port} now={now} />} />
      <ProfileGroup title="Nachrichten">
        <ContactSettings port={port} now={now} />
        {push && <PushSettings push={push} now={now} />}
        {/* The coach's timing is about notifications: it shows once they are on (always where the shell has no push at all). */}
        {(!push || push.on) && <RowList><Row icon="laterne" title="Wann sich der Sensai meldet" hint="Wochengespräch und Gruß am Vorabend." onClick={() => setTiming(true)} /></RowList>}
      </ProfileGroup>
      {timing && <Sheet title="Wann sich der Sensai meldet" onClose={() => setTiming(false)}><CoachPrefs port={port} now={now} nested /></Sheet>}
      <ProfileGroup title="Darstellung">
        <Segments label="Darstellung" value={theme} onChange={pickTheme} options={[{ value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }, { value: 'system', label: 'System' }]} />
        <p className="muted">Mit „System“ folgt Pandafit der Einstellung deines Geräts. Die Wahl gilt nur auf diesem Gerät.</p>
      </ProfileGroup>
      {confirming ? (
        <p role="status" className="tk-note">
          Einiges ist noch nicht gesendet. Es bleibt auf diesem Gerät gespeichert und geht beim nächsten Anmelden raus.
          <button type="button" className="secondary" onClick={onLogout}>Trotzdem abmelden</button>
          <button type="button" className="link" onClick={() => setConfirming(false)}>Doch nicht</button>
        </p>
      ) : <button type="button" className="secondary tk-wide" onClick={tryLogout}>Abmelden</button>}
    </div>
  );
}
