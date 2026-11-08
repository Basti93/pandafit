import type { LoggedSet, LoggedWorkout } from '../shared/records';
import { paceText } from '../shared/run';

/** One sentence of the progress list: what, where it stands, and how it moved, in plain words. */
export type ProgressRow = { text: string };

const DAY = 86_400_000;
/** The comparison point for FTP: the newest value at least this old. */
const FTP_BACK_DAYS = 56;
const RECENT_DAYS = 28;
const BEFORE_DAYS = 84;
const MAX_LIFTS = 3;
const MAX_REPS = 12;
const comma = (n: number, digits = 1) => (Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits).replace('.', ',');

/** Estimated one-rep max (Epley) of the best working set with 1 to 12 reps and a weight; null without one. */
export function estimatedMax(sets: LoggedSet[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (s.type === 'warmup' || s.weightKg === null || s.weightKg <= 0 || s.reps === null || s.reps < 1 || s.reps > MAX_REPS) continue;
    const e = s.reps === 1 ? s.weightKg : s.weightKg * (1 + s.reps / 30);
    if (best === null || e > best) best = e;
  }
  return best;
}

type Input = {
  nowMs: number;
  ftp: { atMs: number; ftpW: number }[];
  weightKg: number | null;
  runPace: { now: number | null; weeks4: number | null; weeks12: number | null } | null;
  workouts: LoggedWorkout[];
};

/** How a lift moved between the eight weeks before and the last four, in words: "stärker als vor 12 Wochen"; no number. */
function liftChange(recent: number, before: number): string {
  const d = recent - before;
  if (Math.abs(d) < 1) return 'wie vor 12 Wochen';
  return d > 0 ? 'stärker als vor 12 Wochen' : 'schwächer als vor 12 Wochen';
}

/** At most one sentence per area or lift, only where there is something to say. Plain words, no score. */
export function progressRows(i: Input): ProgressRow[] {
  const rows: ProgressRow[] = [];

  const ftp = [...i.ftp].sort((a, b) => a.atMs - b.atMs);
  const latest = ftp[ftp.length - 1];
  if (latest) {
    const back = [...ftp].reverse().find((h) => i.nowMs - h.atMs >= FTP_BACK_DAYS * DAY) ?? (ftp[0] && i.nowMs - ftp[0].atMs >= 14 * DAY ? ftp[0] : undefined);
    const wkg = i.weightKg ? ` (${comma(latest.ftpW / i.weightKg)} W/kg)` : '';
    let change = '';
    if (back && back !== latest) {
      const d = Math.round(latest.ftpW - back.ftpW);
      const weeks = Math.max(1, Math.round((i.nowMs - back.atMs) / (7 * DAY)));
      change = d === 0 ? `, gleich wie vor ${weeks} Wochen` : `, ${Math.abs(d)} W ${d > 0 ? 'mehr' : 'weniger'} als vor ${weeks} Wochen`;
    }
    rows.push({ text: `Rad: FTP ${Math.round(latest.ftpW)} W${wkg}${change}` });
  }

  const pace = i.runPace;
  if (pace?.now != null) {
    const [then, weeks] = pace.weeks12 != null ? [pace.weeks12, 12] : pace.weeks4 != null ? [pace.weeks4, 4] : [null, 0];
    let change = '';
    if (then !== null) {
      const d = Math.round(pace.now - then);
      change = d === 0 ? `, gleich wie vor ${weeks} Wochen` : `, ${Math.abs(d)} s ${d < 0 ? 'schneller' : 'langsamer'} als vor ${weeks} Wochen`;
    }
    rows.push({ text: `Laufen: lockeres Tempo ${paceText(pace.now)}${change}` });
  }

  // Strength: the most trained lifts of the last twelve weeks, the last four weeks against the eight before.
  const lifts = new Map<string, { title: string; latestMs: number; sessions: number; recent: number | null; before: number | null }>();
  for (const w of i.workouts) {
    const age = i.nowMs - w.startMs;
    if (age < 0 || age > BEFORE_DAYS * DAY) continue;
    for (const e of w.exercises) {
      const max = estimatedMax(e.sets.filter((s) => s.doneMs !== null || w.source === 'hevy'));
      if (max === null) continue;
      const l = lifts.get(e.exerciseId) ?? { title: e.title, latestMs: 0, sessions: 0, recent: null, before: null };
      l.sessions++;
      if (w.startMs > l.latestMs) { l.latestMs = w.startMs; l.title = e.title; }
      if (age <= RECENT_DAYS * DAY) l.recent = Math.max(l.recent ?? 0, max); else l.before = Math.max(l.before ?? 0, max);
      lifts.set(e.exerciseId, l);
    }
  }
  // A lift without an earlier value has nothing to compare with: it stays out (no word rather than a bare number).
  const top = [...lifts.values()].filter((l) => l.recent !== null && l.before !== null).sort((a, b) => b.sessions - a.sessions || b.recent! - a.recent!).slice(0, MAX_LIFTS);
  for (const l of top) rows.push({ text: `${l.title}: ${liftChange(l.recent!, l.before!)}` });
  return rows;
}

export type Trend = 'steigt' | 'gleich' | 'stockt';

/**
 * One word per lift, from the same comparison as the progress sentences: the best estimated max of the last four weeks
 * against the eight weeks before. A lift without a value in both is left out (no word rather than a wrong one).
 */
export function liftTrends(workouts: LoggedWorkout[], nowMs: number): Map<string, Trend> {
  const recent = new Map<string, number>();
  const before = new Map<string, number>();
  for (const w of workouts) {
    const age = nowMs - w.startMs;
    if (age < 0 || age > BEFORE_DAYS * DAY) continue;
    for (const e of w.exercises) {
      const max = estimatedMax(e.sets.filter((s) => s.doneMs !== null || w.source === 'hevy'));
      if (max === null) continue;
      const m = age <= RECENT_DAYS * DAY ? recent : before;
      m.set(e.exerciseId, Math.max(m.get(e.exerciseId) ?? 0, max));
    }
  }
  const out = new Map<string, Trend>();
  for (const [id, r] of recent) {
    const b = before.get(id);
    if (b === undefined) continue;
    out.set(id, Math.abs(r - b) < 1 ? 'gleich' : r > b ? 'steigt' : 'stockt');
  }
  return out;
}
