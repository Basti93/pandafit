import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_MEAL_SETTINGS, SLOT_LABEL, SLOTS, type Diet, type Habit, type MealSettings } from '../shared/meals';
import type { GarminSyncInfo, HevyStatus } from '../shared/coach-protocol';
import { ChoiceRow, ConfirmLink, Row, RowList, Sheet, Switch } from '../tracking/ui/kit';
import type { CoachLink, CoachSettingsView } from './coachLink';

const DIETS: { value: Diet; label: string }[] = [{ value: 'vegetarisch', label: 'Vegetarisch' }, { value: 'vegan', label: 'Vegan' }, { value: 'alles', label: 'Alles' }];
const HABITS: { value: Habit; label: string }[] = [{ value: 'zuhause', label: 'zu Hause' }, { value: 'mitnehmen', label: 'zum Mitnehmen' }, { value: 'auswaerts', label: 'auswärts' }];
const HEVY_PROBLEM = { invalid: 'Der Schlüssel funktioniert nicht. Ist er vollständig und Hevy Pro aktiv?', expired: 'Der Schlüssel gilt nicht mehr. Bitte trag einen neuen ein.', failed: 'Hevy ist gerade nicht erreichbar.' } as const;
const GARMIN_PROBLEM: Record<string, string> = { credentials: 'E-Mail oder Passwort wurde abgelehnt.', 'rate-limit': 'Garmin blockt gerade zu viele Versuche. Versuch es bitte später nochmal.', setup: 'Das Garmin-Hilfsprogramm fehlt auf dem Server.', failed: 'Das hat nicht geklappt. Versuch es bitte später nochmal.' };
const SENT_NO = 'Gerade gibt es keine Verbindung zum Coach.';

const hevyValue = (s: HevyStatus): string => (s.state === 'connected' ? 'verbunden' : s.state === 'connecting' ? 'verbindet…' : 'optional');
const syncLine = (s: GarminSyncInfo | null): string | null => {
  if (!s) return null;
  if (s.running) return 'Daten werden geholt';
  if (s.problem === 'rate-limit' || s.problem === 'failed') return 'Der Abruf pausiert und geht später weiter.';
  return s.lastRunMs ? `Zuletzt: ${new Date(s.lastRunMs).toLocaleDateString('de-DE')}` : null;
};

