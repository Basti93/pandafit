import { ACTIVITIES_ID, MAX_ACTIVITIES, readActivities, type ActivityItem, type ActivityKind } from '../shared/activities';
import { CYCLING, STRENGTH, type TrainingSession } from './all-training';
import type { RecordStore } from './tracking/store';

const RUNNING = /run/i;

type GarminExtra = { id: string; distanceM: number | null; avgHr: number | null };
type Deps = {
  store: Pick<RecordStore, 'all' | 'put'>;
  profileIds: string[];
  /** Only the side that coaches a profile writes its activities record. */
  coachHere: (profileId: string) => boolean;
  noOpenRide: () => boolean;
  nowMs: number;
  /** null: nothing to show, nothing is written. */
  content: (profileId: string) => ActivityItem[] | null;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const kindOf = (s: TrainingSession): ActivityKind => {
  if (s.source === 'kraft') return 'kraft';
  if (s.source === 'rad') return 'rad';
  const sport = s.sport ?? '';
  if (s.key.startsWith('lauf-') || RUNNING.test(sport)) return 'lauf';
  if (CYCLING.test(sport)) return 'rad';
  if (STRENGTH.test(sport)) return 'kraft';
  return 'andere';
};

/** The newest activities as the web shows them: newest first, at most MAX_ACTIVITIES. Distance and heart rate come from Garmin only. */
export function activityItems(sessions: TrainingSession[], garmin: GarminExtra[]): ActivityItem[] {
  const extra = new Map(garmin.map((g) => [g.id, g]));
  return [...sessions].sort((a, b) => b.startMs - a.startMs).slice(0, MAX_ACTIVITIES).map((s): ActivityItem => {
    const g = s.key.startsWith('garmin-') ? extra.get(s.key.slice('garmin-'.length)) : undefined;
    const ref = s.key.startsWith('kraft-') ? s.key.slice('kraft-'.length) : s.key.startsWith('rad-') ? s.key.slice('rad-'.length) : null;
    return {
      key: s.key, kind: kindOf(s), title: s.title, sport: s.sport ?? null, startMs: s.startMs, minutes: Math.round(s.minutes),
      distanceM: g?.distanceM ?? null, avgHr: g?.avgHr ?? null, ref,
    };
  });
}

/**
 * Publishes the activities record to every profile coached here, only when it changes and never with a ride open.
 * A body the web would not read is not written. Never throws. Returns the profiles it wrote to.
 */
export function exportActivities(d: Deps): string[] {
  try {
    if (!d.noOpenRide()) return [];
    const out: string[] = [];
    for (const id of d.profileIds) {
      try {
        if (!d.coachHere(id)) continue;
        const items = d.content(id);
        if (!items) continue;
        const have = d.store.all(id, 'activities').find((r) => r.id === ACTIVITIES_ID);
        if (have && !have.deleted && isObj(have.body) && JSON.stringify(have.body.items) === JSON.stringify(items)) continue;
        const body = { type: 'activities', atMs: d.nowMs, items };
        if (readActivities(body) === null) continue;
        d.store.put(id, { kind: 'activities', id: ACTIVITIES_ID, updatedMs: Math.max(d.nowMs, (have?.updatedMs ?? 0) + 1), deleted: false, body });
        out.push(id);
      } catch { /* this profile tries again on the next scan */ }
    }
    return out;
  } catch { return []; }
}
