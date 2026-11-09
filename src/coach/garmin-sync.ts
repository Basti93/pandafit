import { spawn } from 'node:child_process';
import { createLogger } from '../shared/node/log';
import { guardChild } from './child-guard';
import fs from 'node:fs';
import path from 'node:path';
import type { GarminSyncInfo } from '../shared/coach-protocol';
import { plainTokens, TokensUnopenable, type GarminTokens, type TokenCheckout } from './secrets/garmin-tokens';
import { writeJsonAtomic } from '../shared/node/atomic-write';

const HOUR = 3600_000;
const WHILE_LOADING_MS = 3 * HOUR;
/** Below an hour: with the 5-minute data cache and the scan delay a new activity still arrives within one hour. */
const QUICK_MS = 50 * 60_000;
const WHEN_COMPLETE_MS = 6 * HOUR;
const AFTER_RATE_LIMIT_MS = 6 * HOUR;
const AFTER_FAILURE_MS = 30 * 60_000;
const SYNC_TIMEOUT_MS = 10 * 60_000;
const log = createLogger('garmin-sync');
const EXIT_REAUTH = 10;
const EXIT_RATE = 11;
const SAFE_ID = /^[A-Za-z0-9-]+$/;

type Options = { baseDir: string; python: string; script: string; rideOpen: () => boolean; onUpdate: () => void; nowMs: () => number; spawnFn?: typeof spawn; tokens?: GarminTokens };
type Meta = { lastRunMs: number | null; lastTryMs: number | null; lastQuickMs: number | null; complete: boolean; problem: GarminSyncInfo['problem']; tokensMtimeMs: number | null };
/** stopped: ended on purpose (a ride, a disconnect), which is no failure. */
type Run = { child: ReturnType<typeof spawn>; handle: TokenCheckout; stopped: boolean };
const EMPTY: Meta = { lastRunMs: null, lastTryMs: null, lastQuickMs: null, complete: false, problem: null, tokensMtimeMs: null };

/** Starts the standalone sync program on a schedule and never during a ride. Its state lives in its own database. */
export class GarminSync {
  private running = new Map<string, Run>();
  private metas = new Map<string, Meta>();
  private tokens: GarminTokens;
  constructor(private opts: Options) {
    this.tokens = opts.tokens ?? plainTokens(opts.baseDir);
  }

  private dataDir(id: string): string { return path.join(this.opts.baseDir, 'data', id); }

  private meta(id: string): Meta {
    let m = this.metas.get(id);
    if (!m) {
      try { m = { ...EMPTY, ...JSON.parse(fs.readFileSync(path.join(this.dataDir(id), 'sync-meta.json'), 'utf8')) } as Meta; } catch { m = { ...EMPTY }; }
      this.metas.set(id, m);
    }
    return m;
  }

  private save(id: string, change: Partial<Meta>): void {
    const m = { ...this.meta(id), ...change };
    this.metas.set(id, m);
    try {
      fs.mkdirSync(this.dataDir(id), { recursive: true, mode: 0o700 });
      const file = path.join(this.dataDir(id), 'sync-meta.json');
      writeJsonAtomic(file, m);
    } catch { /* then it only holds until the restart */ }
    this.opts.onUpdate();
  }

  info(id: string): GarminSyncInfo {
    if (!SAFE_ID.test(id)) return { running: false, lastRunMs: null, complete: false, problem: null };
    const { lastRunMs, complete, problem } = this.meta(id);
    return { running: this.running.has(id), lastRunMs, complete, problem };
  }

  private due(id: string, m: Meta, mtime: number): boolean {
    if (m.problem === 'reauth') return mtime !== m.tokensMtimeMs;
    if (m.lastTryMs === null) return true;
    const wait = m.problem === 'rate-limit' ? AFTER_RATE_LIMIT_MS
      : m.problem === 'failed' ? AFTER_FAILURE_MS
        : m.complete ? WHEN_COMPLETE_MS : WHILE_LOADING_MS;
    return this.opts.nowMs() - m.lastTryMs >= wait;
  }

