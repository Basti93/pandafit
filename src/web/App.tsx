import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LoggedWorkout } from '../shared/records';
import type { GymWorkout } from '../coach/gym/types';
import { durationNote } from '../shared/duration';
import { openStoreCount } from '../tracking/registry';
import { PageHead, Row, RowList, Switch } from '../tracking/ui/kit';
import { CoachPrefs } from '../tracking/ui/CoachPrefs';
import { localDayKey, shortDate, timeLabel } from '../shared/dates';
import { BikeScreen, bikeOf, hasBike as bikeVisible, ridesOf, ExercisesScreen, RoutinesScreen, RunScreen, RunSettingsCard, WorkoutScreen } from '../tracking/ui';
import { CoachScreen } from '../tracking/ui/CoachScreen';
import { TodayCard, todayPlan } from '../tracking/ui/TodayCard';
import { useWaitingProposal, WaitingProposal } from '../tracking/ui/WaitingProposal';
import { runView } from '../tracking/ui/run-view';
import { MobilityOffer } from '../tracking/ui/MobilityOffer';
import { GymOutlook } from '../tracking/ui/GymOutlook';
import { usePortRecords } from '../tracking/ui/hooks';
import { openIdb } from './idbStore';
import { mobilityToShow, planDateText, planIsStale, readPlan, shouldShowInstallHint } from './logic';
import type { OpenState } from './register';
import { createWebPort, type WebPort } from './webPort';
import { DayMeals, MealsScreen, mealWeeks } from './MealsScreen';
import { YesterdayTraining } from './today/YesterdayTraining';
import { TomorrowTraining } from './today/TomorrowTraining';
import { TogetherCard, TogetherPage, togetherOf } from './TogetherScreen';
import type { PushEnv, SubJson } from './push';
import { ContactSettings, UpdatesSwitch } from './ContactSettings';
import { ConnectionSettings, ProfileGroup } from './ConnectionSettings';
import { CoachLink } from './coachLink';
import { LiveClient, type LiveSocket } from './live';
import { LiveRide } from './LiveRide';
import { DayHead } from './today/DayHead';
import { CoachLine } from './today/CoachLine';
import { BodyCard } from './today/BodyCard';
import { shiftDay, swipeIgnored, swipeStep, type DayOffset } from './today/day-nav';
import { dayLine } from '../shared/day-text';
import { healthOf } from '../tracking/ui/health-view';

export type Env = {
  fetchFn: typeof fetch;
  /** Undefined: the browser's own. Null: none available. */
  idbFactory?: IDBFactory | null;
  now: () => number;
  newId: () => string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  persist: () => Promise<boolean>;
  ua: string;
  standalone: boolean;
  /** Tells the update logic whether a workout is open on this device. */
  onWorkoutOpen?: (state: OpenState) => void;
  /** Push notifications; undefined where there is no service worker (dev). */
  push?: PushEnv;
  /** The tab a notification opened the app with. */
  startTab?: string | null;
  /** A notification tapped while the app is open asks for a tab. Returns the unsubscribe. */
  onOpenTab?: (f: (tab: string) => void) => () => void;
  /** Opens the account's coach socket for the ride companion; undefined where there is none (tests, dev). */
  openLive?: () => LiveSocket;
};

const ACCOUNT_KEY = 'pandafit.account';
const HINT_KEY = 'pandafit.installHint';
const LOGGED_OUT_KEY = 'pandafit.loggedOut';
const OPEN_MAX_AGE_MS = 12 * 3600_000;
const ME_TIMEOUT_MS = 5000;
const LOGIN_TIMEOUT_MS = 15_000;
const NO_STORAGE = 'In diesem Browser können Einträge nicht gespeichert werden. Darum ist das Training hier nicht verfügbar. Versuch es in einem anderen Browser oder vom Home-Bildschirm aus.';
const STORAGE_FAILED = 'Der Speicher auf diesem Gerät antwortet gerade nicht. Deine Einträge sind nicht verloren. Versuch es gleich nochmal.';
/** Only an answer from the server ends the session: 2xx, or 401 (already gone). Errors and 5xx leave it open. */
const loggedOut = (res: Response): boolean => res.ok || res.status === 401;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const post = (env: Env, path: string, body?: unknown, timeoutMs = LOGIN_TIMEOUT_MS) => env.fetchFn(path, {
  method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});
const get = (env: Env, path: string, timeoutMs = ME_TIMEOUT_MS) => env.fetchFn(path, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });

