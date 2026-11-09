import { bodyOf } from '../../shared/record-bodies';
import { useMemo, useRef, useState } from 'react';
import { durationNote } from '../../shared/duration';
import { localDayKey, timeLabel } from '../../shared/dates';
import { bikeOf } from '../../tracking/ui';
import { TodayCard, todayPlan } from '../../tracking/ui/TodayCard';
import { useWaitingProposal, WaitingProposal } from '../../tracking/ui/WaitingProposal';
import { Finisher } from '../../tracking/ui/FinisherCard';
import { complaintsOpenIn, finisherOf, latestFinishedStrength } from '../../tracking/ui/finisher';
import { mergedActivities } from '../../tracking/ui/done-days';
import { MobilityOffer } from '../../tracking/ui/MobilityOffer';
import { usePortRecords } from '../../tracking/ui/hooks';
import { useApp } from '../AppContext';
import { planKeyOf, readDraft } from '../../tracking/plan-draft';
import { mobilityToShow, planIsStale, readPlan } from '../logic';
import { DayMeals } from '../MealsScreen';
import { YesterdayTraining } from '../today/YesterdayTraining';
import { TomorrowTraining } from '../today/TomorrowTraining';
import { TogetherCard, TogetherPage, togetherOf } from '../TogetherScreen';
import { DayHead } from '../today/DayHead';
import { CoachLine } from '../today/CoachLine';
import { dayClip } from '../../tracking/ui/panda-day';
import { BodyCard } from '../today/BodyCard';
import { shiftDay, swipeIgnored, swipeStep, type DayOffset } from '../today/day-nav';
import { dayLine } from '../../shared/day-text';
import { healthOf } from '../../tracking/ui/health-view';

/** "14:05", or with the day when it was not today. */
/** "14:44" today, "gestern 13:34" the day before, "Sa., 13:34" earlier: an old open workout shows as old. */
export const sinceText = (ms: number, now: number): string => {
  if (localDayKey(ms) === localDayKey(now)) return timeLabel(ms);
  const day = new Date(now); day.setDate(day.getDate() - 1);
  if (localDayKey(ms) === localDayKey(day.getTime())) return `gestern ${timeLabel(ms)}`;
  return `${new Date(ms).toLocaleDateString('de-DE', { weekday: 'short' })}, ${timeLabel(ms)}`;
};

/** The time one calendar day before or after, at the same clock time. */
export const shiftMs = (ms: number, days: number): number => { const d = new Date(ms); d.setDate(d.getDate() + days); return d.getTime(); };

export function Heute({ goTraining, goRun, goBike, goCoach, goProfile, meals, planning }: { goTraining: (entry?: 'resume' | 'plan') => void; goRun?: () => void; goBike?: () => void; goCoach: () => void; goProfile: () => void; meals: boolean; /** Something is switched on (strength plan, meals, running, a bike plan): then the "what can I plan" card goes. */ planning: boolean }) {
  const { port, env, account } = useApp();
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
  const open = (workouts ?? []).filter((r) => bodyOf('workout', r).endMs === null).sort((x, y) => bodyOf('workout', y).startMs - bodyOf('workout', x).startMs)[0];

  const complaints = usePortRecords(port, 'complaint').records;
  const finished = latestFinishedStrength(workouts, now);
  // A workout still open is the one thing to do: no finish card for an earlier one beside it.
  const finisher = finished && !open ? finisherOf({ workout: finished, nowMs: now, today, activities: mergedActivities(activities, workouts).items, complaintsOpen: complaintsOpenIn(complaints) }) : null;

  const markDone = async () => {
    if (!session) return;
    try { await port.put({ kind: 'mobility', id: session.id, updatedMs: env.now(), deleted: false, body: { doneMs: env.now(), forSession: session.forSession } }); } catch { /* shown again next time */ }
  };

  const mobilityRow = session && <MobilityOffer key={session.id} session={session} hideKey={`pandafit.mobility.notToday.${account}`} storage={env.storage} now={env.now} onDone={() => void markDone()} />;

  // The strength plan: on a strength day inside the week plan's card, without a week plan as its own card.
  // Name and time in one line, the exercises in two; the reason, the sets and the outlook in the sheet "Nächstes Training" in Kraft.
  // A draft of this plan on this device (see plan-draft): the strength part says so.
  const adjusted = !!p?.workout && readDraft(env.storage, account, planKeyOf({ atMs: p.atMs, workout: p.workout })) !== null;
  const toTraining = <button type="button" onClick={() => goTraining()}>Zum Krafttraining</button>;
  const gym = p ? (
    <>
      {p.workout && <p className="muted"><span>{p.workout.name}</span>{p.workout.exercises.length > 0 ? ` · ${durationNote(p.workout)}` : ''}</p>}
      {p.workout && p.workout.exercises.length > 0 && <p className="muted tk-clamp">{p.workout.exercises.map((e) => e.title).join(', ')}</p>}
      {planIsStale(p.atMs, now) && <p className="muted">Der Plan ist schon etwas älter. Der Coach macht einen neuen, sobald er dazu kommt.</p>}
      {p.questions.length > 0 && <ul>{p.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
      {toTraining}
      {p.workout && p.workout.exercises.length > 0
        ? <>
          {adjusted && <p className="muted">Angepasst</p>}
          <button type="button" className="secondary" onClick={() => goTraining('plan')}>Ansehen und anpassen</button>
        </>
        : p.reason && <p className="muted">{p.reason}</p>}
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
          <h2>{bodyOf('workout', open).title} läuft seit {sinceText(bodyOf('workout', open).startMs, now)}</h2>
          <button type="button" onClick={() => goTraining('resume')}>Weitermachen</button>
        </section>
      )}
      <CoachLine text={dayLine(daytexts, account, dayKey).text} onAsk={goCoach} pose={dayClip({ today, dateKey: dayKey, mobility: !!session, finisher: !!finisher, open: !!open, offset }) ?? 'greet'} />
      {/* A workout that is open is the one thing to do: no day card beside it. */}
      {!open && <TodayCard port={port} weekplans={weekplans} runs={runs} nowMs={now} gym={gym} onRun={goRun} bike={bike} />}
      {!open && weekplans !== null && plans !== null && !today && !planning && !p && (
        <section className="card" aria-label="Was Pandafit planen kann">
          <h2>Was soll Pandafit für dich planen?</h2>
          <p className="muted">Krafttraining, Laufen und Essen schaltest du im Profil ein. Die Woche planst du dann mit dem Coach.</p>
          <div className="tk-row">
            <button type="button" className="secondary" onClick={goCoach}>Woche planen</button>
            <button type="button" className="secondary" onClick={goProfile}>Im Profil auswählen</button>
          </div>
        </section>
      )}
      {!open && waiting && <WaitingProposal onOpen={goCoach} />}
      {meals && <DayMeals port={port} now={env.now} fetchFn={env.fetchFn} account={account} offset={0} />}
      {finisher ? <Finisher f={finisher} mobility={mobilityRow} /> : mobilityRow}
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
