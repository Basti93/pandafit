import nodeFs from 'node:fs';
import path from 'node:path';
import type { RideEvent, Sample } from '../shared/sample';
import { writeJsonAtomic } from '../shared/node/atomic-write';

export type RideStatus = 'open' | 'finished' | 'aborted' | 'discarded';
export type RideMeta = { rideId: string; profileId: string; sessionId: string; startedAtMs: number; status: RideStatus; formatVersion?: number };
type Fs = typeof nodeFs;

const parseLines = <T>(file: string): T[] => {
  if (!nodeFs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of nodeFs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* truncated line after a crash */ }
  }
  return out;
};

/** Removes an incomplete last line, so that further appending stays cleanly readable. */
const trimPartialLine = (file: string): void => {
  if (!nodeFs.existsSync(file)) return;
  const text = nodeFs.readFileSync(file, 'utf8');
  if (text && !text.endsWith('\n')) nodeFs.truncateSync(file, Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1)));
};

export class RideRecorder {
  private pending: { fd: number; line: string }[] = [];
  private samplesFd: number;
  private eventsFd: number;
  private rideDir: string;
  private metaFailed = false;
  private closed = false;

  get profileId(): string { return this.meta.profileId; }

  private constructor(dir: string, private meta: RideMeta, private fs: Fs) {
    this.rideDir = path.join(dir, meta.rideId);
    this.samplesFd = nodeFs.openSync(path.join(this.rideDir, 'samples.jsonl'), 'a');
    this.eventsFd = nodeFs.openSync(path.join(this.rideDir, 'events.jsonl'), 'a');
  }

  static create(dir: string, meta: RideMeta, fs: Fs = nodeFs): RideRecorder {
    nodeFs.mkdirSync(path.join(dir, meta.rideId), { recursive: true });
    const versioned = { ...meta, formatVersion: 1 };
    const rec = new RideRecorder(dir, versioned, fs);
    rec.writeMeta(versioned);
    return rec;
  }

  static open(dir: string, rideId: string, fs: Fs = nodeFs): RideRecorder {
    const rideDir = path.join(dir, rideId);
    trimPartialLine(path.join(rideDir, 'samples.jsonl'));
    trimPartialLine(path.join(rideDir, 'events.jsonl'));
    return new RideRecorder(dir, readRide(dir, rideId).meta, fs);
  }

  append(sample: Sample): void { this.write(this.samplesFd, sample); }
  event(e: RideEvent): void { this.write(this.eventsFd, e); }
  hasStorageError(): boolean { return this.pending.length > 0 || this.metaFailed; }
  getMeta(): RideMeta { return this.meta; }

  /**
   * Finishes the ride only if everything really is on disk.
   * Otherwise it stays open, and the caller tries again later.
   */
  finish(status: Exclude<RideStatus, 'open'>): boolean {
    if (this.closed) return true;
    this.flush();
    if (this.pending.length > 0) return false;
    try {
      this.writeMeta({ ...this.meta, status });
    } catch {
      this.metaFailed = true;
      return false;
    }
    this.metaFailed = false;
    this.meta = { ...this.meta, status };
    this.closed = true;
    nodeFs.closeSync(this.samplesFd);
    nodeFs.closeSync(this.eventsFd);
    return true;
  }

  private write(fd: number, value: unknown): void {
    this.pending.push({ fd, line: `${JSON.stringify(value)}\n` });
    this.flush();
  }

  /** Writes in order; whatever fails stays in memory and is retried next time. */
  private flush(): void {
    while (this.pending.length) {
      const { fd, line } = this.pending[0];
      try {
        this.fs.writeSync(fd, line);
        this.fs.fsyncSync(fd);
      } catch {
        return;
      }
      this.pending.shift();
    }
  }

  private writeMeta(meta: RideMeta): void {
    writeJsonAtomic(path.join(this.rideDir, 'meta.json'), meta, { fs: this.fs });
  }
}

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
