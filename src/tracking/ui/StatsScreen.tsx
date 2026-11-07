import { useMemo, useState } from 'react';
import { STATE_LABELS, type GroupBalance } from '../../shared/muscle-balance';
import type { LoggedWorkout, TrackedRecord } from '../../shared/records';
import { readStats, SPORTS, STATS_ID, type Sport, type StatsBody } from '../../shared/stats';
import type { TrackingPort } from '../ports';
import { statsView, weekMinutes, weekSessions, wellFormed, type StatsView, type WeekStats } from '../stats';
import { durationText } from '../../shared/duration';
import { finishedWorkouts, useCatalog, useGoal, usePortRecords } from './hooks';
import { dateLabel } from './labels';
import { MuscleIcon } from './MuscleIcon';
import { progressRows, type ProgressRow } from '../progress';
import { runView } from './run-view';
import { PageHead, Row, RowList, Sheet } from './kit';
import { HealthSheet } from './HealthSheet';
import { healthOf } from './health-view';

const SPORT_LABEL: Record<Sport, string> = { bike: 'Rad', strength: 'Kraft', run: 'Laufen', mobility: 'Mobility', other: 'Andere' };
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const weekTotal = weekMinutes;
/** The pair verdict "Schulter vorn 3 Sätze, Schulter hinten 12: Schulter vorn kommt zu kurz." reads without the numbers; other verdicts stay as they are. */
const verdictText = (t: string) => t.match(/^.+ [\d.,]+ Sätze, .+ [\d.,]+: (.+)$/)?.[1] ?? t;
/** Finished workouts the page can count; a broken body is skipped. */
const countable = (records: TrackedRecord[] | null): LoggedWorkout[] => wellFormed(finishedWorkouts(records));

const statsOf = (records: TrackedRecord[] | null): StatsBody | null => {
  const r = (records ?? []).find((x) => x.id === STATS_ID && !x.deleted);
  return r ? readStats(r.body) : null;
};

/** The statistics page exists once there is a stats record or at least one finished workout. */
export const statsVisible = (stats: TrackedRecord[] | null, workouts: TrackedRecord[] | null): boolean =>
  statsOf(stats) !== null || countable((workouts ?? []).filter((r) => !r.deleted)).length > 0;

const half = (n: number) => String(Math.round(n * 2) / 2).replace('.', ',');
/** This week's effective sets against the target, in words. */
function detailText(b: GroupBalance): string {
  return b.target.max > 0 ? `${half(b.effective7)} von ${b.target.min}–${b.target.max} Sätzen diese Woche` : `${half(b.effective7)} Sätze diese Woche`;
}

function MuscleRow({ b, open, onToggle }: { b: GroupBalance; open: boolean; onToggle: () => void }) {
  const state = b.state ?? 'none';
  return (
    <Row
      title={<span className="tk-muscle-title"><MuscleIcon group={b.group} />{b.label}</span>}
      value={b.state !== null ? <span className={`tk-state tk-state-${state}`}><span className="tk-state-dot" aria-hidden="true" />{STATE_LABELS[state]}</span> : undefined}
      expanded={open} onClick={onToggle}
    >
      <p className="muted tk-small">{detailText(b)}</p>
    </Row>
  );
}

function ThisWeek({ sentence, verdicts }: { sentence: string; verdicts: string[] }) {
  return (
    <section className="card tk-stats" aria-label="Diese Woche">
      <p className="tk-week-line">{sentence}</p>
      {verdicts.length > 0 && <ul className="tk-verdicts">{verdicts.map((t) => <li key={t}>{verdictText(t)}</li>)}</ul>}
    </section>
  );
}

