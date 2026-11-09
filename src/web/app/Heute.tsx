import { bodyOf } from '../../shared/record-bodies';
import { useMemo, useState } from 'react';
import { gymMinutes } from '../../shared/duration';
import { dayMonthLongOfKey, localDayKey, timeLabel, weekdayOfKey } from '../../shared/dates';
import { addDays, planFor } from '../../shared/week-plan';
import { bikeOf } from '../../tracking/ui';
import { TodayCard, todayPlan, type GymPart } from '../../tracking/ui/TodayCard';
import { DaySheet } from '../../tracking/ui/DaySheet';
import { useOpenProposals } from '../../tracking/ui/proposals';
import { useWeekDays } from '../../tracking/ui/week-days';
import { SPORT_ICON, weekCount, weekCountText, weekPathOf } from '../../tracking/ui/week-path';
import { planDayLabel } from '../../tracking/ui/plan-text';
import { MainCard, RowCard, WeekPath } from '../../tracking/ui/kit';
import { Finisher } from '../../tracking/ui/FinisherCard';
import { complaintsOpenIn, finisherOf, latestFinishedStrength } from '../../tracking/ui/finisher';
import { mergedActivities } from '../../tracking/ui/done-days';
import { MobilityOffer } from '../../tracking/ui/MobilityOffer';
import { usePortRecords } from '../../tracking/ui/hooks';
import { useApp } from '../AppContext';
import { planKeyOf, readDraft } from '../../tracking/plan-draft';
import { mobilityToShow, planIsStale, readPlan } from '../logic';
import { DayMeals } from '../MealsScreen';
import { TogetherCard, TogetherPage, togetherOf } from '../TogetherScreen';
import { CoachLine } from '../today/CoachLine';
import { dayClip } from '../../tracking/ui/panda-day';
import { dayLine } from '../../shared/day-text';

/** "14:44" today, "gestern 13:34" the day before, "Sa., 13:34" earlier: an old open workout shows as old. */
export const sinceText = (ms: number, now: number): string => {
  if (localDayKey(ms) === localDayKey(now)) return timeLabel(ms);
  const day = new Date(now); day.setDate(day.getDate() - 1);
  if (localDayKey(ms) === localDayKey(day.getTime())) return `gestern ${timeLabel(ms)}`;
  return `${new Date(ms).toLocaleDateString('de-DE', { weekday: 'short' })}, ${timeLabel(ms)}`;
};

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
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const daytexts = usePortRecords(port, 'daytext').records;
  const plan = (plans ?? []).find((r) => r.id === 'current');
  const p = readPlan(plan);
  const now = env.now();
  const dayKey = localDayKey(now);
  const week = useWeekDays(port, now);
  const session = useMemo(() => mobilityToShow(plan, mobility ?? [], now), [plan, mobility, now]);
  const today = todayPlan(weekplans, now);
  const proposals = useOpenProposals(port, now);
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

  const mobilityRow = session ? <MobilityOffer key={session.id} session={session} hideKey={`pandafit.mobility.notToday.${account}`} storage={env.storage} now={env.now} onDone={() => void markDone()} /> : undefined;

  // The strength plan: name and one line here, the exercises, the reason and the sets in the sheet "Nächstes Training" in Kraft.
  // A draft of this plan on this device (see plan-draft): the strength part says so.
  const adjusted = !!p?.workout && readDraft(env.storage, account, planKeyOf({ atMs: p.atMs, workout: p.workout })) !== null;
  const exercises = p?.workout?.exercises.length ?? 0;
  const gym: GymPart = {
    name: p?.workout?.name ?? null,
    line: p?.workout && exercises > 0 ? `Krafttraining, etwa ${gymMinutes(p.workout)} Minuten, ${exercises} ${exercises === 1 ? 'Übung' : 'Übungen'}` : null,
    start: () => goTraining(),
    view: exercises > 0 ? () => goTraining('plan') : undefined,
    notes: p && (
      <>
        {adjusted && <p className="muted">Angepasst</p>}
        {planIsStale(p.atMs, now) && <p className="muted">Der Plan ist schon etwas älter. Bo macht einen neuen, sobald er dazu kommt.</p>}
        {p.questions.length > 0 && <ul>{p.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
        {exercises === 0 && p.reason && <p className="muted">{p.reason}</p>}
      </>
    ),
  };
  // On a bike day: the planned session, and a way to look at it. The ride itself starts on the Mac.
  const bike = bikePlan && goBike ? { line: `${bikePlan.name}, ${bikePlan.minutes} Min`, view: goBike } : undefined;

  const tomorrow = addDays(dayKey, 1);
  const tomorrowPlan = planFor(weekplans ?? [], tomorrow);
  // The week path: the same rows as Woche. Without a plan only the days from Monday to today count.
  const path = weekPathOf(week.dates, week.rows, week.today);
  const count = weekCountText(weekCount(week.rows, week.current && !week.spontaneous ? week.current.days : null));
  // Nothing planned and nothing switched on: the one card offers to plan.
  const setup = !open && weekplans !== null && plans !== null && !today && !planning && !p;

  if (together && showTogether) return <TogetherPage t={together} now={now} onBack={() => setShowTogether(false)} />;
  return (
    <div className="tk-screen tk-heute">
      <header className="tk-datehead">
        <h1 className="tk-sr">Heute</h1>
        <p className="tk-dateline">{weekdayOfKey(dayKey)}, {dayMonthLongOfKey(dayKey)}</p>
      </header>
      {week.loaded && <WeekPath days={path} kicker="Dein Weg diese Woche" count={count} onPick={setSheetDate} />}
      <CoachLine text={dayLine(daytexts, account, dayKey).text} onAsk={goCoach} onProposal={proposals.length > 0 ? goCoach : undefined}
        pose={dayClip({ today, dateKey: dayKey, mobility: !!session, finisher: !!finisher, open: !!open, offset: 0 }) ?? 'greet'} />
      {/* One "Jetzt dran": an open workout, then the finish card, then the day of the plan. */}
      {open ? (
        <MainCard kicker="Läuft noch" title={bodyOf('workout', open).title} text={`Seit ${sinceText(bodyOf('workout', open).startMs, now)}`} label="Training läuft noch"
          primary={{ label: 'Weitermachen', onClick: () => goTraining('resume') }} more={mobilityRow} />
      ) : finisher ? <Finisher f={finisher} mobility={mobilityRow} />
        : setup ? (
          <MainCard kicker="Jetzt dran" title="Dein Plan" label="Was Pandafit planen kann"
            text="Krafttraining, Laufen und Essen schaltest du im Profil ein. Die Woche planst du dann mit Bo."
            primary={{ label: 'Woche planen', onClick: goCoach }} secondary={{ label: 'Im Profil auswählen', onClick: goProfile }} more={mobilityRow} />
        ) : <TodayCard port={port} weekplans={weekplans} runs={runs} nowMs={now} gym={gym} onRun={goRun} bike={bike} extra={mobilityRow} />}
      {meals && <DayMeals port={port} now={env.now} fetchFn={env.fetchFn} account={account} />}
      {tomorrowPlan && <RowCard icon={SPORT_ICON[tomorrowPlan.sport]} kicker="Morgen" title={planDayLabel(tomorrowPlan)} onClick={() => setSheetDate(tomorrow)} />}
      {together && <TogetherCard t={together} now={now} onOpen={() => setShowTogether(true)} />}
      {sheetDate && <DaySheet port={port} date={sheetDate} now={env.now} onClose={() => setSheetDate(null)} />}
    </div>
  );
}
