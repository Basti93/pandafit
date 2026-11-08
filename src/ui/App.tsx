import { useState, type ReactNode } from 'react';
import { hrMaxFor } from '../shared/hr-zones';
import type { Profile } from '../shared/profiles';
import { useCoach } from './useCoach';
import { useServerProfile } from './useServerProfile';
import { useLanguageLearning } from './useLanguageLearning';
import { useRide } from './useRide';
import { FilmView } from './views/FilmView';
import { ProfileView } from './views/ProfileView';
import { RecoveryDialog } from './views/RecoveryDialog';
import { GarminProfileReview } from './views/GarminProfileReview';
import { ProfileSettingsView } from './views/ProfileSettingsView';
import { RideView } from './views/RideView';
import { StatusBar } from './views/StatusBar';
import { CoachView } from './views/CoachView';
import { coachScreen, DebriefView } from './views/DebriefCard';
import { FeedbackView } from './views/FeedbackView';
import { activeItem, HOME, menuItems, open, showMenu, type MenuItem, type Views } from './nav';
import { MenuBar } from './views/MenuBar';
import { ProfileExtras } from './views/ProfileExtras';
import { MoreInWeb } from './views/WebLink';
import { WordCard } from './views/WordCard';
import { passById } from '../shared/passes';
import { PassCard } from './pass/PassCard';
import { PassGuard } from './pass/PassGuard';
import { PassView } from './pass/PassView';

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
  if (!profile) return <>{notice}{dialog}<ProfileView profiles={state?.profiles ?? []} onPick={setProfile} onAdd={(p) => send({ type: 'save-profile', profile: p })} /></>;

  const garminConnected = coach.garmin?.state === 'connected';
  const go = (item: MenuItem): void => setV(open(item));
  const menu = showMenu({ profile: true, riding: false, film: false, waiting: false }) && (
    <MenuBar items={menuItems()} active={activeItem(v)} name={profile.name} avatar={profile.avatar} onGo={go} onSwitch={() => setProfile(null)} />
  );
  const page = (body: ReactNode) => <>{notice}{dialog}{menu}{body}</>;

  if (v.profile) {
    return page(<ProfileSettingsView profile={profile} ftpW={coach.state?.ftpW ?? profile.ftpW} coachConnected={coach.connected && coach.state !== null} coachHome={coach.coachHome} sendRide={send} sendCoach={coach.send} onBack={() => setV(HOME)} onDeleted={() => setProfile(null)}
      extra={<ProfileExtras profileId={profile.id} coachConnected={coach.connected} send={coach.send} garmin={coach.garmin ?? { state: 'idle' }} garminSync={coach.garminSync} upload={coach.state?.garminUpload} hevy={coach.hevy} account={coach.account} coachHome={coach.coachHome} settings={languageToggle} />} />);
  }
  if (v.review && coach.garminSuggestion) return page(<GarminProfileReview profile={profile} ftpW={coach.state?.ftpW ?? profile.ftpW} suggestion={coach.garminSuggestion} sendRide={send} sendCoach={coach.send} onBack={() => patch({ review: false })} />);
  const webOrigin = coach.account.webOrigin ?? null;
  const more = <MoreInWeb origin={webOrigin} />;
  return page(
    coachScreen(coach.state) === 'debrief' && coach.state?.debriefToShow
      ? <><DebriefView profileId={profile.id} debrief={coach.state.debriefs![coach.state.debriefToShow]} next={coach.state.next} thinking={coach.debriefing} title={coach.state.summaries.find((r) => r.rideId === coach.state?.debriefToShow)?.sessionName} send={coach.send} />{more}</>
      : coach.state?.awaitingFeedback
      ? <><FeedbackView garminConnected={garminConnected} upload={coach.state.garminUpload} debrief={coach.state.debriefs?.[coach.state.awaitingFeedback]} debriefing={coach.debriefing} next={coach.state.next} together={coach.together} profileId={profile.id} rideId={coach.state.awaitingFeedback} send={coach.send} detail={coach.detail} summaries={coach.state.summaries} summary={coach.state.summaries.find((r) => r.rideId === coach.state?.awaitingFeedback)} />{more}</>
      : <CoachView coachHome={coach.coachHome} webOrigin={webOrigin} garminSuggestion={coach.garminSuggestion} onReviewGarmin={() => patch({ review: true })} garmin={coach.garmin} garminSync={coach.garminSync} garminReadiness={coach.garminReadiness} onProfile={() => go('profil')} passCard={<PassCard profileId={profile.id} pass={coach.state?.pass} send={coach.send} />} profile={profile} state={coach.state} thinking={coach.thinking} coachConnected={coach.connected} sendRide={send} sendCoach={coach.send} />,
  );
};
