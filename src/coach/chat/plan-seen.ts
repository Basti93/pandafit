import fs from 'node:fs';
import path from 'node:path';
import type { TrackedRecord } from '../../shared/records';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

/** What the accepted week plans of a profile are, as a short key: changes when the rider takes a plan. */
export const weekPlanKey = (records: TrackedRecord[]): string =>
  records.filter((r) => r.kind === 'weekplan' && !r.deleted).map((r) => `${r.id}:${r.updatedMs}`).sort().join(',');

/** Today's advice as a short key (date, sports, legs, hardness): changes when the advice flips, at most about once a day. */
export const adviceKey = (a: { date: string; sport: string; hardness: string; legs?: boolean; also?: { sport: string; hardness: string } } | null): string =>
  a ? `${a.date}:${a.sport}:${a.hardness}:${a.legs === false ? 'nolegs' : 'legs'}${a.also ? `+${a.also.sport}:${a.also.hardness}` : ''}` : '';

/**
 * Remembers per profile which week plan the coaches last planned for, in a file, so a restart does not replan. `changed`
 * returns true once for a key it has not seen, also for the first plan ever taken.
 */
export class PlanSeen {
  private seen: Record<string, string> | null = null;
  constructor(private file: string) {}
  private load(): Record<string, string> {
    if (this.seen) return this.seen;
    try { const x = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown; this.seen = x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, string> : {}; } catch { this.seen = {}; }
    return this.seen;
  }
  /** `quietFirst`: the first key ever seen for a profile is only remembered, it does not count as a change. */
  changed(profileId: string, key: string, quietFirst = false): boolean {
    const seen = this.load();
    if ((seen[profileId] ?? '') === key) return false;
    const first = seen[profileId] === undefined;
    seen[profileId] = key;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJsonAtomic(this.file, seen); } catch { /* asked again next scan */ }
    return !(quietFirst && first);
  }
}
