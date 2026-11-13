import { bodyOf } from '../../shared/record-bodies';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { openStoreCount, subscribeStores } from '../../tracking/registry';
import { bikeOf, hasBike as bikeVisible, ridesOf } from '../../tracking/ui';
import { Icon, type IconName } from '../../tracking/ui/kit';
import { runView } from '../../tracking/ui/run-view';
import { usePortRecords } from '../../tracking/ui/hooks';
import { shouldShowInstallHint } from '../logic';
import type { OpenState } from '../register';
import { type WebPort } from '../webPort';
import { MealsScreen, mealWeeks } from '../MealsScreen';
import type { MealAt } from '../essen/meals-view';
import { CoachLink } from '../coachLink';
import { LiveClient } from '../live';
import { LiveRide } from '../LiveRide';
import { Env, HINT_KEY, OPEN_MAX_AGE_MS, get } from './env';
import { LoginForm } from './LoginForm';
import { ErrorBoundary } from './ErrorBoundary';
import { Heute } from './Heute';
import { usePush, PushCard } from './Push';
import { Tab, TABS, readMealsOn, saveMealsOn, NO_LINK, COACH_ASK_MS, noSub, visibleTabs, saveEndurance, tabFor } from './tabs';

// The screens that are not on the first view load on demand (their chunks are in the offline cache like the rest).
const CoachScreen = lazy(() => import('../../tracking/ui/CoachScreen').then((m) => ({ default: m.CoachScreen })));
const Training = lazy(() => import('./Training').then((m) => ({ default: m.Training })));
const Ausdauer = lazy(() => import('./Ausdauer').then((m) => ({ default: m.Ausdauer })));
const Profil = lazy(() => import('./Profil').then((m) => ({ default: m.Profil })));

const TAB_ICON: Record<Tab, IconName> = { heute: 'heute', coach: 'woche', training: 'kraft', essen: 'essen', ausdauer: 'ausdauer', profil: 'profil' };

export function Shell({ account, env, port, onLogout, onRelogin }: { account: string; env: Env; port: WebPort; onLogout: () => void; onRelogin: (name: string) => void }) {
  // "Weitermachen" on Heute opens the open workout itself, once; "Ansehen und anpassen" opens the sheet "Nächstes Training", once; every other way into Kraft shows the start screen.
  const [entry, setEntry] = useState<'resume' | 'plan' | null>(null);
  /** Set by a way into the coach from Heute: Woche opens with the chat open, once. */
  const [chatOnOpen, setChatOnOpen] = useState(false);
  /** A question of Bo's plan, tapped on Heute: the chat opens with it, and the reply goes to Bo as its answer. */
  const [question, setQuestion] = useState<string | null>(null);
  /** Questions answered or skipped here: they leave Heute at once, before the plan comes back without them. */
  const [gone, setGone] = useState<string[]>([]);
  /** Set by a meal tapped on Heute: Essen opens on its page, once. */
  const [mealEntry, setMealEntry] = useState<MealAt | null>(null);
  const [tab, setTab] = useState<Tab>(() => {
    if (env.startTab === 'rad' || env.startTab === 'laufen') saveEndurance(env, account, env.startTab);
    return tabFor(env.startTab) ?? 'heute';
  });
  const push = usePush(env, account);
  const sendQuestion = async (m: { type: 'gym-answer'; question: string; text: string } | { type: 'gym-skip-question'; question: string }): Promise<boolean> => {
    const ok = link ? await link.sendOnce(m) : false;
    if (ok) setGone((g) => [...g, m.question]);
    return ok;
  };
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
  const openStores = useSyncExternalStore((cb) => subscribeStores(port, cb), () => openStoreCount(port));
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
    : openStores > 0 || workouts.some((r) => bodyOf('workout', r).endMs === null && env.now() - r.updatedMs < OPEN_MAX_AGE_MS) ? 'open' : 'none';
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
  // The running workout has the whole screen: the wordmark, the profile button and the tab bar step aside while it is shown.
  const [liveWorkout, setLiveWorkout] = useState(false);
  const frame = !(tab === 'training' && liveWorkout);
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
      <main className="web-main">
        {frame && <div className="web-top"><span className="web-wordmark">Pandafit</span></div>}
        {frame && (
          <button type="button" className="web-profile" aria-label="Profil" aria-current={tab === 'profil' ? 'page' : undefined} onClick={() => setTab('profil')}>
            <Icon name="profil" />
          </button>
        )}
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
          <Suspense fallback={<p className="muted" role="status">Wird geladen.</p>}>
          {tab === 'heute' && <Heute goTraining={(e) => { setEntry(e ?? null); setTab('training'); }} goRun={hasRun ? () => { saveEndurance(env, account, 'laufen'); setTab('ausdauer'); } : undefined} goBike={hasBike ? () => { saveEndurance(env, account, 'rad'); setTab('ausdauer'); } : undefined} goCoach={() => { setChatOnOpen(true); setTab('coach'); }} goQuestion={(q) => { setQuestion(q); setChatOnOpen(true); setTab('coach'); }} skipQuestion={(q) => sendQuestion({ type: 'gym-skip-question', question: q })} goneQuestions={gone} goProfile={() => setTab('profil')} goMeal={(m) => { setMealEntry(m); setTab('essen'); }} planning={hasMeals || hasEndurance || linkSnap.view?.gymOn === true} meals={hasMeals} />}
          {tab === 'training' && <Training entry={entry} onEntryDone={() => setEntry((e) => (e === 'plan' ? null : e))} onDone={() => setTab('heute')} onLive={setLiveWorkout} />}
          {tab === 'essen' && hasMeals && <MealsScreen port={port} now={env.now} fetchFn={env.fetchFn} account={account} entry={mealEntry} onEntryDone={() => setMealEntry(null)} onHeute={() => setTab('heute')} />}
          {tab === 'ausdauer' && hasEndurance && <Ausdauer hasRun={hasRun} hasBike={hasBike} />}
          {tab === 'coach' && <CoachScreen key={chatOnOpen ? 'chat' : 'week'} port={port} now={env.now} newId={env.newId} openChat={chatOnOpen} onChatClosed={() => { setChatOnOpen(false); setQuestion(null); setTab('heute'); }}
            ask={question ? { question, answer: (text) => sendQuestion({ type: 'gym-answer', question, text }) } : undefined} />}
          {tab === 'profil' && <Profil link={link} now={env.now} status={status} onLogout={onLogout} push={push.state} storage={env.storage} />}
          </Suspense>
        </ErrorBoundary>
      </main>
      {frame && (
        <nav aria-label="Seiten" className={`web-nav${typing ? ' web-nav-away' : ''}`} style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map(([t, label]) => (
            <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => { setEntry(null); setChatOnOpen(false); setTab(t); }}><Icon name={TAB_ICON[t]} />{label}</button>
          ))}
        </nav>
      )}
    </>
  );
}
