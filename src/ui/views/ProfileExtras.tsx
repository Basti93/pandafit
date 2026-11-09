import type { ReactNode } from 'react';
import type { GarminUploadSettings } from '../../shared/garmin-upload';
import type { AccountStatus, CoachClientMessage, CoachHome, GarminStatus, GarminSyncInfo, HevyStatus } from '../../coach/protocol';
import { AccountCard } from './AccountCard';
import { GarminCard } from './GarminCard';
import { HevyCard } from './HevyCard';

const NO_ACCOUNT: AccountStatus = { state: 'idle', name: null, reason: null, refused: 0, offline: false, lastSyncMs: null };

type Props = {
  profileId: string; coachConnected: boolean; send: (m: CoachClientMessage) => void;
  garmin: GarminStatus; garminSync?: GarminSyncInfo | null; upload?: GarminUploadSettings;
  hevy?: HevyStatus; account?: AccountStatus; coachHome?: CoachHome;
  /** The language toggle and anything else that only concerns this profile. */
  settings?: ReactNode;
};

/**
 * The profile page's own sections. Hevy and Garmin are set here only while this Mac's own coach does the work; for a profile whose
 * coach runs on the server they are set in the web app (Profil). The account link is always here.
 */
export const ProfileExtras = ({ profileId, coachConnected, send, garmin, garminSync, upload, hevy, account, coachHome, settings }: Props) => {
  const onServer = coachHome?.where === 'server';
  const linked = (account ?? NO_ACCOUNT).state !== 'idle' || coachHome?.where === 'moving';
  return (
    <>
      {settings && (
        <section className="card profile-settings">
          <h3>Einstellungen</h3>
          <div className="row">{settings}</div>
        </section>
      )}
      <section className="connections" aria-label="Verbindungen">
        <h2>Verbindungen</h2>
        {!linked && <p className="muted">Kraft, Laufen, Essen und den Rückblick gibt es in der Web-App. Verbinde dafür dein Konto.</p>}
        {!coachConnected ? <p className="notice" role="status">Der Coach ist gerade nicht erreichbar. Sobald er wieder da ist, kannst du hier verbinden.</p> : (
          <>
            {onServer ? <p className="muted">Hevy, Garmin, Krafttraining und Essensplan stellst du in der Web-App unter Profil ein.</p> : (
              <>
                {garmin.state === 'idle'
                  ? <details className="card garmin-later"><summary>Garmin verbinden (optional)</summary><GarminCard profileId={profileId} status={garmin} sync={garminSync} send={send} upload={upload} /></details>
                  : <GarminCard profileId={profileId} status={garmin} sync={garminSync} send={send} upload={upload} />}
                <HevyCard profileId={profileId} status={hevy ?? { state: 'idle' }} send={send} />
              </>
            )}
            <AccountCard profileId={profileId} status={account ?? NO_ACCOUNT} send={send} coachHome={coachHome} />
          </>
        )}
      </section>
    </>
  );
};
