import fs from 'node:fs';
import path from 'node:path';
import type { RideEvent, Sample } from '../shared/sample';
import { readMeta, type RideMeta } from './recorder';

export const findOpenRides = (dir: string): RideMeta[] => {
  if (!fs.existsSync(dir)) return [];
  const open: RideMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!fs.existsSync(path.join(dir, name, 'meta.json'))) continue;
    try {
      const meta = readMeta(dir, name);
      if (meta.status === 'open') open.push(meta);
    } catch { /* an unreadable ride must not prevent startup */ }
  }
  return open;
};

/** Seconds of the session skipped before the crash, from the logged skip events ("<step>:<addedS>"). */
const skippedOf = (events: RideEvent[]): number =>
  events.reduce((sum, e) => {
    if (e.type !== 'skip') return sum;
    const added = Number(e.detail?.split(':')[1]);
    return Number.isFinite(added) && added > 0 ? sum + added : sum;
  }, 0);

export const resumePoint = (ride: { samples: Sample[]; events?: RideEvent[] }): { resumeAtS: number; startSeq: number; skippedS: number } => {
  const last = ride.samples.at(-1);
  const skippedS = skippedOf(ride.events ?? []);
  return last ? { resumeAtS: last.rideElapsedS, startSeq: last.seq + 1, skippedS } : { resumeAtS: 0, startSeq: 0, skippedS };
};
