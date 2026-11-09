import fs from 'node:fs';
import path from 'node:path';
import type { CoachHome } from '../../shared/coach-protocol';
import { remoteDir } from './home';
import type { MigrateResult } from './migrate';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

type Problem = Extract<CoachHome, { where: 'moving' }>['problem'];

const MIN_MS = 60_000;
/** A failure that may pass (offline, a cut finish, data that kept changing) is tried at least this often. */
const MAX_TRANSIENT_MS = 15 * 60_000;
/** A refusal that will not pass by itself (too large, unreadable, another profile, the same items missing twice). */
const MAX_REFUSED_MS = 6 * 3_600_000;

type Per = { key: string; tries: number; nextMs: number; records: boolean; problem: Problem };
const SAFE_ID = /^[A-Za-z0-9-]+$/;
const PROBLEMS = new Set<string>(['other-profile', 'offline', 'unreadable', 'missing', 'too-large', 'refused']);
const parsePer = (d: unknown): Per | null => {
  if (typeof d !== 'object' || d === null) return null;
  const x = d as Record<string, unknown>;
  if (typeof x.key !== 'string' || typeof x.tries !== 'number' || typeof x.nextMs !== 'number' || typeof x.records !== 'boolean') return null;
  return { key: x.key, tries: x.tries, nextMs: x.nextMs, records: x.records, problem: typeof x.problem === 'string' && PROBLEMS.has(x.problem) ? x.problem as Problem : null };
};

/**
 * When a profile's move may run again. A failure waits a minute, then twice as long each time it repeats with the same reason:
 * up to 15 minutes when it may pass, up to six hours when it will not. While records are unsettled the move waits for them
 * alone, so nothing is asked of the server and nothing hashed until the account sync settled them. With a coach folder the
 * waits are kept in `<coachDir>/remote/<profileId>/move-backoff.json`, so a restart does not cut a long wait short.
 */
export class MoveBackoff {
  private per = new Map<string, Per | null>();
  constructor(private readonly nowMs: () => number = () => Date.now(), private readonly coachDir?: string) {}

  private file(profileId: string): string | null {
    return this.coachDir && SAFE_ID.test(profileId) ? path.join(remoteDir(this.coachDir, profileId), 'move-backoff.json') : null;
  }
  private get(profileId: string): Per | null {
    if (this.per.has(profileId)) return this.per.get(profileId) ?? null;
    const f = this.file(profileId);
    let got: Per | null = null;
    if (f) { try { got = parsePer(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* none kept */ } }
    this.per.set(profileId, got);
    return got;
  }
  private set(profileId: string, s: Per | null): void {
    this.per.set(profileId, s);
    const f = this.file(profileId);
    if (!f) return;
    try {
      if (!s) { fs.rmSync(f, { force: true }); return; }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      writeJsonAtomic(f, s);
    } catch { /* kept in memory; written with the next change */ }
  }

  due(profileId: string, settled: () => boolean): boolean {
    const s = this.get(profileId);
    if (!s) return true;
    if (s.records) { try { return settled(); } catch { return false; } }
    return this.nowMs() >= s.nextMs;
  }

  /** What stops the move, for the coach view. Null when nothing does. */
  problem(profileId: string): Problem {
    return this.get(profileId)?.problem ?? null;
  }

  record(profileId: string, out: MigrateResult): void {
    if (out.state === 'done' || (out.state === 'paused' && out.reason === 'ride')) { this.set(profileId, null); return; }
    const was = this.get(profileId);
    if (out.state === 'paused' && out.reason === 'records') {
      this.set(profileId, { key: was?.key ?? '', tries: was?.tries ?? 0, nextMs: 0, records: true, problem: was?.problem ?? null });
      return;
    }
    const key = out.state === 'refused' ? out.reason : `${out.state}:${out.reason}:${'items' in out ? (out.items ?? []).slice().sort().join(',') : ''}`;
    const tries = was?.key === key ? was.tries + 1 : 1;
    let problem: Problem;
    let lasting: boolean;
    if (out.state === 'refused') { problem = 'other-profile'; lasting = true; }
    else if (out.state === 'paused') { problem = 'offline'; lasting = false; }
    else if (out.reason === 'offline' || out.reason === 'changing') { problem = 'offline'; lasting = false; }
    // The same items missing a second time will not pass by themselves.
    else if (out.reason === 'missing') { lasting = tries >= 2; problem = lasting ? 'missing' : 'offline'; }
    else { problem = out.reason; lasting = true; }
    const wait = Math.min(MIN_MS * 2 ** (tries - 1), lasting ? MAX_REFUSED_MS : MAX_TRANSIENT_MS);
    this.set(profileId, { key, tries, nextMs: this.nowMs() + wait, records: false, problem });
  }
}