/** The four-state list per muscle group, one row open at a time. Untrained groups wait behind "Alle Muskelgruppen anzeigen". */
function MusclesSheet({ v, onClose }: { v: StatsView; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const allRows = v.balance.filter((b) => b.state !== null || b.direct7 + b.indirect7 > 0);
  const shown = allRows.filter((b) => b.direct7 + b.indirect7 > 0);
  const rows = all ? allRows : shown;
  return (
    <Sheet title="Muskeln" onClose={onClose}>
      <div className="tk-stats" aria-label="Muskeln">
        {rows.length > 0 && <RowList>{rows.map((b) => <MuscleRow key={b.group} b={b} open={openGroup === b.group} onToggle={() => setOpenGroup(openGroup === b.group ? null : b.group)} />)}</RowList>}
        {rows.length === 0 && !all && <p className="muted">Diese Woche noch keine Sätze.</p>}
        {allRows.length > shown.length && (
          <button type="button" className="link" onClick={() => setAll(!all)}>{all ? 'Weniger Muskelgruppen' : 'Alle Muskelgruppen anzeigen'}</button>
        )}
      </div>
    </Sheet>
  );
}

function MinutesChart({ v, weeks }: { v: StatsView; weeks: WeekStats[] }) {
  const max = Math.max(1, ...weeks.map(weekTotal));
  return (
    <>
      <h3 className="tk-section">Zeit pro Woche</h3>
      <ul className="tk-legend">
        {v.sports.map((s) => <li key={s}><span className={`tk-swatch tk-sport-${s}`} aria-hidden="true" />{SPORT_LABEL[s]}</li>)}
      </ul>
      <div className="tk-stack-chart">
        {weeks.map((w) => {
          const total = weekTotal(w);
          const label = `Woche vom ${shortDate(w.weekStart)}: ${durationText(total)}`;
          const parts = v.sports.filter((s) => w.minutes[s] > 0).map((s) => `${SPORT_LABEL[s]} ${Math.round(w.minutes[s])}`).join(', ');
          return (
            <div key={w.weekStart} className="tk-stack-col">
              <div className="tk-stack" role="img" aria-label={label} title={parts ? `${label} (${parts})` : label}>
                {v.sports.filter((s) => w.minutes[s] > 0).map((s) => (
                  <span key={s} className={`tk-sport-${s}`} style={{ height: `${(w.minutes[s] / max) * 100}%` }} />
                ))}
              </div>
              <span className="tk-stack-date">{shortDate(w.weekStart)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Progress over the months: one sentence per lift or area, no charts. */
function Progress({ rows }: { rows: ProgressRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="tk-stats" aria-label="Fortschritt">
      <h3 className="tk-section">Fortschritt</h3>
      <ul className="tk-lines">{rows.map((r) => <li key={r.text}>{r.text}</li>)}</ul>
    </section>
  );
}

export function StatsScreen({ port, now }: { port: TrackingPort; now: () => number }) {
  const [details, setDetails] = useState(false);
  const [musclesOpen, setMusclesOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const health = healthOf(usePortRecords(port, 'health').records);
  const statsQ = usePortRecords(port, 'stats');
  const workoutsQ = usePortRecords(port, 'workout');
  const statsRecords = statsQ.records;
  const workoutRecords = workoutsQ.records;
  const runRecords = usePortRecords(port, 'run').records;
  const stats = useMemo(() => statsOf(statsRecords), [statsRecords]);
  const workouts: LoggedWorkout[] = useMemo(() => countable(workoutRecords), [workoutRecords]);
  const nowMs = now();
  const catalog = useCatalog(port);
  const goal = useGoal(port, nowMs);
  const v = useMemo(() => statsView(stats, workouts, nowMs, catalog, goal.strength, goal.focus), [stats, workouts, nowMs, catalog, goal]);
  const progress = useMemo(() => progressRows({
    nowMs, ftp: stats?.ftp ?? [], weightKg: stats?.weightKg ?? null, runPace: runView(runRecords ?? [], nowMs).status?.numbers.easyPace ?? null,
    workouts,
  }), [stats, runRecords, workouts, v, nowMs]);
  if (statsQ.failed || workoutsQ.failed) {
    const retry = () => { if (statsQ.failed) statsQ.retry(); if (workoutsQ.failed) workoutsQ.retry(); };
    return (
      <div className="tk-screen">
        <p role="status" className="tk-note">Die Statistik konnte gerade nicht gelesen werden. Es ist nichts verloren, versuch es gleich nochmal.</p>
        <button type="button" onClick={retry}>Nochmal versuchen</button>
      </div>
    );
  }
  if (statsRecords === null || workoutRecords === null) return <div className="tk-screen" aria-busy="true" />;

  const muscles = workouts.length > 0;
  const weeks = v.weeks.slice(0, v.weeks.length - 1);
  const minutes = v.sports.length > 0;
  const w = v.thisWeek;
  const sessions = weekSessions(stats, w);
  const total = weekTotal(w);
  const sentence = total > 0 || sessions > 0
    ? `Diese Woche: ${sessions} ${sessions === 1 ? 'Einheit' : 'Einheiten'}, ${durationText(total)}`
    : 'Diese Woche noch keine Einheit.';
  const hasDetails = minutes || progress.length > 0 || v.unknown.length > 0;
  return (
    <div className="tk-screen">
      <PageHead title="Statistik" subtitle={v.asOfMs !== null ? `Stand: ${dateLabel(v.asOfMs)}` : 'Minuten und harte Tage erscheinen nach dem nächsten Lauf des Coaches.'} />
      <ThisWeek sentence={sentence} verdicts={v.verdicts} />
      {(muscles || hasDetails || health) && (
        <RowList>
          {health && <Row title="Gesundheit" onClick={() => setHealthOpen(true)} />}
          {muscles && <Row title="Muskeln" onClick={() => setMusclesOpen(true)} />}
          {hasDetails && <Row title="Details" onClick={() => setDetails(true)} />}
        </RowList>
      )}
      {healthOpen && health && <HealthSheet health={health} onClose={() => setHealthOpen(false)} />}
      {musclesOpen && <MusclesSheet v={v} onClose={() => setMusclesOpen(false)} />}
      {details && (
        <Sheet title="Details" onClose={() => setDetails(false)}>
          <div className="tk-stats">
            {minutes && (
              <dl className="tk-pace" aria-label="Diese Woche nach Sportart">
                {v.sports.map((s) => <div key={s}><dt>{SPORT_LABEL[s]}</dt><dd>{durationText(w.minutes[s])}</dd></div>)}
              </dl>
            )}
            {minutes && <section className="tk-stats" aria-label="Letzte 8 Wochen"><MinutesChart v={v} weeks={weeks} /></section>}
            <Progress rows={progress} />
            {v.unknown.length > 0 && <p className="muted">Ohne bekannten Muskel: {v.unknown.join(', ')}</p>}
          </div>
        </Sheet>
      )}
    </div>
  );
}
