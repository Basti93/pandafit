import { spawn } from 'node:child_process';
import { createLogger } from '../shared/node/log';

const log = createLogger('python');
const STDERR_MAX = 64 * 1024;
const KILL_GRACE_MS = 5000;

export type PythonResult = { code: number; stdout: string; stderr: string };
export class PythonError extends Error {
  constructor(message: string, readonly code: number | null, readonly stdout: string, readonly stderr: string) { super(message); this.name = 'PythonError'; }
}

type ChildLike = { kill(signal?: NodeJS.Signals | number): boolean; on(ev: 'close', fn: () => void): unknown; stderr?: NodeJS.ReadableStream | null };

/**
 * Timeout guard for a helper process: SIGTERM at the limit, SIGKILL after 5 s if it is still there. Collects stderr (at most 64 KiB).
 * `onTimeout` runs once at the limit. Call `clear()` when the process is done by other means.
 */
export const guardChild = (child: ChildLike, timeoutMs: number, onTimeout?: () => void): { stderr(): string; clear(): void; timedOut(): boolean } => {
  let err = '';
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  child.stderr?.on('data', (b: Buffer) => { if (err.length < STDERR_MAX) err = (err + String(b)).slice(0, STDERR_MAX); });
  const timer = setTimeout(() => {
    timedOut = true;
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, KILL_GRACE_MS);
    killTimer.unref?.();
    onTimeout?.();
  }, timeoutMs);
  timer.unref?.();
  const clear = (): void => { clearTimeout(timer); if (killTimer) { clearTimeout(killTimer); killTimer = undefined; } };
  child.on('close', clear);
  return { stderr: () => err, clear, timedOut: () => timedOut };
};

export type RunOptions = { input?: string; timeoutMs: number; env?: NodeJS.ProcessEnv; bin?: string; spawnFn?: typeof spawn };

/** Runs `bin script args` (default python3) to the end. Rejects on timeout, spawn failure and non-zero exit, with a stderr excerpt. */
export const runPython = (script: string, args: string[], opts: RunOptions): Promise<PythonResult> =>
  new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = (opts.spawnFn ?? spawn)(opts.bin ?? 'python3', [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: opts.env });
    } catch (e) { reject(e); return; }
    let out = '';
    child.stdout?.on('data', (b: Buffer) => { out += String(b); });
    const guard = guardChild(child, opts.timeoutMs);
    child.stdin?.on('error', () => { /* the process ended before reading; close reports it */ });
    child.on('error', (e) => { guard.clear(); reject(e); });
    child.on('close', (code: number | null) => {
      guard.clear();
      const stderr = guard.stderr();
      if (guard.timedOut()) { log.error('helper timed out', undefined, { script, timeoutMs: opts.timeoutMs }); reject(new PythonError(`timed out after ${opts.timeoutMs} ms`, code, out, stderr)); return; }
      if (code !== 0) {
        log.error('helper failed', undefined, { script, code, stderr: stderr.slice(-500) });
        reject(new PythonError(`exit ${code}: ${stderr.slice(-500)}`, code, out, stderr));
        return;
      }
      resolve({ code: 0, stdout: out, stderr });
    });
    try { child.stdin?.end(opts.input ?? ''); } catch { /* close reports it */ }
  });
