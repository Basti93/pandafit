import fs from 'node:fs';
import path from 'node:path';
import type { CoachClientMessage } from '../../shared/coach-protocol';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

/** The most keys a clock keeps; past that the oldest stamps go first. */
const MAX_KEYS = 5000;

/**
 * The item a message changes, for "last change wins". Null for a message that only adds (a note, an answer) and so is always applied.
 */
export const changeKey = (m: CoachClientMessage): string | null => {
  switch (m.type) {
    case 'complaint-update': return `complaint:${m.id}`;
    case 'set-ftp': return 'ftp';
    case 'feedback': return `feedback:${m.rideId}`;
    case 'meals-item': return `meal:${m.week}:${m.item}`;
    case 'meals-eater': return `eater:${m.week}:${m.meal}:${m.person}`;
    case 'meals-settings': return 'meals-settings';
    case 'garmin-upload-settings': return 'garmin-upload';
    case 'profile-update': return 'profile';
    default: return null;
  }
};

/** True for the keys of the household's shared meal plan, which one clock for the whole household keeps. */
export const isHouseholdKey = (key: string): boolean => key.startsWith('meal:') || key.startsWith('eater:');

/** Per account (and one for the shared meal plan): when each item last changed. A change older than that is skipped, so a queued change never undoes a newer one. */
export class ChangeClock {
  private stamps: Map<string, number> | null = null;

  constructor(private readonly file: string) {}

  private load(): Map<string, number> {
    if (this.stamps) return this.stamps;
    const stamps = new Map<string, number>();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) stamps.set(k, v);
      }
    } catch { /* no clock yet, or a broken one: start empty */ }
    this.stamps = stamps;
    return stamps;
  }

  private save(): void {
    const stamps = this.load();
    if (stamps.size > MAX_KEYS) {
      const oldest = [...stamps.entries()].sort((a, b) => a[1] - b[1]).slice(0, stamps.size - MAX_KEYS);
      for (const [k] of oldest) stamps.delete(k);
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    writeJsonAtomic(this.file, Object.fromEntries(stamps), { mode: 0o600 });
  }

  /** True when a change at `atMs` is not older than the item's last one. Changes nothing. */
  admits(key: string, atMs: number): boolean {
    const last = this.load().get(key);
    return last === undefined || atMs >= last;
  }

  /** Records a change that was applied. The item's last change never moves back. */
  stamp(key: string, atMs: number): void {
    const stamps = this.load();
    const last = stamps.get(key);
    if (last !== undefined && last >= atMs) return;
    stamps.set(key, atMs);
    this.save();
  }

  /** admits, then stamp: true when the change at `atMs` is not older than the item's last one, which it then becomes. */
  admit(key: string, atMs: number): boolean {
    if (!this.admits(key, atMs)) return false;
    this.stamp(key, atMs);
    return true;
  }
}