function LoginForm({ env, onDone, note, before, failed }: { env: Env; onDone: (name: string) => void; note?: string; before?: () => Promise<void>; failed?: () => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!name.trim() || !password) { setMsg('Bitte Name und Passwort eingeben'); (name.trim() ? passRef : nameRef).current?.focus(); return; }
    setBusy(true); setMsg(null);
    try {
      await before?.(); // no sync may run while the login changes under it
      const res = await post(env, '/login', { name: name.trim(), password });
      if (res.ok) { setPassword(''); env.storage.removeItem(LOGGED_OUT_KEY); onDone(name.trim().toLowerCase()); return; }
      failed?.();
      setMsg(res.status === 429 ? 'Gerade zu viele Versuche. Warte bitte einen Moment.' : res.status === 401 ? 'Name oder Passwort stimmt nicht. Versuch es gern nochmal.' : 'Das hat gerade nicht geklappt. Versuch es gleich nochmal.');
    } catch (e) {
      failed?.();
      setMsg((e as { name?: string }).name === 'TimeoutError' ? 'Der Server antwortet gerade nicht. Deine Einträge auf diesem Gerät sind sicher. Versuch es gleich nochmal.' : 'Keine Verbindung. Deine Einträge auf diesem Gerät sind sicher. Versuch es gleich nochmal.');
    } finally { setBusy(false); }
  };
  return (
    <form className="web-login tk-screen" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h1 className="tk-title">Pandafit</h1>
      <p className="muted">Ein Konto bekommst du von der Person, die Pandafit eingerichtet hat.</p>
      {note && <p role="status" className="tk-note">{note}</p>}
      <label>Name<input ref={nameRef} aria-label="Name" autoComplete="username" autoCapitalize="none" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Passwort<input ref={passRef} aria-label="Passwort" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {msg && <p role="status" className="tk-note">{msg}</p>}
      <button type="submit" className="primary" disabled={busy}>Anmelden</button>
    </form>
  );
}

/** A broken page never leaves a white screen: a calm message, and the way to the workout stays open. */
export class ErrorBoundary extends Component<{ children: ReactNode; onTraining: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="tk-screen">
        <p role="status" className="tk-note">Diese Seite lässt sich gerade nicht anzeigen. Deine Einträge sind nicht verloren.</p>
        <button type="button" onClick={() => { this.setState({ failed: false }); this.props.onTraining(); }}>Zum Training</button>
      </div>
    );
  }
}

/** "14:05", or with the day when it was not today. */
/** "14:44" today, "gestern 13:34" the day before, "Sa., 13:34" earlier: an old open workout shows as old. */
export const sinceText = (ms: number, now: number): string => {
  if (localDayKey(ms) === localDayKey(now)) return timeLabel(ms);
  const day = new Date(now); day.setDate(day.getDate() - 1);
  if (localDayKey(ms) === localDayKey(day.getTime())) return `gestern ${timeLabel(ms)}`;
  return `${new Date(ms).toLocaleDateString('de-DE', { weekday: 'short' })}, ${timeLabel(ms)}`;
};

/** The time one calendar day before or after, at the same clock time. */
const shiftMs = (ms: number, days: number): number => { const d = new Date(ms); d.setDate(d.getDate() + days); return d.getTime(); };

