import fs from 'node:fs';
import path from 'node:path';
import type { RideEvent, Sample } from '../shared/sample';
import { writeJsonAtomic } from '../shared/node/atomic-write';
import { readMeta, type RideMeta } from './recorder';

/** A crash can leave meta.json empty or cut off. The samples still prove the ride exists, so the meta is rebuilt from them. */
const rebuildMeta = (dir: string, name: string): RideMeta | null => {
  let first: Sample | undefined;
  for (const line of fs.readFileSync(path.join(dir, name, 'samples.jsonl'), 'utf8').split('\n')) {
    if (!line) continue;
    try { first = JSON.parse(line) as Sample; break; } catch { /* truncated line */ }
  }
  if (!first) return null;
  let sessionId = '';
  try { sessionId = String((JSON.parse(fs.readFileSync(path.join(dir, name, 'session.json'), 'utf8')) as { session: { id: string } }).session.id); } catch { /* unknown session */ }
  const meta: RideMeta = { rideId: name, profileId: '', sessionId, startedAtMs: first.wallClockMs, status: 'open', formatVersion: 1 };
  writeJsonAtomic(path.join(dir, name, 'meta.json'), meta);
  return meta;
};

export const findOpenRides = (dir: string): RideMeta[] => {
  if (!fs.existsSync(dir)) return [];
  const open: RideMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!fs.existsSync(path.join(dir, name, 'meta.json'))) continue;
    try {
      let meta: RideMeta | null;
      try { meta = readMeta(dir, name); } catch { meta = rebuildMeta(dir, name); }
      if (meta?.status === 'open') open.push(meta);
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
