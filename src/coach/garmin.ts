import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/node/log';
import { guardChild } from './python-runner';
import type { GarminStatus } from '../shared/coach-protocol';
import { plainTokens, TokensUnopenable, type GarminTokens, type TokenCheckout } from './secrets/garmin-tokens';

const log = createLogger('garmin');
const TIMEOUT_MS = 5 * 60_000; // Also long enough to fetch the two-factor code.
const SAFE_ID = /^[A-Za-z0-9-]+$/;

type Options = { baseDir: string; python: string; script: string; onUpdate: () => void; spawnFn?: typeof spawn; timeoutMs?: number; tokens?: GarminTokens };
type Running = { child: ReturnType<typeof spawn>; guard: { clear(): void }; handle: TokenCheckout };

/** Holds the Garmin login per profile. The password goes to the helper program only over stdin and is not kept anywhere here. */
export class GarminLink {
  private states = new Map<string, GarminStatus>();
  private running = new Map<string, Running>();
  private tokens: GarminTokens;
  constructor(private opts: Options) {
    this.tokens = opts.tokens ?? plainTokens(opts.baseDir);
  }

  status(profileId: string): GarminStatus {
    const current = this.states.get(profileId);
    if (current) return current;
    if (!SAFE_ID.test(profileId)) return { state: 'idle' };
    return this.tokens.has(profileId) ? { state: 'connected' } : { state: 'idle' };
  }

  private set(profileId: string, status: GarminStatus): void {
    this.states.set(profileId, status);
    this.opts.onUpdate();
  }

  /** Tokens that do not open are of no use to anyone: they go, and the login starts fresh from the password. */
  private checkoutForLogin(profileId: string): TokenCheckout {
    try { return this.tokens.checkout(profileId); } catch (e) {
      if (!(e instanceof TokensUnopenable)) throw e;
      this.tokens.remove(profileId);
      return this.tokens.checkout(profileId);
    }
  }

  login(profileId: string, email: string, password: string): void {
    if (!SAFE_ID.test(profileId) || this.running.has(profileId)) return;
    if (!fs.existsSync(this.opts.python)) { this.set(profileId, { state: 'failed', reason: 'setup' }); return; }
    let handle: TokenCheckout;
    try { handle = this.checkoutForLogin(profileId); } catch { this.set(profileId, { state: 'failed', reason: 'failed' }); return; }
    // Only once the program has exited: it may still write the tokens after reporting. Safe to repeat.
    const checkin = (): void => { try { this.tokens.checkin(handle); } catch { /* the folder is wiped either way */ } };
    let child: ReturnType<typeof spawn>;
    try {
      child = (this.opts.spawnFn ?? spawn)(this.opts.python, [this.opts.script], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { checkin(); this.set(profileId, { state: 'failed', reason: 'setup' }); return; }
    const finish = (status: GarminStatus): void => {
      const run = this.running.get(profileId);
      if (!run || run.child !== child) return;
      run.guard.clear();
      this.running.delete(profileId);
      this.set(profileId, status);
    };
    const guard = guardChild(child, this.opts.timeoutMs ?? TIMEOUT_MS, () => { log.warn('login timed out', { profileId }); checkin(); finish({ state: 'failed', reason: 'failed' }); });
    this.running.set(profileId, { child, guard, handle });
    this.set(profileId, { state: 'connecting' });

    let buffer = '';
    child.stdout?.on('data', (b: Buffer) => {
      buffer += String(b);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        try {
          const m = JSON.parse(line) as { status?: string; reason?: 'credentials' | 'rate-limit' | 'failed' };
          if (m.status === 'needs-mfa') this.set(profileId, { state: 'needs-mfa' });
          if (m.status === 'connected') {
            // The helper program may still write the check file after this, only the timer ends here.
            finish({ state: 'connected' });
          }
          if (m.status === 'failed') finish({ state: 'failed', reason: m.reason ?? 'failed' });
        } catch { /* not a protocol line */ }
      }
    });
    child.on('error', () => { checkin(); finish({ state: 'failed', reason: 'setup' }); });
    child.on('close', (code: number | null) => {
      if (this.running.get(profileId)?.child === child) log.warn('login helper ended without a result', { profileId, code });
      checkin(); finish({ state: 'failed', reason: 'failed' });
    });
    child.stdin?.on('error', () => { /* process already ended, close reports the error */ });
    child.stdin?.write(`${JSON.stringify({
      tokens: handle.dir,
      check: path.join(this.opts.baseDir, `login-check-${profileId}.json`),
      email, password,
    })}\n`);
  }

  mfa(profileId: string, code: string): void {
    const run = this.running.get(profileId);
    if (!run) return;
    run.child.stdin?.write(`${JSON.stringify({ mfa: code })}\n`);
    this.set(profileId, { state: 'connecting' });
  }

  disconnect(profileId: string): void {
    if (!SAFE_ID.test(profileId)) return;
    const run = this.running.get(profileId);
    if (run) {
      run.guard.clear();
      this.running.delete(profileId);
      try { this.tokens.checkin(run.handle, { discard: true }); } catch { /* wiped either way */ }
      run.child.kill();
    }
    this.tokens.remove(profileId);
    this.states.delete(profileId);
    this.opts.onUpdate();
  }
}