function HevySheet({ v, send, onClose }: { v: CoachSettingsView; send: (m: { type: 'hevy-connect'; key: string } | { type: 'hevy-disconnect' }) => boolean; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [offline, setOffline] = useState(false);
  const s = v.hevy;
  const connect = () => { const k = key.trim(); if (!k) return; setOffline(!send({ type: 'hevy-connect', key: k })); setKey(''); };
  return (
    <Sheet title="Hevy" size="small" onClose={onClose}
      actions={s.state === 'connected' ? <ConfirmLink label="Trennen" question="Wirklich trennen?" onConfirm={() => { setOffline(!send({ type: 'hevy-disconnect' })); }} />
        : <button type="button" className="primary" disabled={s.state === 'connecting' || !key.trim()} onClick={connect}>Verbinden</button>}>
      {s.state === 'connected' ? <p className="muted">{s.workouts} Workouts{s.loading ? ' · Verlauf wird geladen' : ''}. Der Coach plant damit dein Krafttraining.</p> : (
        <form onSubmit={(e) => { e.preventDefault(); connect(); }}>
          <input type="password" autoComplete="off" aria-label="Hevy-Schlüssel" placeholder="API-Schlüssel (Hevy Pro)" value={key} onChange={(e) => setKey(e.target.value)} />
          {s.state === 'connecting' && <p role="status" className="muted">Hevy wird verbunden…</p>}
          {s.state === 'failed' && <p role="alert" className="muted">{HEVY_PROBLEM[s.reason]}</p>}
        </form>
      )}
      {offline && <p role="alert" className="muted">{SENT_NO}</p>}
    </Sheet>
  );
}

function GarminSheet({ v, send, onClose }: { v: CoachSettingsView; send: (m: { type: 'garmin-login'; email: string; password: string } | { type: 'garmin-mfa'; code: string } | { type: 'garmin-disconnect' } | { type: 'garmin-upload-settings'; mode: 'off' | 'ask' }) => boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [offline, setOffline] = useState(false);
  const s = v.garmin;
  const reauth = v.garminSync?.problem === 'reauth';
  const line = syncLine(v.garminSync);
  const login = () => { if (!email.trim() || !password) return; setOffline(!send({ type: 'garmin-login', email: email.trim(), password })); setPassword(''); };
  const mfa = () => { if (!code.trim()) return; setOffline(!send({ type: 'garmin-mfa', code: code.trim() })); setCode(''); };
  const connected = s.state === 'connected' && !reauth;
  return (
    <Sheet title="Garmin" size={connected ? 'small' : undefined} onClose={onClose}
      actions={connected ? <ConfirmLink label="Trennen" question="Wirklich trennen?" onConfirm={() => setOffline(!send({ type: 'garmin-disconnect' }))} />
        : s.state === 'needs-mfa' ? <button type="button" className="primary" disabled={!code.trim()} onClick={mfa}>Code senden</button>
        : <button type="button" className="primary" disabled={s.state === 'connecting' || !email.trim() || !password} onClick={login}>Verbinden</button>}>
      {connected ? (
        <>
          {line && <p role="status" className="muted">{line}</p>}
          <Switch label="Fahrten zu Garmin hochladen" hint="Pandafit fragt nach jeder Fahrt und lädt nie ohne deine Bestätigung hoch." checked={v.upload?.mode === 'ask'}
            onChange={(on) => setOffline(!send({ type: 'garmin-upload-settings', mode: on ? 'ask' : 'off' }))} />
        </>
      ) : s.state === 'needs-mfa' ? (
        <form onSubmit={(e) => { e.preventDefault(); mfa(); }}>
          <input inputMode="numeric" autoComplete="one-time-code" aria-label="Zwei-Faktor-Code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); login(); }}>
          {reauth && <p role="alert" className="muted">Die Anmeldung ist abgelaufen. Bitte melde dich neu an.</p>}
          <input type="email" autoComplete="username" aria-label="Garmin-E-Mail" placeholder="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" autoComplete="current-password" aria-label="Garmin-Passwort" placeholder="Passwort" value={password} onChange={(e) => setPassword(e.target.value)} />
          {s.state === 'connecting' && <p role="status" className="muted">Garmin wird verbunden…</p>}
          {s.state === 'failed' && <p role="alert" className="muted">{GARMIN_PROBLEM[s.reason]}</p>}
        </form>
      )}
      {offline && <p role="alert" className="muted">{SENT_NO}</p>}
    </Sheet>
  );
}

const tags = (text: string): string[] => [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];

function MealsSheet({ settings, save, onClose }: { settings: MealSettings; save: (s: MealSettings) => void; onClose: () => void }) {
  const [s, setS] = useState(settings);
  const [dislikes, setDislikes] = useState(settings.dislikes.join(', '));
  const [intolerances, setIntolerances] = useState(settings.intolerances.join(', '));
  return (
    <Sheet title="Essen anpassen" onClose={onClose} actions={<button type="button" className="primary" onClick={() => { save({ ...s, dislikes: tags(dislikes), intolerances: tags(intolerances) }); onClose(); }}>Speichern</button>}>
      <ChoiceRow label="Ernährungsform" value={s.diet} options={DIETS} onChange={(diet) => setS({ ...s, diet })} />
      {SLOTS.map((slot) => <ChoiceRow key={slot} label={`${SLOT_LABEL[slot]} werktags`} value={s.habits[slot]} options={HABITS} onChange={(h) => setS({ ...s, habits: { ...s.habits, [slot]: h } })} />)}
      <label className="tk-field">Abneigungen<input value={dislikes} placeholder="zum Beispiel Pilze, Oliven" onChange={(e) => setDislikes(e.target.value)} /></label>
      <label className="tk-field">Unverträglichkeiten<input value={intolerances} placeholder="zum Beispiel Laktose" onChange={(e) => setIntolerances(e.target.value)} /></label>
      <p className="muted">Bitte prüf die Zutaten bei Unverträglichkeiten trotzdem selbst.</p>
    </Sheet>
  );
}

const n = (x: number) => x.toLocaleString('de-DE');
/** "Rezeptsammlung: 734 von 1.000" until the collection is used for planning, then "Rezeptsammlung: 1.512 Rezepte". */
export const collectionLine = (r: { collection: number; unlock: number }): string =>
  r.collection >= r.unlock ? `Rezeptsammlung: ${n(r.collection)} ${r.collection === 1 ? 'Rezept' : 'Rezepte'}` : `Rezeptsammlung: ${n(r.collection)} von ${n(r.unlock)}`;

/** A titled group of the profile: the title above, a thin line only between groups. */
export function ProfileGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="tk-pgroup"><h2 className="tk-section">{title}</h2>{children}</section>;
}

const withHint = (title: string, hint: string) => <>{title}<small className="tk-row-sub muted">{hint}</small></>;

function CoachGroups({ link, plan }: { link: CoachLink; plan: ReactNode }) {
  const snap = useSyncExternalStore(link.subscribe, link.snapshot);
  const [sheet, setSheet] = useState<'hevy' | 'garmin' | 'meals' | null>(null);
  useEffect(() => { link.start(); return () => link.stop(); }, [link]);
  const v = snap.view;
  if (!v) return <ProfileGroup title="Planen">{plan}</ProfileGroup>;
  const send = (m: Parameters<CoachLink['send']>[0]): boolean => link.send(m);
  const meals = v.meals ?? DEFAULT_MEAL_SETTINGS;
  return (
    <>
      <ProfileGroup title="Planen">
        {plan}
        {v.gymOn ? <p className="muted">Krafttraining · wird geplant</p> : <Switch label="Krafttraining planen" hint="Auch ohne Hevy" checked={false} onChange={() => send({ type: 'gym-start' })} />}
        <Switch label="Essensplan" hint="Wochenplan mit Einkaufsliste" checked={meals.on} onChange={(on) => send({ type: 'meals-settings', settings: { ...meals, on } })} />
        {meals.on && <RowList><Row title={withHint('Essen anpassen', 'Vorlieben und Abneigungen')} onClick={() => setSheet('meals')} /></RowList>}
        {meals.on && v.recipes && <p className="muted" role="status">{collectionLine(v.recipes)}</p>}
      </ProfileGroup>
      <ProfileGroup title="Verbindungen">
        <RowList label="Verbindungen">
          <Row title={withHint('Hevy', 'Krafttrainings übernehmen')} value={hevyValue(v.hevy)} onClick={() => setSheet('hevy')} />
          <Row title={withHint('Garmin', 'Ruhepuls und Läufe übernehmen')} value={v.garmin.state === 'connected' ? 'verbunden' : 'optional'} onClick={() => setSheet('garmin')} />
        </RowList>
      </ProfileGroup>
      {sheet === 'hevy' && <HevySheet v={v} send={send} onClose={() => setSheet(null)} />}
      {sheet === 'garmin' && <GarminSheet v={v} send={send} onClose={() => setSheet(null)} />}
      {sheet === 'meals' && <MealsSheet settings={meals} save={(settings) => send({ type: 'meals-settings', settings })} onClose={() => setSheet(null)} />}
    </>
  );
}

/**
 * The groups "Planen" (with what the caller puts first, the run switch) and "Verbindungen". What the Mac app used to hold and the server coach uses:
 * Hevy, Garmin, Krafttraining and the meal plan. Without a coach on the server, or while it is not reached, only the caller's part of "Planen" shows.
 */
export function ConnectionSettings({ link, plan }: { link: CoachLink | null; plan: ReactNode }) {
  return link ? <CoachGroups link={link} plan={plan} /> : <ProfileGroup title="Planen">{plan}</ProfileGroup>;
}
