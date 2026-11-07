import { HEALTH_ID, readHealth, type HealthBody } from '../../shared/health';
import type { RecordStore } from '../tracking/store';

type Deps = {
  store: Pick<RecordStore, 'all' | 'put'>;
  profileIds: string[];
  /** Only the side that coaches a profile writes its health record. */
  coachHere: (profileId: string) => boolean;
  noOpenRide: () => boolean;
  nowMs: number;
  /** null: nothing to show or not due, nothing is written. */
  content: (profileId: string) => Omit<HealthBody, 'atMs' | 'coachText'> | null;
  coachText: (profileId: string) => HealthBody['coachText'];
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Publishes the health record to every profile coached here, only when it says something new and never with a ride open
 * (like the stats and the bike plan). A body the web would not read (too big, not whole) is not written. Never throws.
 * Returns the profiles it wrote to.
 */
export function exportHealth(d: Deps): string[] {
  try {
    if (!d.noOpenRide()) return [];
    const out: string[] = [];
    for (const id of d.profileIds) {
      try {
        if (!d.coachHere(id)) continue;
        const content = d.content(id);
        if (!content) continue;
        const text = d.coachText(id);
        const next = { ...content, ...(text ? { coachText: text } : {}) };
        const have = d.store.all(id, 'health').find((r) => r.id === HEALTH_ID);
        if (have && !have.deleted && isObj(have.body)) {
          const { atMs: _at, ...rest } = have.body;
          if (JSON.stringify(rest) === JSON.stringify(next)) continue;
        }
        const body = { ...next, atMs: d.nowMs };
        if (readHealth(body) === null) continue;
        d.store.put(id, { kind: 'health', id: HEALTH_ID, updatedMs: Math.max(d.nowMs, (have?.updatedMs ?? 0) + 1), deleted: false, body });
        out.push(id);
      } catch { /* this profile tries again on the next scan */ }
    }
    return out;
  } catch { return []; }
}