function Heute({ port, env, account, goTraining, goRun, goBike, goCoach, goProfile, meals, planning }: { port: WebPort; env: Env; account: string; goTraining: (resume?: boolean) => void; goRun?: () => void; goBike?: () => void; goCoach: () => void; goProfile: () => void; meals: boolean; /** Something is switched on (strength plan, meals, running, a bike plan): then the "what can I plan" card goes. */ planning: boolean }) {
  const plans = usePortRecords(port, 'plan').records;
  const mobility = usePortRecords(port, 'mobility').records;
  const weekplans = usePortRecords(port, 'weekplan').records;
  const runs = usePortRecords(port, 'run').records;
  const bikePlan = bikeOf(usePortRecords(port, 'bike').records)?.next ?? null;
  // Only when the Mac sent one for this account: without a link Heute stays as it was.
  const together = togetherOf(usePortRecords(port, 'together').records);
  const [showTogether, setShowTogether] = useState(false);
  const daytexts = usePortRecords(port, 'daytext').records;
  const health = healthOf(usePortRecords(port, 'health').records);
  const plan = (plans ?? []).find((r) => r.id === 'current');
  const p = readPlan(plan);
  const now = env.now();
  // The chosen day belongs to the calendar day it was chosen on: a new day starts at Heute.
  const dayKey = localDayKey(now);
  const [pick, setPick] = useState<{ key: string; offset: DayOffset }>({ key: dayKey, offset: 0 });
  const offset: DayOffset = pick.key === dayKey ? pick.offset : 0;
  const step = (s: -1 | 0 | 1) => { if (s !== 0) setPick({ key: dayKey, offset: shiftDay(offset, s) }); };
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const session = useMemo(() => mobilityToShow(plan, mobility ?? [], now), [plan, mobility, now]);
  const today = todayPlan(weekplans, now);
  const waiting = useWaitingProposal(port, now);
  // A workout still open (here or on another device) is the next thing to do: the newest one.
  const workouts = usePortRecords(port, 'workout').records;
  const activities = usePortRecords(port, 'activities').records;
  const open = (workouts ?? []).filter((r) => (r.body as LoggedWorkout).endMs === null).sort((x, y) => (y.body as LoggedWorkout).startMs - (x.body as LoggedWorkout).startMs)[0];

  const markDone = async () => {
    if (!session) return;
    try { await port.put({ kind: 'mobility', id: session.id, updatedMs: env.now(), deleted: false, body: { doneMs: env.now(), forSession: session.forSession } }); } catch { /* shown again next time */ }
  };

  // The strength plan: on a strength day inside the week plan's card, without a week plan as its own card.
  // Name and time in one line, the exercises in two; the reason, the sets and the outlook behind "Details".
  const toTraining = <button type="button" onClick={() => goTraining()}>Zum Krafttraining</button>;
  const gym = p ? (
    <>
      {p.workout && <p className="muted"><span>{p.workout.name}</span>{p.workout.exercises.length > 0 ? ` · ${durationNote(p.workout)}` : ''}</p>}
      {p.workout && p.workout.exercises.length > 0 && <p className="muted tk-clamp">{p.workout.exercises.map((e) => e.title).join(', ')}</p>}
      {planIsStale(p.atMs, now) && <p className="muted">Der Plan ist schon etwas älter. Der Coach macht einen neuen, sobald er dazu kommt.</p>}
      {p.questions.length > 0 && <ul>{p.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
      {toTraining}
      <details className="tk-details">
        <summary>Details</summary>
        <p className="muted">{planDateText(p.atMs)}</p>
        {p.reason && <p>{p.reason}</p>}
        {p.workout && <ul>{p.workout.exercises.map((e, i) => <li key={i}>{e.title}, {e.sets.length} Sätze</li>)}</ul>}
        {p.note && <p>{p.note}</p>}
        <GymOutlook outlook={p.outlook} />
      </details>
    </>
  ) : (
    <>
      {toTraining}
    </>
  );

  // On a bike day: the planned session, and a way to look at it. The ride itself starts on the Mac.
  const bike = bikePlan && goBike ? (
    <>
      <p className="muted">{bikePlan.name} · {bikePlan.minutes} Min · gestartet wird am Mac</p>
      <button type="button" className="secondary" onClick={goBike}>Ansehen</button>
    </>
  ) : undefined;
  if (together && showTogether) return <TogetherPage t={together} now={now} onBack={() => setShowTogether(false)} />;
  return (
    <div
      className="tk-screen tk-daypage"
      onPointerDown={(e) => { if (!e.isPrimary || e.pointerType === 'mouse') return; swipe.current = swipeIgnored(e.target as Element | null) ? null : { x: e.clientX, y: e.clientY }; }}
      onPointerCancel={() => { swipe.current = null; }}
      onPointerUp={(e) => { if (!e.isPrimary || e.pointerType === 'mouse') return; const s = swipe.current; swipe.current = null; if (s) step(swipeStep(e.clientX - s.x, e.clientY - s.y)); }}
    >
      <DayHead offset={offset} nowMs={now} onStep={step} />
      {offset === 0 && <>
      {open && (
        <section className="card" aria-label="Training läuft noch">
          <h2>{(open.body as LoggedWorkout).title} läuft – gestartet {sinceText((open.body as LoggedWorkout).startMs, now)}</h2>
          <button type="button" onClick={() => goTraining(true)}>Weitermachen</button>
        </section>
      )}
      <CoachLine text={dayLine(daytexts, account, dayKey).text} />
      {/* A workout that is open is the one thing to do: no day card beside it. */}
      {!open && <TodayCard port={port} weekplans={weekplans} runs={runs} nowMs={now} gym={gym} onRun={goRun} bike={bike} />}
      {!open && weekplans !== null && plans !== null && !today && !planning && !p && (
        <section className="card" aria-label="Was Pandafit planen kann">
          <h2>Was soll Pandafit für dich planen?</h2>
          <p className="muted">Krafttraining, Laufen und Essen schaltest du im Profil ein. Die Woche planst du dann mit dem Coach.</p>
          <div className="tk-row">
            <button type="button" className="secondary" onClick={goCoach}>Woche planen</button>
            <button type="button" className="link" onClick={goProfile}>Im Profil auswählen</button>
          </div>
        </section>
      )}
      {!open && waiting && <WaitingProposal onOpen={goCoach} />}
      {meals && <DayMeals port={port} now={env.now} fetchFn={env.fetchFn} account={account} offset={0} />}
      {session && <MobilityOffer key={session.id} session={session} hideKey={`pandafit.mobility.notToday.${account}`} storage={env.storage} now={env.now} onDone={() => void markDone()} />}
      <BodyCard health={health} onCoach={goCoach} />
      {together && <TogetherCard t={together} now={now} onOpen={() => setShowTogether(true)} />}
      </>}
      {offset === -1 && <>
        <YesterdayTraining activities={activities} workouts={workouts} mobility={mobility} date={localDayKey(shiftMs(now, -1))} />
        {meals && <DayMeals port={port} now={env.now} fetchFn={env.fetchFn} account={account} offset={-1} />}
      </>}
      {offset === 1 && <>
        <TomorrowTraining weekplans={weekplans} date={localDayKey(shiftMs(now, 1))} gymNote={p?.workout ? <><p className="muted"><span>{p.workout.name}</span></p>{p.workout.exercises.length > 0 && <p className="muted tk-clamp">{p.workout.exercises.map((e) => e.title).join(', ')}</p>}</> : undefined} />
        {meals && <DayMeals port={port} now={env.now} fetchFn={env.fetchFn} account={account} offset={1} />}
      </>}
    </div>
  );
}

function Training({ port, env, resume, onDone }: { port: WebPort; env: Env; resume: boolean; onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const plans = usePortRecords(port, 'plan').records;
  const [screen, setScreen] = useState<'workout' | 'routines' | 'exercises'>('workout');
  const [routine, setRoutine] = useState<GymWorkout | null>(null);
  const plan = readPlan((plans ?? []).find((r) => r.id === 'current'));
  return (
    <>
      {/* One page head: the title, the three sub-pages below. A running workout has the whole screen: no head until it is done. */}
      {!(running && screen === 'workout') && <div className="tk-screen tk-headblock">
        <PageHead title="Kraft" />
        <div className="tk-seg" role="group" aria-label="Kraft">
          <button type="button" aria-pressed={screen === 'workout'} onClick={() => { setRoutine(null); setScreen('workout'); }}>Training</button>
          <button type="button" aria-pressed={screen === 'routines'} onClick={() => setScreen('routines')}>Routinen</button>
          <button type="button" aria-pressed={screen === 'exercises'} onClick={() => setScreen('exercises')}>Übungen</button>
        </div>
      </div>}
      {screen === 'workout' && <WorkoutScreen key={routine ? 'routine' : 'plan'} port={port} resume={resume} onActive={setRunning} onDone={onDone} plan={routine ? null : plan?.workout ?? null} routine={routine} now={env.now} newId={env.newId} />}
      {screen === 'exercises' && <ExercisesScreen port={port} now={env.now} newId={env.newId} />}
      {screen === 'routines' && <RoutinesScreen port={port} now={env.now} newId={env.newId} onStart={(r) => { setRoutine(r); setScreen('workout'); }} />}
    </>
  );
}

const pushKey = (account: string) => `pandafit.push.${account}`;
const cardKey = (account: string) => `pandafit.pushCard.${account}`;
const PUSH_INSTALL = 'Auf dem iPhone gibt es Benachrichtigungen, wenn Pandafit auf dem Home-Bildschirm liegt (ab iOS 16.4): unten auf Teilen tippen, dann auf „Zum Home-Bildschirm“, und Pandafit von dort öffnen.';
const PUSH_DENIED = 'Benachrichtigungen sind für Pandafit nicht erlaubt. Du kannst sie in den Einstellungen erlauben und dann im Profil einschalten.';
const PUSH_FAILED = 'Das Einschalten hat gerade nicht geklappt. Versuch es später im Profil nochmal.';

type PushState = { env: PushEnv; on: boolean; busy: boolean; showCard: boolean; enable: () => Promise<void>; disable: () => Promise<void>; closeCard: () => void };

/** One on/off per account and device for both notices. A subscription is sent again at every start, so it follows the login. */
function usePush(env: Env, account: string): { state: PushState | null; msg: string | null } {
  const p = env.push;
  const [on, setOn] = useState(() => env.storage.getItem(pushKey(account)) === 'on');
  const [cardDone, setCardDone] = useState(() => env.storage.getItem(cardKey(account)) === '1');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const getKey = useCallback(async (): Promise<string> => {
    if (key.current) return key.current;
    const res = await get(env, '/push/key');
    const k = res.ok ? ((await res.json()) as { key?: unknown }).key : null;
    if (typeof k !== 'string') throw new Error('no key');
    return (key.current = k);
  }, [env]);
  const send = useCallback(async (s: SubJson) => {
    const res = await post(env, '/push/subscribe', { endpoint: s.endpoint, keys: s.keys });
    if (!res.ok) throw new Error('not stored');
  }, [env]);

  useEffect(() => {
    if (!p || p.support !== 'ok') return;
    void getKey().catch(() => {}); // ready before the tap, so subscribing follows the permission at once
    if (env.storage.getItem(pushKey(account)) === 'on' && p.permission() === 'granted') {
      void (async () => send((await p.current()) ?? (await p.subscribe(await getKey()))))().catch(() => {});
    }
  }, [env, p, account, getKey, send]);

  if (!p) return { state: null, msg };
  const closeCard = () => { env.storage.setItem(cardKey(account), '1'); setCardDone(true); };
  const enable = async () => {
    setBusy(true); setMsg(null);
    try {
      if ((await p.requestPermission()) !== 'granted') { setMsg(PUSH_DENIED); return; } // first: iOS asks only during the tap
      await send(await p.subscribe(await getKey()));
      env.storage.setItem(pushKey(account), 'on'); setOn(true);
    } catch { setMsg(PUSH_FAILED); } finally { setBusy(false); closeCard(); }
  };
  const disable = async () => {
    setBusy(true); setMsg(null);
    env.storage.setItem(pushKey(account), 'off'); setOn(false);
    try {
      const endpoint = await p.unsubscribe();
      if (endpoint) await post(env, '/push/unsubscribe', { endpoint });
    } catch { /* the push service answers 410 next time, and the server drops it */ } finally { setBusy(false); }
  };
  const showCard = !cardDone && !on && (p.support === 'install' || (p.support === 'ok' && p.permission() === 'default'));
  return { state: { env: p, on, busy, showCard, enable, disable, closeCard }, msg };
}

function PushCard({ push }: { push: PushState }) {
  return (
    <div className="tk-screen">
      <section className="card" aria-label="Benachrichtigungen einschalten">
        <h2>Benachrichtigungen einschalten</h2>
        {push.env.support === 'install' ? (
          <>
            <p>{PUSH_INSTALL}</p>
            <button type="button" className="ghost" onClick={push.closeCard}>Verstanden</button>
          </>
        ) : (
          <>
            <p>Pandafit sagt dir Bescheid, wenn eine neue Version da ist, wenn dein Essensplan für die Woche kommt und wenn dein Laufplan da ist. Sonst nichts.</p>
            <div className="tk-row">
              <button type="button" disabled={push.busy} onClick={() => void push.enable()}>Einschalten</button>
              <button type="button" className="ghost" onClick={push.closeCard}>Nicht jetzt</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function PushSettings({ push, port, now }: { push: PushState; port: WebPort; now: () => number }) {
  const p = push.env;
  const granted = p.support === 'ok' && p.permission() === 'granted';
  return (
    <>
      {p.support === 'install' && <p className="muted">{PUSH_INSTALL}</p>}
      {p.support === 'none' && <p className="muted">In diesem Browser gibt es keine Benachrichtigungen.</p>}
      {p.support === 'ok' && (
        <>
          <Switch label="Benachrichtigungen" hint="Essens- und Laufplan, Antworten vom Coach, neue Version." checked={push.on && granted} disabled={push.busy}
            onChange={(on) => void (on ? push.enable() : push.disable())} />
          {push.on && granted && <UpdatesSwitch port={port} now={now} />}
          {push.on && !granted && <p className="muted">{PUSH_DENIED}</p>}
        </>
      )}
    </>
  );
}

type Tab = 'heute' | 'coach' | 'training' | 'essen' | 'ausdauer' | 'profil';
// At most five tabs in a fixed order: the look back (Rückblick) is on Woche, the profile is the round button at the top right.
const TABS: [Tab, string][] = [['heute', 'Heute'], ['coach', 'Woche'], ['training', 'Kraft'], ['essen', 'Essen'], ['ausdauer', 'Ausdauer']];

/** The "Essensplan" switch lives with the account's coach; the last value seen is kept per account, so Essen shows from the start. */
const mealsOnKey = (account: string) => `pandafit.essensplan.${account}`;
const readMealsOn = (env: Env, account: string): boolean => { try { return env.storage.getItem(mealsOnKey(account)) === 'on'; } catch { return false; } };
const saveMealsOn = (env: Env, account: string, on: boolean): void => { try { env.storage.setItem(mealsOnKey(account), on ? 'on' : 'off'); } catch { /* shown again once the plan is there */ } };
const NO_LINK = { view: null, unavailable: false };
/** How long the app start waits for the coach's switches before it lets the link go. */
const COACH_ASK_MS = 30_000;
const noSub = () => () => {};

/**
 * Which tabs show. They follow the profile switches, and data that is there: Essen once "Essensplan" is on or a plan is there;
 * Ausdauer once "Laufen planen" is on, the run coach suggests running, or there is a bike plan or ride. Heute, Woche and Kraft always.
 */
export const visibleTabs = (o: { meals: boolean; endurance: boolean }): Tab[] =>
  TABS.map(([t]) => t).filter((t) => (t !== 'essen' || o.meals) && (t !== 'ausdauer' || o.endurance));

type Endurance = 'rad' | 'laufen';
const enduranceKey = (account: string) => `pandafit.ausdauer.${account}`;
const readEndurance = (env: Env, account: string): Endurance | null => { try { const v = env.storage.getItem(enduranceKey(account)); return v === 'rad' || v === 'laufen' ? v : null; } catch { return null; } };
const saveEndurance = (env: Env, account: string, v: Endurance): void => { try { env.storage.setItem(enduranceKey(account), v); } catch { /* the choice is just not remembered */ } };
/** The tab a start link or notification names. 'laufen' is the old name of Ausdauer; it and 'rad' also pick the half. */
const tabFor = (t: string | null | undefined): Tab | null => (t === 'essen' || t === 'coach' ? t : t === 'laufen' || t === 'rad' || t === 'ausdauer' ? 'ausdauer' : null);

/** Ausdauer: Rad and Laufen in one tab. The switch shows only when both exist and remembers the last choice. */
function Ausdauer({ port, env, account, hasRun, hasBike }: { port: WebPort; env: Env; account: string; hasRun: boolean; hasBike: boolean }) {
  const stored = readEndurance(env, account);
  const [kind, setKind] = useState<Endurance>(stored ?? (hasBike ? 'rad' : 'laufen'));
  const shown: Endurance = kind === 'rad' && !hasBike ? 'laufen' : kind === 'laufen' && !hasRun ? 'rad' : kind;
  const pick = (k: Endurance) => { setKind(k); saveEndurance(env, account, k); };
  // One page head: the title on top, the switch below it, no second title in the screen.
  return (
    <>
      <div className="tk-screen tk-headblock">
        <PageHead title="Ausdauer" />
        {hasRun && hasBike && (
          <div className="tk-seg" role="group" aria-label="Ausdauer">
            <button type="button" aria-pressed={shown === 'rad'} onClick={() => pick('rad')}>Rad</button>
            <button type="button" aria-pressed={shown === 'laufen'} onClick={() => pick('laufen')}>Laufen</button>
          </div>
        )}
      </div>
      {shown === 'rad' ? <BikeScreen port={port} now={env.now} /> : <RunScreen port={port} now={env.now} newId={env.newId} />}
    </>
  );
}

/** The sync state in a few words: the value of the account row, or a short sentence when something needs saying. */
const syncText = (status: 'ok' | 'login' | 'offline', c: { pending: number; lastOkMs: number | null; refused?: number }): string => {
  if (status === 'login') return 'Bitte melde dich neu an. Bis dahin bleibt alles auf diesem Gerät.';
  if (status === 'offline') return `Gerade keine Verbindung. Alles bleibt auf diesem Gerät.${c.lastOkMs === null ? '' : ` Zuletzt gesichert ${timeLabel(c.lastOkMs)}.`}`;
  if ((c.refused ?? 0) > 0) return 'Ein Eintrag wurde nicht angenommen. Er bleibt auf diesem Gerät.';
  if (c.pending > 0) return c.pending === 1 ? 'Ein Eintrag wartet aufs Senden.' : `${c.pending} Einträge warten aufs Senden.`;
  if (c.lastOkMs === null) return 'Der erste Abgleich folgt gleich.';
  return 'Alles gesichert';
};

/** The account on this device, a few switches, the coach's timing, and the way out. Rows, not cards. */
function Profil({ account, port, now, status, onLogout, push, link }: { link: CoachLink | null; account: string; port: WebPort; now: () => number; status: 'ok' | 'login' | 'offline'; onLogout: () => void; push: PushState | null }) {
  const [confirming, setConfirming] = useState(false);
  usePortRecords(port, 'workout'); // re-renders when the port changes
  const hasBike = bikeVisible(bikeOf(usePortRecords(port, 'bike').records), ridesOf(usePortRecords(port, 'ride').records));
  const c = port.syncState();
  const tryLogout = () => { if (c.pending > 0 || (c.refused ?? 0) > 0) setConfirming(true); else onLogout(); };
  const sync = syncText(status, c);
  const quiet = sync.startsWith('Alles gesichert');
  return (
    <div className="tk-screen">
      <PageHead title="Profil" />
      <RowList>
        <Row title={`Angemeldet als ${account}`} value={quiet ? sync : undefined} />
      </RowList>
      {!quiet && <p role="status" className="muted">{sync}</p>}
      <ConnectionSettings link={link} plan={<>
        <RunSettingsCard port={port} now={now} />
        <p className="muted">{hasBike ? 'Rad · gefahren wird am Mac' : 'Rad · startet mit der ersten Fahrt am Mac'}</p>
      </>} />
      <ProfileGroup title="Nachrichten">
        <ContactSettings port={port} now={now} />
        {push && <PushSettings push={push} port={port} now={now} />}
        {/* The coach's timing is about notifications: it shows under them once they are on (always where the shell has no push at all). */}
        {(!push || push.on) && <CoachPrefs port={port} now={now} nested />}
      </ProfileGroup>
      {confirming ? (
        <p role="status" className="tk-note">
          Einiges ist noch nicht gesendet. Es bleibt auf diesem Gerät gespeichert und geht beim nächsten Anmelden raus.
          <button type="button" className="secondary" onClick={onLogout}>Trotzdem abmelden</button>
          <button type="button" className="link" onClick={() => setConfirming(false)}>Doch nicht</button>
        </p>
      ) : <button type="button" className="link tk-logout" onClick={tryLogout}>Abmelden</button>}
    </div>
  );
}

function Shell({ account, env, port, onLogout, onRelogin }: { account: string; env: Env; port: WebPort; onLogout: () => void; onRelogin: (name: string) => void }) {
  // "Weitermachen" on Heute opens the open workout itself, once; every other way into Kraft shows the start screen.
  const [resume, setResume] = useState(false);
  const openTab = (t: string): void => {
    const next = tabFor(t);
    if (!next) return;
    if (t === 'rad' || t === 'laufen') saveEndurance(env, account, t);
    setTab(next);
  };
  const [tab, setTab] = useState<Tab>(() => {
    if (env.startTab === 'rad' || env.startTab === 'laufen') saveEndurance(env, account, env.startTab);
    return tabFor(env.startTab) ?? 'heute';
  });
  const push = usePush(env, account);
  // The ride companion: optional, a socket of its own, and nothing else in the app depends on it.
  const live = useMemo(() => (env.openLive ? new LiveClient({ open: env.openLive, now: env.now, newId: env.newId }) : null), [env]);
  useEffect(() => { live?.start(); return () => live?.stop(); }, [live]);
  // Hevy, Garmin, Krafttraining and the meal plan are set on the coach's socket; it opens while Profil is shown, and once at the start.
  const link = useMemo(() => (env.openLive ? new CoachLink({ open: env.openLive, status: async () => {
    const res = await get(env, '/coach/status');
    if (!res.ok) return null;
    const j = await res.json() as { profileId?: unknown; moved?: unknown };
    return { profileId: typeof j.profileId === 'string' ? j.profileId : null, moved: j.moved === true };
  } }) : null), [env]);
  useEffect(() => env.onOpenTab?.((t) => { const next = tabFor(t); if (!next) return; if (t === 'rad' || t === 'laufen') saveEndurance(env, account, t); setTab(next); }), [env, account]);
  const [hint, setHint] = useState(false);
  const [, tick] = useState(0);
  const status = useSyncExternalStore(port.onStatus, port.status);
  const workouts = usePortRecords(port, 'workout').records;
  // Essen only when the Mac sent a plan for this account: the meal plan is off by default.
  const mealRecords = usePortRecords(port, 'mealplan').records;
  const linkSnap = useSyncExternalStore(link?.subscribe ?? noSub, link?.snapshot ?? (() => NO_LINK));
  const linkMeals = linkSnap.view ? linkSnap.view.meals?.on === true : null;
  const [storedMeals, setStoredMeals] = useState(() => readMealsOn(env, account));
  useEffect(() => { if (linkMeals !== null) { saveMealsOn(env, account, linkMeals); setStoredMeals(linkMeals); } }, [env, account, linkMeals]);
  // Once per session: ask the account's coach for its switches, then let go. The stored value is only the fast first guess.
  useEffect(() => {
    if (!link) return;
    let held = true;
    const release = () => { if (held) { held = false; link.stop(); } };
    const unsub = link.subscribe(() => { const s = link.snapshot(); if (s.view || s.unavailable) release(); });
    link.start();
    const give = setTimeout(release, COACH_ASK_MS); // not reached: keep what is stored
    return () => { clearTimeout(give); unsub(); release(); };
  }, [link]);
  const hasMeals = (linkMeals ?? storedMeals) || mealWeeks(mealRecords, env.now()).length > 0;
  // Laufen once "Laufen planen" is on or the run coach suggests it: nothing of it for a person who does not run.
  const runRecords = usePortRecords(port, 'run').records;
  const run = runView(runRecords ?? [], env.now());
  const hasRun = run.visible || run.settings?.on === true;
  // Rad once the coach published a plan to ride or a ride: nothing of it for a person who does not ride.
  const bikeRecords = usePortRecords(port, 'bike').records;
  const rideRecords = usePortRecords(port, 'ride').records;
  const hasBike = bikeVisible(bikeOf(bikeRecords), ridesOf(rideRecords));
  const hasEndurance = hasRun || hasBike;
  const shown = visibleTabs({ meals: hasMeals, endurance: hasEndurance });
  const tabs = TABS.filter(([t]) => shown.includes(t));
  useEffect(() => { if (tab === 'ausdauer' && runRecords !== null && bikeRecords !== null && rideRecords !== null && !hasEndurance) setTab('heute'); }, [tab, hasEndurance, runRecords, bikeRecords, rideRecords]);
  useEffect(() => { if (tab === 'essen' && mealRecords !== null && !hasMeals) setTab('heute'); }, [tab, hasMeals, mealRecords]);

  // Open on this device: a recent open record, or a store this session has opened or still has unsaved. Unknown until the first read.
  const state: OpenState = workouts === null ? 'unknown'
    : openStoreCount(port) > 0 || workouts.some((r) => (r.body as LoggedWorkout).endMs === null && env.now() - r.updatedMs < OPEN_MAX_AGE_MS) ? 'open' : 'none';
  const lastState = useRef<OpenState | null>(null);
  useEffect(() => { if (lastState.current !== state) { lastState.current = state; env.onWorkoutOpen?.(state); } });
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    void env.persist().catch(() => {});
    if (shouldShowInstallHint({ ua: env.ua, standalone: env.standalone, seen: env.storage.getItem(HINT_KEY) === '1' })) {
      setHint(true);
      env.storage.setItem(HINT_KEY, '1');
    }
    void port.sync();
  }, [env, port]);

  // While typing, the bottom bar steps aside, so the on-screen keyboard never pushes it over a field.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const field = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, textarea, select');
    const on = (e: FocusEvent) => { if (field(e.target)) setTyping(true); };
    const off = (e: FocusEvent) => { if (field(e.target) && !field(e.relatedTarget)) setTyping(false); };
    document.addEventListener('focusin', on);
    document.addEventListener('focusout', off);
    return () => { document.removeEventListener('focusin', on); document.removeEventListener('focusout', off); };
  }, []);

  return (
    <>
      <main className="web-main" onClick={() => setTimeout(() => tick((n) => n + 1), 50)}>
        <button type="button" className="web-profile" aria-label="Profil" aria-current={tab === 'profil' ? 'page' : undefined} onClick={() => setTab('profil')}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        {status === 'login' && (
          <div className="tk-screen">
            <LoginForm env={env}
              note="Bitte melde dich neu an. Alles auf diesem Gerät bleibt erhalten, auch ein offenes Training."
              before={() => port.pause()} failed={() => port.resume()}
              onDone={(n) => { if (n === account) { port.resume(); void port.sync(); } else onRelogin(n); }} />
          </div>
        )}
        {push.state?.showCard && <PushCard push={push.state} />}
        {push.msg && <div className="tk-screen"><p role="status" className="tk-note">{push.msg}</p></div>}
        {hint && !(push.state?.showCard && push.state.env.support === 'install') && <div className="tk-screen"><p role="status" className="tk-note">Tipp: Tippe unten auf Teilen und dann auf „Zum Home-Bildschirm“, dann öffnet sich Pandafit wie eine App.</p></div>}
        {live && <LiveRide client={live} now={env.now} />}
        <ErrorBoundary key={tab} onTraining={() => setTab('training')}>
          {tab === 'heute' && <Heute port={port} env={env} account={account} goTraining={(r) => { setResume(!!r); setTab('training'); }} goRun={hasRun ? () => { saveEndurance(env, account, 'laufen'); setTab('ausdauer'); } : undefined} goBike={hasBike ? () => { saveEndurance(env, account, 'rad'); setTab('ausdauer'); } : undefined} goCoach={() => setTab('coach')} goProfile={() => setTab('profil')} planning={hasMeals || hasEndurance || linkSnap.view?.gymOn === true} meals={hasMeals} />}
          {tab === 'training' && <Training port={port} env={env} resume={resume} onDone={() => setTab('heute')} />}
          {tab === 'essen' && hasMeals && <MealsScreen port={port} now={env.now} fetchFn={env.fetchFn} account={account} />}
          {tab === 'ausdauer' && hasEndurance && <Ausdauer port={port} env={env} account={account} hasRun={hasRun} hasBike={hasBike} />}
          {tab === 'coach' && <CoachScreen port={port} now={env.now} newId={env.newId} showPrefs={false} />}
          {tab === 'profil' && <Profil link={link} account={account} port={port} now={env.now} status={status} onLogout={onLogout} push={push.state} />}
        </ErrorBoundary>
      </main>
      <nav aria-label="Seiten" className={`web-nav${typing ? ' web-nav-away' : ''}`} style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map(([t, label]) => (
          <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} aria-pressed={tab === t} onClick={() => { setResume(false); setTab(t); }}>{label}</button>
        ))}
      </nav>
    </>
  );
}

type Phase = { kind: 'loading' } | { kind: 'login' } | { kind: 'offline' } | { kind: 'nostorage' } | { kind: 'storagefail' } | { kind: 'in'; account: string };

const factoryOf = (env: Env): IDBFactory | null => (env.idbFactory === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : env.idbFactory);

/** Lets the unmounted screens flush their last write, waits for it, then stops and closes the port. */
async function retire(p: WebPort): Promise<void> {
  await sleep(0); await sleep(0);
  await p.idle();
  await p.pause();
  p.dispose();
}

export function App({ env }: { env: Env }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [port, setPort] = useState<{ account: string; port: WebPort } | null>(null);
  const portRef = useRef<WebPort | null>(null);
  portRef.current = port?.port ?? null;

  /** Opens the account's local data. Without a usable IndexedDB nothing can be stored, and that is said plainly. */
  const enter = useCallback(async (account: string): Promise<boolean> => {
    const factory = factoryOf(env);
    if (!factory) { setPhase({ kind: 'nostorage' }); return false; }
    env.storage.setItem(ACCOUNT_KEY, account); // so a retry after a failed open still finds the account
    let store;
    try { store = await openIdb(account, factory); } catch { setPhase({ kind: 'storagefail' }); return false; } // may pass; not the same as unavailable
    const old = portRef.current;
    const p = createWebPort({ store, account, fetchFn: env.fetchFn, now: env.now, push: env.push });
    setPort({ account, port: p });
    if (old) void retire(old); // after its screens have unmounted and flushed
    setPhase({ kind: 'in', account });
    return true;
  }, [env]);

  /** Tell the server about a logout that could not be sent while offline. */
  const retryLogout = useCallback(() => {
    void post(env, '/logout', undefined, ME_TIMEOUT_MS).then((res) => { if (loggedOut(res)) env.storage.removeItem(LOGGED_OUT_KEY); }, () => {});
  }, [env]);

  const boot = useCallback(async () => {
    setPhase({ kind: 'loading' });
    if (!factoryOf(env)) { setPhase({ kind: 'nostorage' }); return; }
    if (env.storage.getItem(LOGGED_OUT_KEY) === '1') { retryLogout(); setPhase({ kind: 'login' }); return; }
    // The last account on this device opens at once from its local data; its login is checked in the background.
    const last = env.storage.getItem(ACCOUNT_KEY);
    if (last) { await enter(last); return; } // a failure to open is the storage message
    try {
      const res = await get(env, '/me');
      if (res.ok) {
        const me = (await res.json()) as { name?: unknown };
        if (typeof me.name === 'string') { await enter(me.name.toLowerCase()); return; }
      }
      if (res.status === 401) { setPhase({ kind: 'login' }); return; }
      throw new Error('unexpected');
    } catch { setPhase({ kind: 'offline' }); }
  }, [env, enter, retryLogout]);

  useEffect(() => { void boot(); }, [boot]);
  useEffect(() => () => portRef.current?.dispose(), []);
  // Without a workout page (login, offline start, no storage) there is nothing to protect; while loading it stays unknown.
  useEffect(() => { if (phase.kind !== 'in' && phase.kind !== 'loading') env.onWorkoutOpen?.('none'); }, [phase.kind, env]);

  const afterLogin = async (name: string) => {
    void env.persist().catch(() => false); // requested at login, while the tap counts as a gesture
    try {
      const res = await get(env, '/me');
      const me = res.ok ? ((await res.json()) as { name?: unknown }) : null;
      await enter(typeof me?.name === 'string' ? me.name.toLowerCase() : name);
    } catch { await enter(name); }
  };
  const logout = async () => {
    const p = portRef.current;
    setPort(null); // the screens unmount first and flush what is still typed
    setPhase({ kind: 'login' });
    env.storage.removeItem(ACCOUNT_KEY); // the data stays on the device; the login does not
    if (p) await retire(p);
    try { if (!loggedOut(await post(env, '/logout', undefined, ME_TIMEOUT_MS))) env.storage.setItem(LOGGED_OUT_KEY, '1'); } catch { env.storage.setItem(LOGGED_OUT_KEY, '1'); } // not answered: asked again at the next start
  };

  if (phase.kind === 'loading') return <main className="web-main"><p className="muted tk-screen">Einen Moment …</p></main>;
  if (phase.kind === 'nostorage') return <main className="web-main tk-screen"><p role="status" className="tk-note">{NO_STORAGE}</p></main>;
  if (phase.kind === 'storagefail') return <main className="web-main tk-screen"><p role="status" className="tk-note">{STORAGE_FAILED}</p><button type="button" onClick={() => void boot()}>Nochmal versuchen</button></main>;
  if (phase.kind === 'offline') return <main className="web-main tk-screen"><p role="status" className="tk-note">Keine Verbindung. Zum ersten Anmelden braucht Pandafit kurz Internet.</p><button type="button" onClick={() => void boot()}>Nochmal versuchen</button></main>;
  if (phase.kind === 'login' || !port) return <main className="web-main"><LoginForm env={env} onDone={(n) => void afterLogin(n)} /></main>;
  return <Shell key={port.account} account={port.account} env={env} port={port.port} onLogout={() => void logout()} onRelogin={(n) => void afterLogin(n)} />;
}
