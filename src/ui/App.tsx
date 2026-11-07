import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { hrMaxFor } from '../shared/hr-zones';
import type { Profile } from '../shared/profiles';
import { useCoach } from './useCoach';
import { useServerProfile } from './useServerProfile';
import { useLanguageLearning } from './useLanguageLearning';
import { useRide } from './useRide';
import { FilmView } from './views/FilmView';
import { ProfileView } from './views/ProfileView';
import { RecoveryDialog } from './views/RecoveryDialog';
import { HealthView, type HealthRange } from './views/HealthView';
import { GarminProfileReview } from './views/GarminProfileReview';
import { ProfileSettingsView } from './views/ProfileSettingsView';
import { RideView } from './views/RideView';
import { StatusBar } from './views/StatusBar';
import { CoachView } from './views/CoachView';
import { coachScreen, DebriefView } from './views/DebriefCard';
import { FeedbackView } from './views/FeedbackView';
import { GymView } from './views/GymView';
import { CatalogScreen, HistoryScreen, RoutinesScreen, RunLookBack, RunScreen, RunSettingsCard, StatsScreen, WorkoutScreen } from '../tracking/ui';
import { statsVisible } from '../tracking/ui/StatsScreen';
import { durationNote } from '../shared/duration';
import { CoachScreen } from '../tracking/ui/CoachScreen';
import { TodayCard } from '../tracking/ui/TodayCard';
import type { TrackingPort } from '../tracking/ports';
import { usePortRecords } from '../tracking/ui/hooks';
import { runView } from '../tracking/ui/run-view';
import type { LoggedWorkout } from '../shared/records';
import { activeItem, HOME, menuItems, open, showMenu, type MenuItem, type TrackScreen, type Views } from './nav';
import { MenuBar } from './views/MenuBar';
import { MealsView } from './views/MealsView';
import { MealSettingsCard } from './views/MealSettingsCard';
import { ProfileExtras } from './views/ProfileExtras';
import { homeScreen, OverviewView } from './views/OverviewView';
import { HistoryView } from './views/HistoryView';
import { TogetherView } from './views/TogetherView';
import { WordCard } from './views/WordCard';
import { passById } from '../shared/passes';
import { PassCard } from './pass/PassCard';
import { PassGuard } from './pass/PassGuard';
import { PassView } from './pass/PassView';

const STATUS_WAIT_MS = 500;
const CALM_FRACTION = 0.75;
const PASS_KEY = 'bike-coach.pass';
const passStored = (): boolean => { try { return localStorage.getItem(PASS_KEY) !== 'off'; } catch { return true; } };

export const App = () => {
  const ride = useRide();
  return (
    <div className="shell">
      {window.location.hash !== '#film' && <StatusBar state={ride.state} connected={ride.connected} send={ride.send} reportPath={ride.reportPath} />}
      <div className="page"><Page ride={ride} /></div>
    </div>
  );
};

/** The strength page, told whether a workout is still open so the way back into it is one click. */
const StrengthPage = ({ port, ...props }: Omit<ComponentProps<typeof GymView>, 'openWorkout'> & { port: TrackingPort }) => {
  const workouts = usePortRecords(port, 'workout').records;
  return <GymView {...props} openWorkout={(workouts ?? []).some((r) => (r.body as LoggedWorkout).endMs === null)} />;
};

/** Stands in for the port while there is none, so the hook can always run. */
const NO_PORT: TrackingPort = { list: async () => [], put: async (r) => ({ kept: false, updatedMs: r.updatedMs }), subscribe: () => () => {}, syncState: () => ({ pending: 0, lastOkMs: null }) };
const runNow = () => Date.now();
const runNewId = () => crypto.randomUUID();

/** The meal status has arrived: a missing one in an old coach counts as off. */
const arrivedMeals = (coach: { statusArrived?: boolean }): boolean => coach.statusArrived ?? true;

