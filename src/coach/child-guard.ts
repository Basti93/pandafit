const STDERR_MAX = 64 * 1024;
const KILL_GRACE_MS = 5000;

type ChildLike = { kill(signal?: NodeJS.Signals | number): boolean; on(ev: 'close', fn: () => void): unknown; stderr?: NodeJS.ReadableStream | null };

/**
 * Timeout guard for a helper process: SIGTERM at the limit, SIGKILL after 5 s if it is still there. Collects the last 64 KiB of stderr.
 * `onTimeout` runs once at the limit. Call `clear()` when the process is done by other means.
 */
export const guardChild = (child: ChildLike, timeoutMs: number, onTimeout?: () => void): { stderr(): string; clear(): void; timedOut(): boolean } => {
  let err = '';
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  child.stderr?.on('data', (b: Buffer) => { err = (err + String(b)).slice(-STDERR_MAX); });
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

/** The class name of the last Python exception in a stderr tail. Never the message: it can hold tokens or account data. */
export const pythonErrorClass = (stderr: string): string | null => {
  const all = [...stderr.slice(-4096).matchAll(/^(\w+(?:\.\w+)*(?:Error|Exception)):/gm)];
  return all.at(-1)?.[1] ?? null;
};
