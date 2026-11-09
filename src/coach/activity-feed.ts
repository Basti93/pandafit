import fs from 'node:fs';
import path from 'node:path';
import { overlapsByHalf, trainingSessions, type TrainingInput, type TrainingSession } from './all-training';
import { dateKey } from './day-load';
import { kindOf } from './activities-export';
import type { Sport } from '../shared/week-plan';
import { writeJsonAtomic } from '../shared/node/atomic-write';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** What the coaches are shown of all activities. */
export const HINT_DAYS = 7;
/** How long an activity is remembered as seen; one that starts earlier is never news. */
const SEEN_DAYS = 14;
/** On the very first look only this fresh an activity counts as new, so an update does not replan for old ones. */
const FIRST_LOOK_MS = DAY;
const RUNNING = /run/i;

export type ManualRun = { id: string; startMs: number; durationS: number };

/** Every activity from every source, each once: rides, strength (app and Hevy), Garmin, and runs entered in the app. */
export const allActivities = (input: TrainingInput & { manualRuns?: ManualRun[] | null }): TrainingSession[] => {
  const sessions = trainingSessions(input);
  for (const r of input.manualRuns ?? []) {
    // A run entered by hand that Garmin recorded as well counts once, as the Garmin one.
    if ((input.activities ?? []).some((a) => RUNNING.test(a.sport) && overlapsByHalf(a, r))) continue;
    sessions.push({ key: `lauf-${r.id}`, source: 'andere', title: null, sport: 'running', startMs: r.startMs, minutes: r.durationS / 60 });
  }
  return sessions;
};

/** The sports really done on each local date, each once, by the kind mapping of the activity list (Garmin included). */
export const doneByDate = (sessions: TrainingSession[]): Record<string, Sport[]> => {
  const out: Record<string, Sport[]> = {};
  for (const s of sessions) {
    const kind = kindOf(s);
    const sport: Sport | null = kind === 'rad' ? 'bike' : kind === 'kraft' ? 'gym' : kind === 'lauf' ? 'run' : null;
    const date = dateKey(s.startMs);
    if (sport && !(out[date] ?? []).includes(sport)) out[date] = [...(out[date] ?? []), sport];
  }
  return out;
};

const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** How an activity is shown to a coach. */
export const activityData = (s: TrainingSession) => ({
  tag: dateKey(s.startMs), uhrzeit: clock(s.startMs),
  art: s.source === 'rad' ? 'Rad' : s.source === 'kraft' ? 'Kraft' : (s.sport ?? 'andere'),
  titel: s.title, minuten: Math.round(s.minutes),
});

/** The block for a coach's prompt: every activity of the last days, planned or not. Empty without any. */
export const activitiesHint = (sessions: TrainingSession[], nowMs: number): string => {
  const recent = sessions.filter((s) => s.startMs <= nowMs && nowMs - s.startMs <= HINT_DAYS * DAY).sort((a, b) => a.startMs - b.startMs);
  if (recent.length === 0) return '';
  const data = recent.map(activityData);
  return `\n\n<aktivitaeten-nur-daten>\n${JSON.stringify(data)}\n</aktivitaeten-nur-daten>\nDas sind alle Aktivitäten der letzten ${HINT_DAYS} Tage aus allen Quellen (diese App, Hevy, Garmin, selbst eingetragen), auch ohne Plan. Plane mit dem, was wirklich gemacht wurde.`;
};

type Entry = { keys: string[]; version: number };

/** Which activities each profile's coaches have already reacted to. Kept in a file, so a restart does not count them again. */
export class ActivitySeen {
  private seen: Record<string, Entry> | null = null;
  constructor(private file: string) {}

  private load(): Record<string, Entry> {
    if (this.seen) return this.seen;
    try {
      const x = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      this.seen = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, Entry> : {};
    } catch { this.seen = {}; }
    return this.seen;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      writeJsonAtomic(this.file, this.seen);
    } catch { /* then it only holds until the restart */ }
  }

  /** The activities of the last days not seen before, each returned once; empty when nothing is new. */
  check<T extends { key: string; startMs: number }>(profileId: string, sessions: T[], nowMs: number): T[] {
    const all = this.load();
    const current = sessions.filter((s) => s.startMs <= nowMs && nowMs - s.startMs <= SEEN_DAYS * DAY);
    const keys = current.map((s) => s.key).sort();
    const old = all[profileId];
    const fresh = old
      ? current.filter((s) => !old.keys.includes(s.key))
      : current.filter((s) => nowMs - s.startMs <= FIRST_LOOK_MS);
    const version = (old?.version ?? 0) + (fresh.length > 0 ? 1 : 0);
    if (!old || fresh.length > 0 || keys.join('|') !== old.keys.join('|')) {
      all[profileId] = { keys, version };
      this.save();
    }
    return fresh;
  }

  /** Goes up with every new activity; part of a plan key, so a plan made before it is made again. */
  version(profileId: string): number { return this.load()[profileId]?.version ?? 0; }
}
