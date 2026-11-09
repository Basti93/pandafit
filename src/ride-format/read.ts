import nodeFs from 'node:fs';
import path from 'node:path';
import type { RideEvent, Sample } from '../shared/sample';

export type RideStatus = 'open' | 'finished' | 'aborted' | 'discarded';
export type RideMeta = { rideId: string; profileId: string; sessionId: string; startedAtMs: number; status: RideStatus; formatVersion?: number };

const parseLines = <T>(file: string): T[] => {
  if (!nodeFs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of nodeFs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* truncated line after a crash */ }
  }
  return out;
};

export const readMeta = (dir: string, rideId: string): RideMeta =>
  JSON.parse(nodeFs.readFileSync(path.join(dir, rideId, 'meta.json'), 'utf8')) as RideMeta;

export const readRide = (dir: string, rideId: string): { meta: RideMeta; samples: Sample[]; events: RideEvent[] } => {
  const rideDir = path.join(dir, rideId);
  return {
    meta: JSON.parse(nodeFs.readFileSync(path.join(rideDir, 'meta.json'), 'utf8')) as RideMeta,
    samples: parseLines<Sample>(path.join(rideDir, 'samples.jsonl')),
    events: parseLines<RideEvent>(path.join(rideDir, 'events.jsonl')),
  };
};
