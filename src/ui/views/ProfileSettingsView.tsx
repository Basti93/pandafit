import { ZoneChip } from '../hr-zone-style';
import { useState, type ReactNode } from 'react';
import type { CoachClientMessage, CoachHome } from '../../coach/protocol';
import type { ClientMessage } from '../../shared/protocol';
import { hrMaxFor, zoneBounds, ZONES } from '../../shared/hr-zones';
import type { Profile } from '../../shared/profiles';

const AVATARS = ['🐼', '🐭', '🦊', '🐻', '🐰', '🐨', '🦉', '🐢'];
const number = (text: string): number => Number(text.trim().replace(',', '.'));
const outside = (text: string, min: number, max: number): boolean => text.trim() !== '' && !(number(text) >= min && number(text) <= max);
const ageOf = (birthDate: string): number => (Date.now() - Date.parse(birthDate)) / (365.25 * 86_400_000);
const text = (n: number | undefined): string => (n === undefined ? '' : String(n));

type Props = {
  profile: Profile; ftpW: number; coachConnected: boolean;
  sendRide: (m: ClientMessage) => void; sendCoach: (m: CoachClientMessage) => void; onBack: () => void; onDeleted?: () => void;
  /** Further sections of the profile page: settings and connections. */
  extra?: ReactNode;
  coachHome?: CoachHome;
};

/** What you enter applies here: Garmin never overwrites these values on its own. */
export const ProfileSettingsView = ({ profile, ftpW, coachConnected, sendRide, sendCoach, onBack, onDeleted, extra, coachHome }: Props) => {
  const [name, setName] = useState(profile.name);
  const [ftp, setFtp] = useState(String(ftpW));
  const [maxHr, setMaxHr] = useState(text(profile.maxHrBpm));
  const [hrMaxText, setHrMax] = useState(text(profile.hrMaxBpm));
  const [birthDate, setBirthDate] = useState(profile.birthDate ?? '');
  const [sex, setSex] = useState(profile.sex ?? 'unknown');
  const [height, setHeight] = useState(text(profile.heightCm));
  const [weight, setWeight] = useState(text(profile.weightKg));
  const [avatar, setAvatar] = useState(profile.avatar ?? '');
  const [deleting, setDeleting] = useState(false);

  const invalid = [
    name.trim() === '' && 'Name',
    !(number(ftp) >= 50) && 'FTP (ab 50 W)',
    outside(maxHr, 80, 240) && 'Pulsgrenze (80 bis 240)',
    outside(hrMaxText, 100, 240) && 'Maximalpuls (100 bis 240)',
    birthDate !== '' && !(ageOf(birthDate) >= 14 && ageOf(birthDate) <= 100) && 'Geburtsdatum (ab 14 Jahren)',
    outside(height, 120, 230) && 'Größe (120 bis 230 cm)',
    outside(weight, 30, 250) && 'Gewicht (30 bis 250 kg)',
  ].filter((x): x is string => typeof x === 'string');
  const ftpChanged = number(ftp) !== ftpW;
  const zones = hrMaxFor({ ...(hrMaxText.trim() && number(hrMaxText) >= 100 ? { hrMaxBpm: number(hrMaxText) } : {}), ...(birthDate ? { birthDate } : {}) }, Date.now());

  const save = () => {
    if (invalid.length) return;
    // Deliberately built from the existing profile: unknown fields and the ID are preserved.
    const next: Profile = { ...profile, name: name.trim(), sex };
    for (const key of ['avatar', 'maxHrBpm', 'hrMaxBpm', 'birthDate', 'heightCm', 'weightKg'] as const) delete next[key];
    if (avatar) next.avatar = avatar;
    if (maxHr.trim()) next.maxHrBpm = number(maxHr);
    if (hrMaxText.trim()) next.hrMaxBpm = number(hrMaxText);
    if (birthDate) next.birthDate = birthDate;
    if (height.trim()) next.heightCm = number(height);
    if (weight.trim()) next.weightKg = number(weight);
    if (ftpChanged) {
      next.ftpW = number(ftp);
      // The upper limit applies only to the estimate and would otherwise later push down a measured value.
      delete next.ftpCapW;
      sendCoach({ type: 'set-ftp', profileId: profile.id, ftpW: number(ftp) });
    }
    if (coachHome?.where === 'server') sendCoach({ type: 'profile-update', profileId: profile.id, profile: next });
    sendRide({ type: 'save-profile', profile: next });
    onBack();
  };

  return (
    <main className="profile-page">
      <div className="top"><h1>Dein Profil</h1></div>
      <form className="card form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Profilbild
          <select value={avatar} onChange={(e) => setAvatar(e.target.value)}>
            <option value="">Keins</option>
            {AVATARS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Geburtsdatum<input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></label>
        <label>Geschlecht
          <select value={sex} onChange={(e) => setSex(e.target.value as typeof sex)}>
            <option value="unknown">Keine Angabe</option>
            <option value="female">Frau</option>
            <option value="male">Mann</option>
          </select>
        </label>
        <div className="form-row">
          <label>Größe (cm)<input inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
          <label>Gewicht (kg)<input inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
        </div>
        <div className="form-row">
          <label>FTP in Watt<input inputMode="numeric" disabled={!coachConnected} value={ftp} onChange={(e) => setFtp(e.target.value)} /></label>
          <label>Pulsgrenze<input inputMode="numeric" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} /></label>
        </div>
        <label>Maximalpuls (leer: aus dem Alter geschätzt)<input inputMode="numeric" value={hrMaxText} onChange={(e) => setHrMax(e.target.value)} /></label>
        {zones && (
          <p className="muted" data-testid="hr-zones">
            Pulszonen{zones.estimated ? ', geschätzt, rund ±10 Schläge' : ''}: {ZONES.map((z, i) => { const b = zoneBounds(z, zones.bpm); return <span key={z}>{i > 0 && ' · '}<ZoneChip zone={z}>{z}</ZoneChip>: {b.fromBpm}–{b.toBpm}</span>; })}
          </p>
        )}
        {ftpChanged && !invalid.length && <p className="notice" role="status">Mit der neuen FTP plant der Coach deine nächste Einheit neu.</p>}
        {invalid.length > 0 && <p className="notice" role="alert">Bitte prüfen: {invalid.join(', ')}.</p>}
        <p className="muted">Bei Beschwerden wie Brustschmerz oder Schwindel, oder bei bekannter Herz-Kreislauf-Erkrankung vor dem Training ärztlich abklären.</p>
        <div className="row">
          <button type="submit" disabled={invalid.length > 0}>Speichern</button>
          <button type="button" className="secondary" onClick={onBack}>Abbrechen</button>
        </div>
      </form>
      {extra}
      <section className="card">
        {deleting ? (
          <>
            <p className="notice" role="alert">Profil „{profile.name}“ wirklich löschen? Deine Fahrten bleiben auf der Festplatte erhalten, erscheinen aber nicht mehr in der App.</p>
            <div className="row">
              <button type="button" onClick={() => { sendRide({ type: 'delete-profile', profileId: profile.id }); onDeleted?.(); }}>Ja, Profil löschen</button>
              <button type="button" className="secondary" onClick={() => setDeleting(false)}>Behalten</button>
            </div>
          </>
        ) : <button type="button" className="ghost" onClick={() => setDeleting(true)}>Profil löschen</button>}
      </section>
    </main>
  );
};
