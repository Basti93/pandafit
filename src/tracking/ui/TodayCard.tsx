import { useState, type ReactNode } from 'react';
import { reasonSentence } from '../../shared/today';
import type { TrackedRecord } from '../../shared/records';
import { hasSport, planFor, type PlanDay } from '../../shared/week-plan';
import { planDayLabel } from './plan-text';
import type { TrackingPort } from '../ports';
import { TodayOnly } from './FrameControls';
import { useTodayAdvice } from './frame-hooks';
import { dateKeyOf, runView } from './run-view';
import { MainCard, Sheet } from './kit';

const RUN_KIND: Record<string, string> = { easy: 'locker', long: 'lang', test: 'Test' };
/** Today's sport from the week plan, or null without a plan for today. */
export const todayPlan = (weekplans: TrackedRecord[] | null, nowMs: number): PlanDay | null => planFor(weekplans ?? [], dateKeyOf(nowMs));

/** The strength plan of the day: its name, one line about it, notes, and the ways to it. */
/** `day`: the day (YYYY-MM-DD) the plan was made for; a day note of another day is not shown beside it. */
export type GymPart = { name: string | null; line: string | null; day?: string; notes?: ReactNode; start: () => void; view?: () => void };
type Props = {
  weekplans: TrackedRecord[] | null; runs: TrackedRecord[] | null; nowMs: number; gym?: GymPart; onRun?: () => void;
  /** On a bike day: the planned session as a line and a way to look at it. The ride itself starts on the Mac. */
  bike?: { line: string | null; view: () => void };
  /** Quiet extras at the end of the card, e.g. the mobility offer. */
  extra?: ReactNode;
};
type Advice = ReturnType<typeof useTodayAdvice>;

/**
 * Heute from the week plan, as the one "Jetzt dran" card: what today is for, with the one thing to do for it.
 * "Etwas anderes heute?" is a button that opens "Heute nur … Min" in a small sheet. Without a plan for today it shows nothing; the caller keeps its own view then.
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
          <p className="muted">Bo schlägt dir dann etwas für diese Zeit vor.</p>
          <TodayOnly frame={a.frame} date={date} onChange={(m) => { setOpen(false); void a.setToday(m).catch(() => {}); }} />
        </Sheet>
      )}
    </>
  );
}

function View({ weekplans, runs, nowMs, gym, onRun, bike, extra, a }: Props & { a?: Advice }) {
  const date = dateKeyOf(nowMs);
  const planned = todayPlan(weekplans, nowMs);
  const more = (notes?: ReactNode) => <>{notes}{extra}<Other a={a} date={date} /></>;
  if (a?.advice.done) return <MainCard kicker="Heute erledigt" title="Gut gemacht" text="Du hast heute schon trainiert." label="Heute" more={more()} />;
  // The advice is the headline whenever it is not the plan day unchanged; the plan day is then one muted line.
  const deviates = a !== undefined && (a.frame.mode === 'spontaneous' || (planned !== null && !a.advice.fromPlan));
  const adviceDay: PlanDay | null = a ? { date, sport: a.advice.sport, hardness: a.advice.hardness, fixed: false, ...(a.advice.also ? { also: a.advice.also } : {}) } : null;
  const useAdvice = a !== undefined && (deviates || planned === null);
  const today: PlanDay | null = useAdvice ? adviceDay : planned;
  if (!today) return null;
  const spontaneous = a?.frame.mode === 'spontaneous';
  const isGym = hasSport(today, 'gym');
  const run = hasSport(today, 'run') ? runView(runs ?? [], nowMs).week?.runs.find((r) => r.date === today.date) ?? null : null;
  // A run alone says what it is: "Laufen, 50 Min".
  const runAlone = today.sport === 'run' && !today.also && run !== null;
  const gymName = isGym ? gym?.name ?? null : null;
  const title = gymName ?? (useAdvice && a ? a.advice.label : runAlone ? `Laufen, ${run.minutes} Min${run.kind === 'easy' ? '' : `, ${RUN_KIND[run.kind] ?? ''}`}` : planDayLabel(today));
  const lines: (string | false | null | undefined)[] = [
    useAdvice && a && gymName && `${a.advice.label}.`,
    useAdvice && a && reasonSentence(a.advice.reason),
    deviates && !spontaneous && planned && `Geplant war: ${planDayLabel(planned)}.`,
    // A note of the week plan describes that day's session; beside the workout of another day's plan it would describe the wrong one.
    !useAdvice && !(gymName && gym?.day && gym.day !== today.date) && today.note,
    isGym && gym?.line,
    hasSport(today, 'run') && !runAlone && (run ? `Lauf: ${run.minutes} Min ${RUN_KIND[run.kind] ?? ''}`.trim() + '.' : 'Lauf heute nach Gefühl.'),
    hasSport(today, 'bike') && [bike?.line && `${bike.line}.`, 'Gestartet wird am Mac.'].filter(Boolean).join(' '),
    hasSport(today, 'mobility') && 'Heute ist Beweglichkeit dran.',
    today.sport === 'rest' && 'Erholung gehört zum Training.',
  ];
  // One main button; a jump to another place is the side button.
  const toRun = hasSport(today, 'run') && onRun ? { label: 'Zum Laufen', onClick: onRun } : undefined;
  const toBike = hasSport(today, 'bike') && bike ? { label: 'Ansehen', onClick: bike.view } : undefined;
  const start = isGym && gym ? { label: 'Training starten', onClick: gym.start } : undefined;
  const viewGym = isGym && gym?.view ? { label: 'Ansehen und anpassen', onClick: gym.view } : undefined;
  const primary = start ?? toRun;
  const secondary = start ? (toRun ?? viewGym ?? toBike) : toBike;
  return (
    <MainCard kicker="Jetzt dran" title={title} text={lines.filter(Boolean).join(' ') || undefined} primary={primary} secondary={secondary}
      label={useAdvice ? 'Heute' : 'Heute laut Wochenplan'} more={more(isGym && gym?.notes)} />
  );
}