  tick(id: string): void {
    if (!SAFE_ID.test(id)) return;
    const run = this.running.get(id);
    if (run) {
      if (this.opts.rideOpen()) { run.stopped = true; run.child.kill(); }
      return;
    }
    if (this.opts.rideOpen()) return;
    const mtime = this.tokens.mtimeMs(id);
    if (mtime === null) return;
    const m = this.meta(id);
    const full = this.due(id, m, mtime);
    // The light hourly check: only new activities. It never stands in for a due full sync and never during a block.
    const quick = !full && m.problem !== 'reauth' && m.problem !== 'rate-limit'
      && this.opts.nowMs() - Math.max(m.lastQuickMs ?? 0, m.lastTryMs ?? 0) >= QUICK_MS;
    if (!full && !quick) return;
    if (!fs.existsSync(this.opts.python)) {
      if (m.problem !== 'failed') this.save(id, { problem: 'failed', lastTryMs: this.opts.nowMs() });
      return;
    }
    this.start(id, mtime, quick);
  }

  /** For a disconnect: ends the run at once and keeps nothing it wrote, not even a refreshed token. */
  stop(id: string): void {
    const run = this.running.get(id);
    if (!run) return;
    run.stopped = true;
    this.running.delete(id);
    try { this.tokens.checkin(run.handle, { discard: true }); } catch { /* wiped either way */ }
    run.child.kill();
    this.opts.onUpdate();
  }

  private start(id: string, mtime: number, quick: boolean): void {
    const startedAt = this.opts.nowMs();
    const failed = (): void => this.save(id, quick ? { lastQuickMs: startedAt } : { problem: 'failed', lastTryMs: startedAt, tokensMtimeMs: mtime });
    let handle: TokenCheckout;
    try { handle = this.tokens.checkout(id); } catch (e) {
      // Tokens that do not open need a new login, like expired ones. Asked once, until new tokens exist.
      if (e instanceof TokensUnopenable) this.save(id, quick ? { problem: 'reauth', lastQuickMs: startedAt, tokensMtimeMs: mtime } : { problem: 'reauth', lastTryMs: startedAt, tokensMtimeMs: mtime });
      else failed();
      return;
    }
    // Safe to repeat: a second checkin of the same handle only wipes what a late write left in its own folder.
    const checkin = (): void => { try { this.tokens.checkin(handle); } catch { /* the folder is wiped either way */ } };
    let child: ReturnType<typeof spawn>;
    try {
      child = (this.opts.spawnFn ?? spawn)(this.opts.python, [
        this.opts.script, '--tokens', handle.dir, '--db', path.join(this.dataDir(id), 'garmin.db'), ...(quick ? ['--quick'] : []),
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { log.error('sync helper did not start', e, { profileId: id }); checkin(); failed(); return; }
    const guard = guardChild(child, SYNC_TIMEOUT_MS, () => log.warn('sync timed out', { profileId: id }));
    const run: Run = { child, handle, stopped: false };
    this.running.set(id, run);
    if (quick) this.save(id, { lastQuickMs: startedAt });
    if (this.meta(id).problem === 'reauth') this.save(id, { problem: null });
    let complete = this.meta(id).complete;
    let buffer = '';
    child.stdout?.on('data', (b: Buffer) => {
      buffer += String(b);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const m = JSON.parse(line) as { complete?: unknown; status?: unknown };
          if (!quick && m.status && typeof m.complete === 'boolean') complete = m.complete;
        } catch { /* not a protocol line */ }
      }
    });
    let ended = false;
    const end = (code: number | null): void => {
      if (ended) return;
      ended = true;
      guard.clear();
      if (code !== 0 && !this.running.get(id)?.stopped) log.warn('sync helper failed', { profileId: id, code, stderr: guard.stderr().slice(-300) });
      checkin();
      if (this.running.get(id) === run) this.running.delete(id);
      if (run.stopped) { this.opts.onUpdate(); return; }
      const problem = code === 0 ? null : code === EXIT_REAUTH ? 'reauth' : code === EXIT_RATE ? 'rate-limit' : 'failed';
      if (quick) {
        // A quick run leaves lastTryMs and complete alone, except for a block that both kinds of run must respect.
        if (code === 0) this.save(id, { lastRunMs: this.opts.nowMs(), ...(this.meta(id).problem === 'failed' ? { problem: null } : {}) });
        else if (code === EXIT_REAUTH) this.save(id, { problem: 'reauth', tokensMtimeMs: mtime });
        else if (code === EXIT_RATE) this.save(id, { problem: 'rate-limit', lastTryMs: startedAt });
        return;
      }
      this.save(id, { lastTryMs: startedAt, complete, problem, tokensMtimeMs: mtime, ...(code === 0 ? { lastRunMs: this.opts.nowMs() } : {}) });
    };
    child.on('error', () => end(null));
    child.on('close', (code) => end(code));
    this.opts.onUpdate();
  }
}
