import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { RecordKind, TrackedRecord } from '../../shared/records';
import { lineAfterAck, planWrite, type WriteOrigin } from '../../tracking/kept-copy';
import type { PutResult } from '../../tracking/ports';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

const MAX_OVERWRITTEN = 200;

type Entry = { record: TrackedRecord; seq: number; /** See tracking/kept-copy. */ serverMs?: number; line?: number[] };
type FileData = { seq: number; entries: Record<string, Entry>; overwritten: TrackedRecord[] };

const empty = (): FileData => ({ seq: 0, entries: {}, overwritten: [] });
const keyOf = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;

const valid = (d: unknown): d is FileData => {
  if (typeof d !== 'object' || d === null) return false;
  const f = d as FileData;
  if (typeof f.seq !== 'number' || !Array.isArray(f.overwritten) || typeof f.entries !== 'object' || f.entries === null || Array.isArray(f.entries)) return false;
  return Object.values(f.entries).every(e => typeof e === 'object' && e !== null && typeof e.seq === 'number'
    && typeof e.record === 'object' && e.record !== null && typeof e.record.kind === 'string' && typeof e.record.id === 'string');
};

/** The Mac's own copy of tracked records, one file per profile. Writes are synchronous: temp file, then rename. */
export class RecordStore {
  private readonly dir: string;
  /** Parsed files by profile, valid while mtime and size match (another process may write the file). */
  private readonly cache = new Map<string, { mtimeMs: number; size: number; data: FileData }>();
  constructor(opts: { dir: string }) { this.dir = opts.dir; }

  private file(profileId: string): string { return path.join(this.dir, `${encodeURIComponent(profileId)}.json`); }

  private load(profileId: string): FileData {
    const f = this.file(profileId);
    let st: fs.Stats;
    try { st = fs.statSync(f); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') { this.cache.delete(profileId); return empty(); }
      throw e;
    }
    const hit = this.cache.get(profileId);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;
    this.cache.delete(profileId);
    const data = this.readFile(profileId, f);
    this.remember(profileId, f, data);
    return data;
  }

  private remember(profileId: string, f: string, data: FileData): void {
    try { const st = fs.statSync(f); this.cache.set(profileId, { mtimeMs: st.mtimeMs, size: st.size, data }); } catch { this.cache.delete(profileId); }
  }

  private readFile(profileId: string, f: string): FileData {
    // A read error (busy, no permission) is not corruption: let it through, the file is fine.
    const text = fs.readFileSync(f, 'utf8');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    if (valid(parsed)) return parsed;
    // A workout must never be lost: move the broken file aside instead of overwriting it.
    // If that fails, throw: carrying on would let the next put overwrite the broken file.
    fs.renameSync(f, `${f}.broken-${Date.now()}-${randomBytes(3).toString('hex')}`);
    // Start the sequence at the clock so a cursor handed out before the break still sees everything new.
    // Persist it now, so a read-only call cannot hand out a cursor the file later falls below.
    const reset: FileData = { ...empty(), seq: Date.now() };
    this.save(profileId, reset);
    return reset;
  }

  private save(profileId: string, data: FileData): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const f = this.file(profileId);
    this.cache.delete(profileId);
    writeJsonAtomic(f, data);
    this.remember(profileId, f, data);
  }

  /** A write made on this Mac. `seenMs` is the version it stands on, when the writer knows one. */
  put(profileId: string, r: TrackedRecord, seenMs?: number): PutResult & { copies: TrackedRecord[] } {
    const copies: TrackedRecord[] = [];
    const [result] = this.write(profileId, [r], { from: 'local', seenMs }, copies);
    return { ...result!, copies };
  }

  /**
   * Many records with one load and one save. `remote` for versions from the server, `import` for what this Mac derives
   * (Hevy, plan, complaints). Returns the kept copies this made.
   */
  putMany(profileId: string, records: TrackedRecord[], from: 'remote' | 'import' = 'import'): TrackedRecord[] {
    const copies: TrackedRecord[] = [];
    this.write(profileId, records, { from }, copies);
    return copies;
  }

  private write(profileId: string, records: TrackedRecord[], origin: WriteOrigin, copies: TrackedRecord[]): PutResult[] {
    const data = this.load(profileId);
    // The cached object is mutated in place: if this throws before the save, drop it.
    try { return this.apply(profileId, data, records, origin, copies); } catch (e) { this.cache.delete(profileId); throw e; }
  }

  private apply(profileId: string, data: FileData, records: TrackedRecord[], origin: WriteOrigin, copies: TrackedRecord[]): PutResult[] {
    let changed = false;
    const keepLoser = (loser: TrackedRecord) => {
      const text = JSON.stringify(loser);
      if (data.overwritten.some(o => JSON.stringify(o) === text)) return;
      data.overwritten.push(loser);
      if (data.overwritten.length > MAX_OVERWRITTEN) data.overwritten.splice(0, data.overwritten.length - MAX_OVERWRITTEN);
      changed = true;
    };
    const results = records.map((r) => {
      const key = keyOf(r);
      const have = data.entries[key];
      const plan = planWrite(have && { rec: have.record, serverMs: have.serverMs, line: have.line }, r, origin);
      if (plan.copy) {
        const copyKey = keyOf(plan.copy);
        const other = data.entries[copyKey];
        const c = planWrite(other && { rec: other.record, serverMs: other.serverMs, line: other.line }, plan.copy, { from: 'import' });
        if (c.replaces) { data.entries[copyKey] = { record: c.keep, seq: ++data.seq, serverMs: c.serverMs, line: c.line }; changed = true; copies.push(c.keep); }
      }
      if (plan.replaces) { data.entries[key] = { record: plan.keep, seq: ++data.seq, serverMs: plan.serverMs, line: plan.line }; changed = true; }
      else if (have && plan.serverMs !== have.serverMs) { have.serverMs = plan.serverMs; have.line = plan.line; changed = true; }
      if (plan.overwritten) keepLoser(plan.overwritten);
      return plan.result;
    });
    if (changed) this.save(profileId, data);
    return results;
  }

  /** The server took these versions. Not a change: no new sequence number. */
  acknowledged(profileId: string, records: TrackedRecord[]): void {
    if (records.length === 0) return;
    const data = this.load(profileId);
    try {
      for (const r of records) { const e = data.entries[keyOf(r)]; if (e) { e.serverMs = r.updatedMs; e.line = lineAfterAck(e.line, r.updatedMs); } }
      this.save(profileId, data);
    } catch (e) { this.cache.delete(profileId); throw e; }
  }

  all(profileId: string, kind?: RecordKind): TrackedRecord[] {
    return Object.values(this.load(profileId).entries).map(e => e.record).filter(r => !kind || r.kind === kind);
  }

  changedSince(profileId: string, cursor: number): { records: TrackedRecord[]; cursor: number } {
    const data = this.load(profileId);
    const records = Object.values(data.entries).filter(e => e.seq > cursor).sort((a, b) => a.seq - b.seq).map(e => e.record);
    return { records, cursor: data.seq };
  }

  /** A random value of this profile on this Mac. Lives apart from the records, so it never reaches the server. */
  localSecret(profileId: string): string {
    const f = `${this.file(profileId)}.secret`;
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
    fs.mkdirSync(this.dir, { recursive: true });
    const secret = randomBytes(32).toString('hex');
    fs.writeFileSync(f, secret, { mode: 0o600 });
    return secret;
  }

  /** Copies that lost to a newer one, newest last, at most 200 per profile. */
  overwritten(profileId: string): TrackedRecord[] { return this.load(profileId).overwritten; }
}