const Page = ({ ride }: { ride: ReturnType<typeof useRide> }) => {
  const { click, state, offer, clearOffer, connected, fresh, send, error } = ride;
  const [picked, setPicked] = useState<Profile | null>(null);
  // Always the saved state, otherwise changes would be lost on the next save or start.
  const profile = state?.profiles.find((p) => p.id === picked?.id) ?? picked;
  // One place for what is open. A menu item replaces it as a whole, so no old flag lingers.
  const [v, setV] = useState<Views>(HOME);
  const patch = (p: Partial<Views>) => setV((x) => (Object.entries(p).every(([k, val]) => x[k as keyof Views] === val) ? x : { ...x, ...p }));
  const setProfile = (p: Profile | null) => { setPicked(p); setV(HOME); };
  const coach = useCoach(profile?.id ?? state?.ride?.profileId ?? state?.profiles[0]?.id ?? null);
  useServerProfile(profile ?? null, coach.serverProfile, !!state?.engine || !!state?.ride, send, connected && fresh && state !== null);
  const hevy = coach.hevy ?? { state: 'idle' as const };
  // The strength page belongs to one profile and needs strength training.
  useEffect(() => { if (v.strengthFor !== null && (!coach.gym || v.strengthFor !== profile?.id)) patch({ strengthFor: null }); }, [coach.gym, v.strengthFor, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const runRecords = usePortRecords(coach.tracking ?? NO_PORT, 'run').records;
  const weekplanRecords = usePortRecords(coach.tracking ?? NO_PORT, 'weekplan').records;
  const runOn = !!coach.tracking && runView(runRecords ?? [], Date.now()).visible;
  const mealsOn = coach.meals?.settings.on === true;
  const statsRecords = usePortRecords(coach.tracking ?? NO_PORT, 'stats').records;
  const workoutRecords = usePortRecords(coach.tracking ?? NO_PORT, 'workout').records;
  const statsOn = !!coach.tracking && statsVisible(statsRecords, workoutRecords);
  useEffect(() => { if (v.stats && !statsOn && statsRecords !== null && workoutRecords !== null) patch({ stats: false }); }, [v.stats, statsOn, statsRecords, workoutRecords]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (v.run && !runOn && runRecords !== null) patch({ run: false }); }, [v.run, runOn, runRecords]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (v.meals && !mealsOn && arrivedMeals(coach)) patch({ meals: false }); }, [v.meals, mealsOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (v.trackFor && (!coach.gym || v.trackFor.profileId !== profile?.id)) patch({ trackFor: null }); }, [coach.gym, v.trackFor, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The bike page chosen from the overview belongs to one profile and needs the overview to exist.
  // Test mocks without the field count as arrived.
  const arrived = coach.statusArrived ?? true;
  useEffect(() => { if (v.bikeFor !== null && (v.bikeFor !== profile?.id || (arrived && hevy.state === 'idle' && !coach.gym))) patch({ bikeFor: null }); }, [hevy.state, coach.gym, arrived, v.bikeFor, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Without a status the rider still gets the bike page after a short wait; a late status does not take it away again.
  useEffect(() => {
    if (!profile || arrived) return undefined;
    const id = profile.id;
    const timer = setTimeout(() => patch({ bikeFor: id }), STATUS_WAIT_MS);
    return () => clearTimeout(timer);
  }, [profile?.id, arrived]); // eslint-disable-line react-hooks/exhaustive-deps
  const language = useLanguageLearning(state?.ride?.profileId ?? profile?.id ?? null);
  const [passOn, setPassOn] = useState(passStored);
  const passToggle = <button className="secondary" onClick={() => { try { localStorage.setItem(PASS_KEY, passOn ? 'off' : 'on'); } catch { /* then it only applies until the restart */ } setPassOn(!passOn); }}>Berg: {passOn ? 'an' : 'aus'}</button>;
  const languageToggle = <button className="secondary" onClick={language.toggle}>Sprachen lernen: {language.enabled ? 'an' : 'aus'}</button>;
  if (window.location.hash === '#film') return <FilmView state={state} send={send} />;
  if (!connected) return <main>Fahrdienst startet…</main>;
  const dialog = offer && (
    <RecoveryDialog
      offer={offer}
      profileName={state?.profiles.find((p) => p.id === offer.profileId)?.name ?? 'Unbekanntes Profil'}
      send={send}
      onClose={clearOffer}
    />
  );
  const notice = error && <div role="alert">{error}</div>;
  if (state?.engine) {
    // Language only in calm phases, never in hard sections or above your own heart rate limit.
    const c = coach.state;
    const rideProfile = state.profiles.find((p) => p.id === state.ride?.profileId);
    const maxHr = rideProfile?.maxHrBpm;
    const rideHrMax = rideProfile ? hrMaxFor(rideProfile, Date.now())?.bpm : undefined;
    const calm = c !== null && !state.engine.paused
      && state.session?.steps[state.engine.stepIndex]?.kind !== 'grade'
      && (state.engine.targetW ?? Infinity) <= c.ftpW * CALM_FRACTION
      && !(maxHr && (state.latest.hrBpm ?? 0) >= maxHr);
    return <>{notice}{dialog}<RideView state={state} send={send} hrMaxBpm={rideHrMax} tools={<>{passToggle}{languageToggle}</>} mountain={passOn && c && state.ride ? <PassGuard><PassView pass={passById(c.pass?.selectedId)} profileId={state.ride.profileId} startM={c.pass?.distanceM?.[passById(c.pass?.selectedId).id] ?? 0} powerW={state.latest.powerW} paused={state.engine.paused} send={coach.send} /></PassGuard> : undefined} extra={c && language.enabled ? <WordCard calm={calm} state={c} send={coach.send} click={click} /> : null} /></>;
  }
  if (!profile) return <>{notice}<ProfileView onTogether={coach.together ? () => patch({ together: true }) : undefined} profiles={state?.profiles ?? []} onPick={setProfile} onAdd={(p) => send({ type: 'save-profile', profile: p })} /></>;

  const home = homeScreen(hevy, coach.gym != null);
  // A rider with Hevy and no Garmin at all sees no Garmin sections; any other Garmin state shows what a Garmin-only rider sees.
  const garminSections = home === 'bike' || coach.garmin?.state !== 'idle';
  const requestHealth = (range: HealthRange): void => {
    if (garminSections) coach.send({ type: 'garmin-health', profileId: profile.id, rangeDays: range });
  };
  const go = (item: MenuItem): void => {
    const next = open(item, profile.id);
    setV(next);
    if (next.health !== undefined) requestHealth(next.health);
  };
  const waiting = !arrived && v.bikeFor !== profile.id && !v.history && coachScreen(coach.state) === 'coach';
  const menu = showMenu({ profile: true, riding: false, film: false, waiting }) && (
    <MenuBar
      items={menuItems({ overview: home === 'overview', gym: !!coach.gym, history: !!coach.state, health: coach.garmin?.state === 'connected' || home === 'overview', together: !!coach.together, meals: mealsOn, run: runOn, stats: statsOn, coach: !!coach.tracking })}
      active={activeItem(v, profile.id, home)} name={profile.name} avatar={profile.avatar}
      onGo={go} onSwitch={() => setProfile(null)} />
  );
  const page = (body: ReactNode) => <>{notice}{menu}{body}</>;

  if (v.profile) {
    const settings = (
      <>
        {languageToggle}
        {coach.tracking && <RunSettingsCard port={coach.tracking} now={runNow} />}
        {!coach.gym && coach.connected && <button className="secondary" onClick={() => coach.send({ type: 'gym-start', profileId: profile.id })}>Krafttraining starten</button>}
      </>
    );
    return page(<ProfileSettingsView profile={profile} ftpW={coach.state?.ftpW ?? profile.ftpW} coachConnected={coach.connected && coach.state !== null} coachHome={coach.coachHome} sendRide={send} sendCoach={coach.send} onBack={() => setV(HOME)} onDeleted={() => setProfile(null)}
      extra={<ProfileExtras profileId={profile.id} coachConnected={coach.connected} send={coach.send} garmin={coach.garmin ?? { state: 'idle' }} garminSync={coach.garminSync} upload={coach.state?.garminUpload} hevy={coach.hevy} account={coach.account} coachHome={coach.coachHome} settings={settings} settingsNote={!coach.gym && coach.connected ? 'Mit „Krafttraining starten“ plant Pandafit auch dein Krafttraining, mit oder ohne Hevy. Danach findest du es oben unter Kraft.' : undefined}
        meals={coach.connected ? <MealSettingsCard profileId={profile.id} settings={coach.meals?.settings} coachConnected={coach.connected && coach.meals != null} send={coach.send} /> : undefined} />} />);
  }
  if (v.health !== undefined) return page(<HealthView data={coach.garminHealth} range={v.health} onRange={(range) => { patch({ health: range }); requestHealth(range); }} strength={coach.strengthHealth} rides={coach.state?.summaries} garmin={garminSections} readiness={coach.garminReadiness} sync={coach.garminSync} />);
  if (v.review && coach.garminSuggestion) return page(<GarminProfileReview profile={profile} ftpW={coach.state?.ftpW ?? profile.ftpW} suggestion={coach.garminSuggestion} sendRide={send} sendCoach={coach.send} onBack={() => patch({ review: false })} />);
  if (v.together && coach.together) return page(<TogetherView together={coach.together} />);
  if (v.run && runOn && coach.tracking) return page(<main className="home"><RunScreen port={coach.tracking} now={runNow} newId={runNewId} /></main>);
  if (v.coach && coach.tracking) return page(<main className="home"><CoachScreen port={coach.tracking} now={runNow} newId={runNewId} /></main>);
  if (v.stats && statsOn && coach.tracking) return page(<main className="home"><StatsScreen port={coach.tracking} now={runNow} /></main>);
  if (v.meals && mealsOn && coach.meals) return page(<MealsView key={profile.id} profileId={profile.id} meals={coach.meals} send={coach.send} />);
  if (v.trackFor && v.trackFor.profileId === profile.id && coach.gym && coach.tracking) {
    const port = coach.tracking;
    const track = v.trackFor;
    const to = (screen: TrackScreen) => patch({ trackFor: { ...track, screen, routine: null } });
    return page(<main className="home">
      <div className="top"><div className="row">
        <button className="ghost" onClick={() => setV({ ...HOME, strengthFor: profile.id })}>Zurück zu Kraft</button>
        <button className="ghost" onClick={() => to('workout')} aria-pressed={track.screen === 'workout'}>Training</button>
        <button className="ghost" onClick={() => to('routines')} aria-pressed={track.screen === 'routines'}>Routinen</button>
        <button className="ghost" onClick={() => to('history')} aria-pressed={track.screen === 'history'}>Bisherige Trainings</button>
        <button className="ghost" onClick={() => to('catalog')} aria-pressed={track.screen === 'catalog'}>Übungen</button>
      </div></div>
      {track.screen === 'workout' && <WorkoutScreen key={track.routine ? 'routine' : 'plan'} port={port} plan={track.routine ? null : coach.gym.state.next?.workout ?? null} routine={track.routine} />}
      {track.screen === 'routines' && <RoutinesScreen port={port} onStart={(routine) => patch({ trackFor: { ...track, screen: 'workout', routine } })} />}
      {track.screen === 'history' && <HistoryScreen port={port} />}
      {track.screen === 'catalog' && <CatalogScreen port={port} />}
    </main>);
  }
  if (v.strengthFor === profile.id && coach.gym) {
    const props = { profileId: profile.id, gym: coach.gym, preview: coach.gymPreview, previewFailed: coach.gymPreviewFailed, result: coach.gymConfirmResult, send: coach.send, clear: coach.clearGym, mobility: coach.mobility,
      onTrack: coach.tracking ? (screen: TrackScreen) => setV({ ...HOME, trackFor: { profileId: profile.id, screen, routine: null } }) : undefined };
    return page(coach.tracking ? <StrengthPage port={coach.tracking} {...props} /> : <GymView {...props} />);
  }
  if (waiting) return <>{notice}<main aria-busy="true" /></>;
  const overviewOpen = home === 'overview' && v.bikeFor !== profile.id && !v.history && coachScreen(coach.state) === 'coach' && !coach.state?.awaitingFeedback;
  if (overviewOpen) return page(<OverviewView name={profile.name} avatar={profile.avatar} bikeNext={coach.state?.next?.session.name} strengthNext={coach.gym?.state.next?.workout.name} onBike={() => go('rad')} onStrength={() => go('kraft')} onHealth={() => go('gesundheit')}
    today={coach.tracking ? <TodayCard port={coach.tracking} weekplans={weekplanRecords} runs={runRecords} nowMs={Date.now()} onRun={runOn ? () => go('laufen') : undefined}
      gym={<><p>{coach.gym?.state.next?.workout.name ?? 'Dein Krafttraining'}</p>{coach.gym?.state.next?.workout && coach.gym.state.next.workout.exercises.length > 0 && <p className="muted">{durationNote(coach.gym.state.next.workout)}</p>}<button type="button" onClick={() => go('kraft')}>Zum Krafttraining</button></>}
      bike={<><p>{coach.state?.next?.session.name ?? 'Deine Radeinheit'}</p><button type="button" onClick={() => go('rad')}>Zur Radeinheit</button></>} /> : undefined} />);
  return page(
    v.history && coach.state ? <HistoryView coachHome={coach.coachHome} state={coach.state} detail={coach.detail} send={coach.send} garminConnected={coach.garmin?.state === 'connected'} lookBack={coach.tracking ? <RunLookBack port={coach.tracking} now={runNow} /> : undefined} /> : coachScreen(coach.state) === 'debrief' && coach.state?.debriefToShow
      ? <DebriefView profileId={profile.id} debrief={coach.state.debriefs![coach.state.debriefToShow]} next={coach.state.next} thinking={coach.debriefing} title={coach.state.summaries.find((r) => r.rideId === coach.state?.debriefToShow)?.sessionName} send={coach.send} />
      : coach.state?.awaitingFeedback
      ? <FeedbackView garminConnected={coach.garmin?.state === 'connected'} upload={coach.state.garminUpload} debrief={coach.state.debriefs?.[coach.state.awaitingFeedback]} debriefing={coach.debriefing} next={coach.state.next} together={coach.together} profileId={profile.id} rideId={coach.state.awaitingFeedback} send={coach.send} detail={coach.detail} summaries={coach.state.summaries} summary={coach.state.summaries.find((r) => r.rideId === coach.state?.awaitingFeedback)} />
      : <CoachView coachHome={coach.coachHome} mobility={coach.mobility} garminSuggestion={coach.garminSuggestion} onReviewGarmin={() => patch({ review: true })} garmin={coach.garmin} garminSync={coach.garminSync} garminReadiness={coach.garminReadiness} onProfile={() => go('profil')} passCard={<PassCard profileId={profile.id} pass={coach.state?.pass} send={coach.send} />} together={coach.together} profile={profile} state={coach.state} thinking={coach.thinking} coachConnected={coach.connected} sendRide={send} sendCoach={coach.send} />,
  );
};
