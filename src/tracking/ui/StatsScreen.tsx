import { useMemo, useState } from 'react';
import { ReadFailed } from './ReadFailed';
import { STATE_LABELS, type GroupBalance } from '../../shared/muscle-balance';
import type { LoggedWorkout, TrackedRecord } from '../../shared/records';
import { readStats, STATS_ID, type Sport, type StatsBody } from '../../shared/stats';
import type { TrackingPort } from '../ports';
import { statsView, weekMinutes, weekSessions, wellFormed, type StatsView, type WeekStats } from '../stats';
import { durationText } from '../../shared/duration';
import { finishedWorkouts, useCatalog, useGoal, usePortRecords } from './hooks';
import { dateLabel } from './labels';
import { MuscleIcon } from './MuscleIcon';
import { progressRows, type ProgressRow } from '../progress';
import { runView } from './run-view';
import { Row, RowList, Sheet } from './kit';
import { HealthSheet } from './HealthSheet';
import { healthOf, healthWord } from './health-view';

const SPORT_LABEL: Record<Sport, string> = { bike: 'Rad', strength: 'Kraft', run: 'Laufen', mobility: 'Mobility', other: 'Andere' };
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const weekTotal = weekMinutes;
/** The pair verdict "Schulter vorn 3 Sätze, Schulter hinten 12: Schulter vorn kommt zu kurz." reads without the numbers; other verdicts stay as they are. */
const PAIR_VERDICT = /^.+ [\d.,]+ Sätze, .+ [\d.,]+: (.+)$/;
const verdictText = (t: string) => t.match(PAIR_VERDICT)?.[1] ?? t;
/** Finished workouts the page can count; a broken body is skipped. */
const countable = (records: TrackedRecord[] | null): LoggedWorkout[] => wellFormed(finishedWorkouts(records));

const statsOf = (records: TrackedRecord[] | null): StatsBody | null => {
  const r = (records ?? []).find((x) => x.id === STATS_ID && !x.deleted);
  return r ? readStats(r.body) : null;
};

const half = (n: number) => String(Math.round(n * 2) / 2).replace('.', ',');
/** This week's effective sets against the target, in words. */
function detailText(b: GroupBalance): string {
  return b.target.max > 0 ? `${half(b.effective7)} von ${b.target.min}–${b.target.max} Sätzen diese Woche` : `${half(b.effective7)} Sätze diese Woche`;
}

/**
 * One rule for the summary sentence and the list: a group is a gap when the pair verdict names it as short ("Brust kommt zu kurz").
 * Only gaps are orange and come first; a group that is merely low this week keeps its word "Wenig" in the quiet colour.
 */
export const gapGroups = (v: StatsView): Set<string> => {
  const named = v.pairs.map((p) => p.shortLabel).filter((l): l is string => l !== null);
  return new Set(v.balance.filter((b) => named.some((l) => l.includes(b.label))).map((b) => b.group));
};

function MuscleRow({ b, gap, open, onToggle }: { b: GroupBalance; gap: boolean; open: boolean; onToggle: () => void }) {
  const state = b.state ?? 'none';
  return (
    <Row
      title={<span className="tk-muscle-title"><MuscleIcon group={b.group} />{b.label}</span>}
      value={b.state !== null ? <span className={`tk-state tk-state-${state === 'low' && !gap ? 'quiet' : state}`}><span className="tk-state-dot" aria-hidden="true" />{STATE_LABELS[state]}</span> : undefined}
      expanded={open} onClick={onToggle}
    >
      <p className="muted tk-small">{detailText(b)}</p>
    </Row>
  );
}

