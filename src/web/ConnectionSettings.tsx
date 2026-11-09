import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_MEAL_SETTINGS, SLOT_LABEL, SLOTS, type Diet, type Habit, type MealSettings } from '../shared/meals';
import type { GarminSyncInfo, HevyStatus } from '../coach/protocol';
import { Card, ChoiceRow, ConfirmLink, Kicker, Row, RowList, Sheet, Switch } from '../tracking/ui/kit';
import type { CoachLink, CoachSettingsView } from './coachLink';

const DIETS: { value: Diet; label: string }[] = [{ value: 'vegetarisch', label: 'Vegetarisch' }, { value: 'vegan', label: 'Vegan' }, { value: 'alles', label: 'Alles' }];
const HABITS: { value: Habit; label: string }[] = [{ value: 'zuhause', label: 'zu Hause' }, { value: 'mitnehmen', label: 'zum Mitnehmen' }, { value: 'auswaerts', label: 'auswärts' }];
const HEVY_PROBLEM = { invalid: 'Der Schlüssel funktioniert nicht. Ist er vollständig und Hevy Pro aktiv?', expired: 'Der Schlüssel gilt nicht mehr. Bitte trag einen neuen ein.', failed: 'Hevy ist gerade nicht erreichbar.' } as const;
const GARMIN_PROBLEM: Record<string, string> = { credentials: 'E-Mail oder Passwort wurde abgelehnt.', 'rate-limit': 'Garmin blockt gerade zu viele Versuche. Versuch es bitte später nochmal.', setup: 'Das Garmin-Hilfsprogramm fehlt auf dem Server.', failed: 'Das hat nicht geklappt. Versuch es bitte später nochmal.' };
const SENT_NO = 'Gerade gibt es keine Verbindung zu Bo.';

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
      {s.state === 'connected' ? <p className="muted">{s.workouts} Workouts{s.loading ? ' · Verlauf wird geladen' : ''}. Bo plant damit dein Krafttraining.</p> : (
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

function MealsSheet({ settings, recipes, save, onClose }: { settings: MealSettings; recipes?: { collection: number; unlock: number } | null; save: (s: MealSettings) => void; onClose: () => void }) {
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
      {recipes && <p className="muted" role="status">{collectionLine(recipes)}</p>}
    </Sheet>
  );
}

const n = (x: number) => x.toLocaleString('de-DE');
/** "Rezeptsammlung: 734 von 1.000" until the collection is used for planning, then "Rezeptsammlung: 1.512 Rezepte". */
export const collectionLine = (r: { collection: number; unlock: number }): string =>
  r.collection >= r.unlock ? `Rezeptsammlung: ${n(r.collection)} ${r.collection === 1 ? 'Rezept' : 'Rezepte'}` : `Rezeptsammlung: ${n(r.collection)} von ${n(r.unlock)}`;

/** A group of the profile: a card whose name is a level-2 heading that looks like a kicker. */
export function ProfileGroup({ title, children }: { title: string; children: ReactNode }) {
  return <Card label={title}><Kicker heading>{title}</Kicker>{children}</Card>;
}

/** The one place for the sentences about riding: the bike is ridden on the Mac. */
export const bikeLine = (hasBike: boolean): string => (hasBike ? 'Rad fährst du am Mac.' : 'Rad geht mit der ersten Fahrt am Mac los.');
export const planLine = (gymOn: boolean, hasBike: boolean): string => (gymOn ? `Dein Krafttraining wird immer geplant. ${bikeLine(hasBike)}` : bikeLine(hasBike));

const PLAN = 'Was Pandafit für dich plant';

function CoachGroups({ link, plan, hasBike }: { link: CoachLink; plan: ReactNode; hasBike: boolean }) {
  const snap = useSyncExternalStore(link.subscribe, link.snapshot);
  const [sheet, setSheet] = useState<'hevy' | 'garmin' | 'meals' | null>(null);
  useEffect(() => { link.start(); return () => link.stop(); }, [link]);
  const v = snap.view;
  if (!v) return <PlanOnly plan={plan} hasBike={hasBike} />;
  const send = (m: Parameters<CoachLink['send']>[0]): boolean => link.send(m);
  const meals = v.meals ?? DEFAULT_MEAL_SETTINGS;
  return (
    <>
      <ProfileGroup title={PLAN}>
        {plan}
        <Switch icon="essen" label="Essensplan" hint="Ein Wochenplan mit Einkaufsliste." checked={meals.on} onChange={(on) => send({ type: 'meals-settings', settings: { ...meals, on } })} />
        {meals.on && <RowList><Row icon="blatt" title="Essen anpassen" hint="Vorlieben, Abneigungen und Unverträglichkeiten." onClick={() => setSheet('meals')} /></RowList>}
        {!v.gymOn && <Switch icon="kraft" label="Krafttraining planen" hint="Auch ohne Hevy." checked={false} onChange={() => send({ type: 'gym-start' })} />}
        <RowList><Row icon="ausdauer" title={planLine(v.gymOn, hasBike)} /></RowList>
      </ProfileGroup>
      <ProfileGroup title="Verbindungen">
        <RowList label="Verbindungen">
          <Row icon="kraft" title="Hevy" hint="Krafttrainings übernehmen" value={hevyValue(v.hevy)} onClick={() => setSheet('hevy')} />
          <Row icon="uhr" title="Garmin" hint="Ruhepuls und Läufe übernehmen" value={v.garmin.state === 'connected' ? 'verbunden' : 'optional'} onClick={() => setSheet('garmin')} />
        </RowList>
      </ProfileGroup>
      {sheet === 'hevy' && <HevySheet v={v} send={send} onClose={() => setSheet(null)} />}
      {sheet === 'garmin' && <GarminSheet v={v} send={send} onClose={() => setSheet(null)} />}
      {sheet === 'meals' && <MealsSheet settings={meals} recipes={v.recipes} save={(settings) => send({ type: 'meals-settings', settings })} onClose={() => setSheet(null)} />}
    </>
  );
}

/** Without a coach on the server: only what works on this device. */
function PlanOnly({ plan, hasBike }: { plan: ReactNode; hasBike: boolean }) {
  return <ProfileGroup title={PLAN}>{plan}<RowList><Row icon="ausdauer" title={bikeLine(hasBike)} /></RowList></ProfileGroup>;
}

/**
 * The cards "Was Pandafit für dich plant" (with what the caller puts first, the run switch) and "Verbindungen". What the Mac app used to hold and the server coach uses:
 * Hevy, Garmin, Krafttraining and the meal plan. Without a coach on the server, or while it is not reached, only the caller's part of the first card shows.
 */
export function ConnectionSettings({ link, plan, hasBike }: { link: CoachLink | null; plan: ReactNode; hasBike: boolean }) {
  return link ? <CoachGroups link={link} plan={plan} hasBike={hasBike} /> : <PlanOnly plan={plan} hasBike={hasBike} />;
}
