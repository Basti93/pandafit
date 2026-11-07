import { useState } from 'react';
import { ACTIVITY_LEVELS, estimateFtp, type Sex } from '../../shared/ftp-estimate';
import type { Profile } from '../../shared/profiles';

const GARMIN_START_FTP_W = 100;

const ProfileForm = ({ onAdd }: { onAdd: (p: Profile) => void }) => {
  const [name, setName] = useState('');
  const [known, setKnown] = useState(false);
  const [ftp, setFtp] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex>('unknown');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [activity, setActivity] = useState(2);
  const [run, setRun] = useState('');
  const [maxHr, setMaxHr] = useState('');
  const complete = Number(age) >= 14 && Number(age) <= 95 && Number(height) >= 120 && Number(height) <= 230 && Number(weight) >= 30 && Number(weight) <= 250;
  const estimate = !known && complete
    ? estimateFtp({ age: Number(age), sex, heightCm: Number(height), weightKg: Number(weight), activity, ...(Number(run) >= 12 ? { run5kMin: Number(run) } : {}) })
    : null;
  const ftpW = known ? Number(ftp) : estimate?.startW ?? 0;
  const ready = name.trim() !== '' && ftpW >= 50;
  const add = () => onAdd({
    id: crypto.randomUUID(), name: name.trim(), ftpW,
    ...(Number(maxHr) > 0 ? { maxHrBpm: Number(maxHr) } : {}),
    ...(estimate ? { ftpCapW: estimate.capW } : {}),
  });
  return (
    <form className="card form" onSubmit={(e) => { e.preventDefault(); if (ready) add(); }}>
      <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="row">
        <button type="button" className={known ? 'secondary' : ''} onClick={() => setKnown(false)}>FTP schätzen</button>
        <button type="button" className={known ? '' : 'secondary'} onClick={() => setKnown(true)}>Ich kenne meine FTP</button>
      </div>
      {known ? (
        <label>FTP in Watt<input type="number" min="50" value={ftp} onChange={(e) => setFtp(e.target.value)} /></label>
      ) : (
        <>
          <div className="form-row">
            <label>Alter<input type="number" value={age} onChange={(e) => setAge(e.target.value)} /></label>
            <label>Größe (cm)<input type="number" value={height} onChange={(e) => setHeight(e.target.value)} /></label>
            <label>Gewicht (kg)<input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} /></label>
          </div>
          <label>Geschlecht (Teil der Formel)
            <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
              <option value="unknown">Keine Angabe (vorsichtigere Schätzung)</option>
              <option value="female">Frau</option>
              <option value="male">Mann</option>
            </select>
          </label>
          <label>Wie aktiv warst du in den letzten Wochen?
            <select value={activity} onChange={(e) => setActivity(Number(e.target.value))}>
              {ACTIVITY_LEVELS.map((t, i) => <option key={i} value={i}>{t}</option>)}
            </select>
          </label>
          <label>5-km-Lauf in den letzten 6 Monaten, Minuten (optional)<input type="number" value={run} onChange={(e) => setRun(e.target.value)} /></label>
          {estimate && (
            <p className="notice">Wir starten vorsichtig mit <b>{estimate.startW} W</b>, rechnerisch eher um {estimate.likelyW} W. Die Schätzung kann um mehr als 20 % danebenliegen, deine Bewertungen korrigieren sie nach den Fahrten.</p>
          )}
        </>
      )}
      <label>Pulsgrenze (optional)<input type="number" min="80" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} /></label>
      <p className="muted">Bei Beschwerden wie Brustschmerz oder Schwindel, oder bei bekannter Herz-Kreislauf-Erkrankung vor dem Training ärztlich abklären.</p>
      <button type="submit" disabled={!ready}>Profil anlegen</button>
      {/* Cautious placeholder until Garmin values are confirmed or entered. */}
      <button type="button" className="secondary" disabled={name.trim() === ''} onClick={() => onAdd({ id: crypto.randomUUID(), name: name.trim(), ftpW: GARMIN_START_FTP_W })}>Mit Garmin ausfüllen</button>
    </form>
  );
};

export const ProfileView = ({ profiles, onPick, onAdd }: { profiles: Profile[]; onPick: (p: Profile) => void; onAdd: (p: Profile) => void }) => {
  const [adding, setAdding] = useState(false);
  const showForm = adding || profiles.length === 0;
  return (
    <main className="center">
      <h1>{profiles.length ? 'Wer fährt heute?' : 'Schön, dass du da bist'}<span className="leaf" aria-hidden="true">🍂</span></h1>
      {profiles.length > 0 && (
        <div className="choices">
          {profiles.map((p) => <button key={p.id} className="choice" onClick={() => onPick(p)}>{p.avatar && <span aria-hidden="true">{p.avatar} </span>}{p.name}</button>)}
        </div>
      )}
      {showForm
        ? <ProfileForm onAdd={(p) => { onAdd(p); setAdding(false); }} />
        : (
          <div className="row">
            <button className="ghost" onClick={() => setAdding(true)}>Neues Profil</button>
          </div>
        )}
    </main>
  );
};
