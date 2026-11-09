import { spawn } from 'node:child_process';
import { createLogger } from '../../shared/node/log';
import { guardChild } from '../python-runner';
import { TokensUnopenable, type GarminTokens, type TokenCheckout } from '../secrets/garmin-tokens';

const SAFE_ID = /^[A-Za-z0-9-]+$/;
const TIMEOUT_MS = 180_000;
const log = createLogger('garmin-workouts');

export type WorkoutOps = {
  delete: { workoutId: string; scheduleId: string | null }[];
  create: { date: string; name: string; warmupS: number; mainS: number; cooldownS: number; hrLow: number | null; hrHigh: number | null }[];
  /** Scheduled workouts from `from` to `to` named with `prefix` and not in `keep` are removed before creating (ids lost in a crash). */
  sweep?: { from: string; to: string; prefix: string; keep: string[] } | null;
};
export type WorkoutResult = { status: 'ok' | 'failed'; reason: string | null; deleted: string[]; created: { date: string; workoutId: string; scheduleId: string | null }[] };

type Options = {
  python: string; script: string; baseDir: string; tokens: GarminTokens; rideOpen: () => boolean;
  onResult: (id: string, week: string, r: WorkoutResult) => void; spawnFn?: typeof spawn;
};

const failed = (reason = 'failed'): WorkoutResult => ({ status: 'failed', reason, deleted: [], created: [] });
const isStr = (x: unknown): x is string => typeof x === 'string';

const lastLine = (out: string): unknown => {
  try { return JSON.parse(out.trim().split('\n').pop() ?? ''); } catch { return null; }
};
const parse = (out: string): WorkoutResult => {
  const m = lastLine(out) as Partial<WorkoutResult> | null;
  if (!m || (m.status !== 'ok' && m.status !== 'failed') || !Array.isArray(m.deleted) || !Array.isArray(m.created)) return failed();
  const created = m.created.filter((c) => c && isStr(c.date) && isStr(c.workoutId) && (c.scheduleId === null || isStr(c.scheduleId)));
  return { status: m.status, reason: m.status === 'ok' ? null : isStr(m.reason) ? m.reason : 'failed', deleted: m.deleted.filter(isStr), created };
};

type Run = { child: ReturnType<typeof spawn>; handle: TokenCheckout };

/**
 * Runs `garmin_workout.py`: once per process `--check` (can the library send workouts?), and one send per profile at a time.
 * None starts during a ride or without a Garmin login. Tokens are checked in on every end, as `GarminUploader` does.
 */
export class GarminWorkouts {
  private running = new Map<string, Run>();
  private checked = false;
  private ok = false;

  constructor(private o: Options) {}

  /** False until the check said ok. */
  capable(_id: string): boolean { return this.ok; }

  check(id: string): void {
    if (this.checked) return;
    // `checked` is set only once a check really starts: a profile without a login does not use it up.
    this.start(id, ['--check'], null, (out) => { this.ok = (lastLine(out) as { status?: unknown } | null)?.status === 'ok'; }, () => {}, () => { this.checked = true; });
  }

  send(id: string, week: string, ops: WorkoutOps): boolean {
    if (this.o.rideOpen()) return false;
    return this.start(id, [], JSON.stringify(ops), (out) => this.o.onResult(id, week, parse(out)), () => this.o.onResult(id, week, failed()), () => {}, (r) => this.o.onResult(id, week, r));
  }

  /** For a disconnect: ends the run at once and keeps nothing it wrote. Its result still arrives, as a failure. */
  stop(id: string): void {
    const run = this.running.get(id);
    if (!run) return;
    this.running.delete(id);
    try { this.o.tokens.checkin(run.handle, { discard: true }); } catch { /* wiped either way */ }
    run.child.kill();
  }

  private start(
    id: string, args: string[], stdin: string | null, onClose: (out: string) => void, onError: () => void, onStart: () => void,
    onUnopenable?: (r: WorkoutResult) => void,
  ): boolean {
    if (!SAFE_ID.test(id) || !this.o.tokens.has(id) || this.running.has(id)) return false;
    let handle: TokenCheckout;
    try { handle = this.o.tokens.checkout(id); } catch (e) {
      if (e instanceof TokensUnopenable) onUnopenable?.(failed('reauth'));
      return false;
    }
    const checkin = (): void => { try { this.o.tokens.checkin(handle); } catch { /* the folder is wiped either way */ } };
    let child: ReturnType<typeof spawn>;
    try {
      child = (this.o.spawnFn ?? spawn)(this.o.python, [this.o.script, '--tokens', handle.dir, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { log.error('workout helper did not start', e, { profileId: id }); checkin(); return false; }
    onStart();
    const run = { child, handle };
    this.running.set(id, run);
    let out = '';
    let ended = false;
    const guard = guardChild(child, TIMEOUT_MS, () => { log.warn('workout run timed out', { profileId: id }); checkin(); });
    const end = (fn: () => void): void => {
      if (ended) return;
      ended = true;
      guard.clear();
      checkin();
      if (this.running.get(id) === run) this.running.delete(id);
      fn();
    };
    child.stdout?.on('data', (b: Buffer) => { out += String(b); });
    child.on('error', () => end(onError));
    child.on('close', () => end(() => onClose(out)));
    // A program that ends before reading must not crash the coach with a broken pipe.
    if (typeof child.stdin?.on === 'function') child.stdin.on('error', () => {});
    try { child.stdin?.end(stdin ?? ''); } catch { /* the close reports it */ }
    return true;
  }
}
