import { useState, type ReactNode } from 'react';
import { reasonSentence } from '../../shared/today';
import type { TrackedRecord } from '../../shared/records';
import { dayLabel, HARDNESS_LABEL, hasSport, minutesText, planFor, SPORT_LABEL, type PlanDay } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import { TodayOnly } from './FrameControls';
import { useTodayAdvice } from './frame-hooks';
import { dateKeyOf, runView } from './run-view';
import { Sheet } from './kit';

const RUN_KIND: Record<string, string> = { easy: 'locker', long: 'lang', test: 'Test' };
/** One session: "Kraft, mittel". Two sessions of the same hardness: "Kraft + Rad locker", else each with its own. */
export const planDayLabel = (d: PlanDay) => {
  if (!d.also || d.sport === 'rest') return dayLabel(d, (_, first) => (first && d.long ? ', lang' : ''));
  const min = d.also.minutes ? ` ${minutesText(d.also)}` : '';
  if (d.also.hardness === d.hardness) return `${SPORT_LABEL[d.sport]} + ${SPORT_LABEL[d.also.sport]}${min} ${HARDNESS_LABEL[d.hardness]}`;
  return `${SPORT_LABEL[d.sport]} ${HARDNESS_LABEL[d.hardness]} + ${SPORT_LABEL[d.also.sport]}${min} ${HARDNESS_LABEL[d.also.hardness]}`;
};

/** Today's sport from the week plan, or null without a plan for today. */
export const todayPlan = (weekplans: TrackedRecord[] | null, nowMs: number): PlanDay | null => planFor(weekplans ?? [], dateKeyOf(nowMs));

type Props = {
  weekplans: TrackedRecord[] | null; runs: TrackedRecord[] | null; nowMs: number; gym: ReactNode; onRun?: () => void;
  /** On the Mac: the bike session to start; elsewhere a note that it starts on the Mac. */
  bike?: ReactNode;
};
type Advice = ReturnType<typeof useTodayAdvice>;

/**
 * Heute from the week plan: what today is for, with the one thing to do for it. `gym` is the strength plan, shown on a strength day.
 * "Etwas anderes heute?" is a row that opens "Heute nur … Min" in a small sheet. Without a plan for today it shows nothing; the caller keeps its own view then.
 * With a `port` it also knows the frame: the advice (in spontaneous mode instead of the plan) and "Heute nur".
 */
export function TodayCard(props: Props & { port?: TrackingPort }) {
  return props.port ? <Connected {...props} port={props.port} /> : <View {...props} />;
}

function Connected({ port, ...props }: Props & { port: TrackingPort }) {
  const a = useTodayAdvice(port, props.nowMs);
  return <View {...props} a={a} />;
}

/** "Etwas anderes heute?": a button under the card; it opens a small sheet with the minute chips for today. */
function Other({ a, date }: { a?: Advice; date: string }) {
  const [open, setOpen] = useState(false);
  if (!a) return null;
  return (
    <>
      <button type="button" className="secondary tk-other" aria-haspopup="dialog" onClick={() => setOpen(true)}>Etwas anderes heute?</button>
      {open && (
        <Sheet size="small" title="Etwas anderes heute?" onClose={() => setOpen(false)}>
          <p className="muted">Der Coach schlägt dir dann etwas für diese Zeit vor.</p>
          <TodayOnly frame={a.frame} date={date} onChange={(m) => { setOpen(false); void a.setToday(m).catch(() => {}); }} />
        </Sheet>
      )}
    </>
  );
}

function View({ weekplans, runs, nowMs, gym, onRun, bike, a }: Props & { a?: Advice }) {
  const date = dateKeyOf(nowMs);
  const planned = todayPlan(weekplans, nowMs);
  // The advice is the headline whenever it is not the plan day unchanged; the plan day is then one muted line.
  const deviates = a !== undefined && (a.frame.mode === 'spontaneous' || (planned !== null && !a.advice.fromPlan));
  const adviceDay: PlanDay | null = a ? { date, sport: a.advice.sport, hardness: a.advice.hardness, fixed: false, ...(a.advice.also ? { also: a.advice.also } : {}) } : null;
  const today: PlanDay | null = adviceDay && deviates ? adviceDay : planned;
  if (a?.advice.done) {
    return (
      <section className="card tk-today-card" aria-label="Heute">
        <h2>Du hast heute schon trainiert. Gut gemacht!</h2>
        <Other a={a} date={date} />
      </section>
    );
  }
  if (!today) {
    if (!a) return null;
    return (
      <section className="card tk-today-card" aria-label="Heute">
        <h2>{a.advice.label}</h2>
        <p className="muted">{reasonSentence(a.advice.reason)}</p>
        {/* One card: the suggestion and the way to it. */}
        {adviceDay && hasSport(adviceDay, 'gym') && gym}
        {adviceDay && hasSport(adviceDay, 'run') && onRun && <button type="button" onClick={onRun}>Zum Laufen</button>}
        {adviceDay && hasSport(adviceDay, 'bike') && (bike ?? <p>Die Radeinheit startest du am Mac.</p>)}
        <Other a={a} date={date} />
      </section>
    );
  }
  const spontaneous = a?.frame.mode === 'spontaneous';
  const run = hasSport(today, 'run') ? runView(runs ?? [], nowMs).week?.runs.find((r) => r.date === today.date) ?? null : null;
  // A run alone says what it is: "Laufen, 50 Min".
  const runAlone = today.sport === 'run' && !today.also && run !== null;
  const title = runAlone ? `Laufen, ${run.minutes} Min${run.kind === 'easy' ? '' : `, ${RUN_KIND[run.kind] ?? ''}`}` : deviates && a ? a.advice.label : planDayLabel(today);
  return (
    <section className="card tk-today-card" aria-label={deviates ? 'Heute' : 'Heute laut Wochenplan'}>
      <h2>{title}</h2>
      {deviates && a && <p className="muted">{reasonSentence(a.advice.reason)}</p>}
      {deviates && !spontaneous && planned && <p className="muted">Geplant war: {planDayLabel(planned)}</p>}
      {!deviates && today.note && <p className="muted">{today.note}</p>}
      {hasSport(today, 'gym') && gym}
      {hasSport(today, 'run') && (
        <>
          {!runAlone && <p>{run ? `Lauf: ${run.minutes} Min ${RUN_KIND[run.kind] ?? ''}`.trim() : 'Lauf heute nach Gefühl.'}</p>}
          {onRun && <button type="button" onClick={onRun}>Zum Laufen</button>}
        </>
      )}
      {hasSport(today, 'bike') && (bike ?? <p>Die Radeinheit startest du am Mac.</p>)}
      {hasSport(today, 'mobility') && <p>Heute ist Beweglichkeit dran.</p>}
      {today.sport === 'rest' && <p>Erholung gehört zum Training.</p>}
      <Other a={a} date={date} />
    </section>
  );
}
