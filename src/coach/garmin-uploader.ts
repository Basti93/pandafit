import { spawn } from 'node:child_process';
import { createLogger } from '../shared/node/log';
import { guardChild } from './python-runner';
import path from 'node:path';
import { plainTokens, TokensUnopenable, type GarminTokens, type TokenCheckout } from './secrets/garmin-tokens';

const SAFE_ID = /^[A-Za-z0-9-]+$/;
const TIMEOUT_MS = 120_000;
const log = createLogger('garmin-upload');

export type UploadResult = { status: 'uploaded' } | { status: 'failed'; reason: string };
type Options = {
  python: string; script: string; baseDir: string; exportsDir: string; rideOpen: () => boolean;
  /** Default: the tokens have it. */
  hasTokens?: (profileId: string) => boolean;
  onResult: (profileId: string, rideId: string, result: UploadResult) => void; spawnFn?: typeof spawn;
  /** Default: plain, in `<baseDir>/tokens/<id>`. */
  tokens?: GarminTokens;
};
const FAILED: UploadResult = { status: 'failed', reason: 'failed' };

const parse = (out: string): UploadResult => {
  try {
    const m = JSON.parse(out.trim().split('\n').pop() ?? '') as { status?: unknown; reason?: unknown };
    if (m.status === 'uploaded' || m.status === 'duplicate') return { status: 'uploaded' };
    return m.status === 'failed' && typeof m.reason === 'string' ? { status: 'failed', reason: m.reason } : FAILED;
  } catch { return FAILED; }
};

/** Runs the upload program, one per profile. None starts during a ride or without a Garmin login. */
export class GarminUploader {
  private running = new Map<string, { child: ReturnType<typeof spawn>; handle: TokenCheckout }>();
  private tokens: GarminTokens;

  constructor(private opts: Options) {
    this.tokens = opts.tokens ?? plainTokens(opts.baseDir);
  }

  upload(profileId: string, rideId: string, name: string, startMs: number, description?: string): boolean {
    const hasTokens = this.opts.hasTokens ?? ((id: string) => this.tokens.has(id));
    if (!SAFE_ID.test(profileId) || !SAFE_ID.test(rideId) || this.opts.rideOpen() || !hasTokens(profileId) || this.running.has(profileId)) return false;
    let handle: TokenCheckout;
    try { handle = this.tokens.checkout(profileId); } catch (e) {
      // Tokens that do not open need a new login: said so, nothing starts.
      if (e instanceof TokensUnopenable) this.opts.onResult(profileId, rideId, { status: 'failed', reason: 'reauth' });
      return false;
    }
    // Safe to repeat: a second checkin of the same handle only wipes what a late write left in its own folder.
    const checkin = (): void => { try { this.tokens.checkin(handle); } catch { /* the folder is wiped either way */ } };
    let child: ReturnType<typeof spawn>;
    try {
      child = (this.opts.spawnFn ?? spawn)(this.opts.python, [
        this.opts.script, '--tokens', handle.dir, '--file', path.join(this.opts.exportsDir, `${rideId}.fit`), '--name', name, '--start-ms', String(startMs),
        ...(description ? ['--description', description] : []),
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { log.error('upload helper did not start', e, { profileId }); checkin(); return false; }
    const run = { child, handle };
    this.running.set(profileId, run);
    let out = '';
    let ended = false;
    // A run that hangs loses its tokens folder at once, not only when it finally exits.
    const guard = guardChild(child, TIMEOUT_MS, () => { log.warn('upload timed out', { profileId }); checkin(); });
    const end = (result: UploadResult): void => {
      if (ended) return;
      ended = true;
      guard.clear();
      if (result.status !== 'uploaded') log.warn('upload failed', { profileId, rideId, stderr: guard.stderr().slice(-300) });
      checkin();
      if (this.running.get(profileId) === run) this.running.delete(profileId);
      this.opts.onResult(profileId, rideId, result);
    };
    child.stdout?.on('data', (b: Buffer) => { out += String(b); });
    child.on('error', () => end(FAILED));
    child.on('close', () => end(parse(out)));
    return true;
  }

  /** For a disconnect: ends the upload at once and keeps nothing it wrote. Its result still arrives, as a failure. */
  stop(profileId: string): void {
    const run = this.running.get(profileId);
    if (!run) return;
    this.running.delete(profileId);
    try { this.tokens.checkin(run.handle, { discard: true }); } catch { /* wiped either way */ }
    run.child.kill();
  }
}
