import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

/** The most qids kept per account; past that the oldest go first. */
const MAX_QIDS = 5000;
/** A client re-sends an un-acked entry on its next connection: a month is far beyond any real gap. */
const KEEP_MS = 30 * 86_400_000;

/**
 * Per account: the queued entries (by the client's qid) already handled. A re-sent entry whose ack was lost is acked again
 * without being applied, so a note, an answer or a summit never counts twice. Kept on disk, written atomically.
 */
export class HandledQids {
  private seen: Map<string, number> | null = null;

  constructor(private readonly file: string) {}

  private load(): Map<string, number> {
    if (this.seen) return this.seen;
    const seen = new Map<string, number>();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
      if (Array.isArray(raw)) for (const e of raw) if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number') seen.set(e[0], e[1]);
    } catch { /* none yet, or a broken file: start empty */ }
    this.seen = seen;
    return seen;
  }

  has(qid: string): boolean { return this.load().has(qid); }

  /** Remembers a handled qid. Throws when it cannot be written, so the caller can leave the entry un-acked. */
  add(qid: string, nowMs: number): void {
    const seen = this.load();
    seen.delete(qid);
    seen.set(qid, nowMs);
    // Oldest first by insertion: trim by age and by count.
    for (const [k, at] of seen) { if (seen.size > MAX_QIDS || nowMs - at > KEEP_MS) seen.delete(k); else break; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    writeJsonAtomic(this.file, [...seen], { mode: 0o600 });
  }
}