/** The four-state list per muscle group, one row open at a time. Untrained groups wait behind "Alle Muskelgruppen anzeigen". */
function MusclesSheet({ v, onClose }: { v: StatsView; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const allRows = v.balance.filter((b) => b.state !== null || b.direct7 + b.indirect7 > 0);
  const shown = allRows.filter((b) => b.direct7 + b.indirect7 > 0);
  // Real gaps first, then the rest in the usual order.
  const gaps = gapGroups(v);
  const rows = (all ? allRows : shown).slice().sort((a, b) => Number(gaps.has(b.group)) - Number(gaps.has(a.group)));
  return (
    <Sheet title="Muskeln" onClose={onClose}>
      <div className="tk-stats" aria-label="Muskeln">
        {rows.length > 0 && <RowList>{rows.map((b) => <MuscleRow key={b.group} b={b} gap={gaps.has(b.group)} open={openGroup === b.group} onToggle={() => setOpenGroup(openGroup === b.group ? null : b.group)} />)}</RowList>}
        {rows.length === 0 && !all && <p className="muted">Diese Woche hast du noch keine Sätze gemacht.</p>}
        {allRows.length > shown.length && (
          <button type="button" className="link" onClick={() => setAll(!all)}>{all ? 'Weniger Muskelgruppen' : 'Alle Muskelgruppen anzeigen'}</button>
        )}
      </div>
    </Sheet>
  );
}

function MinutesChart({ v, weeks }: { v: StatsView; weeks: WeekStats[] }) {
  const max = Math.max(1, ...weeks.map(weekTotal));
  const average = weeks.length > 0 ? weeks.reduce((a, w) => a + weekTotal(w), 0) / weeks.length : 0;
  return (
    <>
      <h3 className="tk-section">Letzte 8 Wochen</h3>
      <p className="tk-week-line">Im Schnitt {durationText(average)} pro Woche</p>
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
      <p className="muted tk-small">Bis zur letzten vollen Woche</p>
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

/**
 * Woche > Rückblick: how it went, in one place. Verlauf, Muskeln, Gesundheit and Zeit pro Woche as rows; each opens a sheet.
 * What is worth saying about the last weeks stands above the rows. Rows without data are left out; Verlauf is always there.
 */
export function LookBack({ port, now, latest, onHistory }: { port: TrackingPort; now: () => number; /** The newest activity in a few words. */ latest?: string; onHistory: () => void }) {
  const [sheet, setSheet] = useState<'time' | 'muscles' | 'health' | null>(null);
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
  }), [stats, runRecords, workouts, nowMs]);
  const failed = statsQ.failed || workoutsQ.failed;
  const retry = () => { if (statsQ.failed) statsQ.retry(); if (workoutsQ.failed) workoutsQ.retry(); };
  const loaded = statsRecords !== null && workoutRecords !== null && !failed;
  // Something to look back on: a stats record from the coach or a finished workout.
  const any = loaded && (stats !== null || workouts.length > 0);

  const muscles = any && workouts.length > 0;
  const weeks = v.weeks.slice(0, v.weeks.length - 1);
  const minutes = v.sports.length > 0;
  const w = v.thisWeek;
  const sessions = weekSessions(stats, w);
  const total = weekTotal(w);
  const sentence = total > 0 || sessions > 0
    ? `${sessions} ${sessions === 1 ? 'Einheit' : 'Einheiten'}, ${durationText(total)}`
    : 'Bisher gibt es noch keine Einheit.';
  const gaps = [...gapGroups(v)].length;
  return (
    <section className="tk-lookback" aria-label="Rückblick">
      <h2 className="tk-section">Rückblick</h2>
      {failed && <ReadFailed text="Der Rückblick konnte gerade nicht gelesen werden. Es ist nichts verloren." retry={retry} />}
      {any && v.verdicts.length > 0 && <ul className="tk-verdicts">{v.verdicts.map((t) => <li key={t}>{verdictText(t)}</li>)}</ul>}
      <RowList label="Rückblick">
        <Row title="Verlauf" value={latest ? <span className="tk-ellipsis">{latest}</span> : undefined} onClick={onHistory} />
        {muscles && <Row title="Muskeln" value={gaps > 0 ? `${gaps} ${gaps === 1 ? 'Lücke' : 'Lücken'}` : 'ausgewogen'} onClick={() => setSheet('muscles')} />}
        {health && <Row title="Gesundheit" value={healthWord(health)} onClick={() => setSheet('health')} />}
        {any && <Row title="Zeit pro Woche" onClick={() => setSheet('time')} />}
      </RowList>
      {sheet === 'health' && health && <HealthSheet health={health} onClose={() => setSheet(null)} />}
      {sheet === 'muscles' && <MusclesSheet v={v} onClose={() => setSheet(null)} />}
      {sheet === 'time' && (
        <Sheet title="Zeit pro Woche" onClose={() => setSheet(null)}>
          <div className="tk-stats">
            <h3 className="tk-section">Diese Woche</h3>
            <p className="tk-week-line">{sentence}</p>
            <p className="muted tk-small">{v.asOfMs !== null ? `Stand: ${dateLabel(v.asOfMs)}` : 'Minuten und harte Tage erscheinen nach dem nächsten Lauf von Bo.'}</p>
            {minutes && (
              <dl className="tk-pace" aria-label="Diese Woche nach Sportart">
                {v.sports.map((s) => <div key={s}><dt>{SPORT_LABEL[s]}</dt><dd>{durationText(w.minutes[s])}</dd></div>)}
              </dl>
            )}
            {minutes && <section className="tk-stats" aria-label="Zeit der letzten Wochen"><MinutesChart v={v} weeks={weeks} /></section>}
            <Progress rows={progress} />
            {v.unknown.length > 0 && <p className="muted">Ohne bekannten Muskel: {v.unknown.join(', ')}</p>}
          </div>
        </Sheet>
      )}
    </section>
  );
}
