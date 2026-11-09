import fs from 'node:fs';
import path from 'node:path';
import { RECORD_KINDS_SIGNATURE } from '../../shared/records';
import type { SyncCursors } from '../../tracking/sync';
import { writeJsonAtomic } from '../../shared/node/atomic-write';

const SAFE_ID = /^[A-Za-z0-9-]+$/;
const TIMEOUT_MS = 15_000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type LinkFailure = 'invalid' | 'limited' | 'url' | 'failed';
export class LinkError extends Error {
  constructor(readonly reason: LinkFailure) { super(`link failed: ${reason}`); }
}
export type AccountLinkStatus = { state: 'idle' | 'linked' | 'rejected'; name: string | null };
type Stored = { url: string; name: string; token: string };

/** https only; plain http just for the own machine, so tests and a local server work. */
export const serverUrl = (raw: string): string | null => {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.username || u.password) return null;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
};

/**
 * Links a profile to an account on the Pandafit server. The password is sent once to get a device token and is
 * never kept: not in memory beyond the call, not on disk, not in an error. The token lives in a file only the user can read.
 */
export class AccountLinks {
  private rejected = new Set<string>();
  private fetchFn: typeof fetch;
  constructor(private opts: { dir: string; fetchFn?: typeof fetch; deviceName?: string }) { this.fetchFn = opts.fetchFn ?? fetch; }

  private file(profileId: string): string { return path.join(this.opts.dir, profileId); }
  private read(profileId: string): Stored | null {
    if (!SAFE_ID.test(profileId)) return null;
    try {
      const d = JSON.parse(fs.readFileSync(this.file(profileId), 'utf8')) as Partial<Stored>;
      return typeof d.url === 'string' && typeof d.name === 'string' && typeof d.token === 'string' && d.token !== '' ? { url: d.url, name: d.name, token: d.token } : null;
    } catch { return null; }
  }

  async link(profileId: string, rawUrl: string, name: string, password: string): Promise<void> {
    const url = serverUrl(rawUrl);
    if (!url) throw new LinkError('url');
    if (!SAFE_ID.test(profileId) || typeof name !== 'string' || name.trim() === '' || typeof password !== 'string' || password === '') throw new LinkError('failed');
    let res: Response;
    try {
      res = await this.fetchFn(`${url}/device-token`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ name: name.trim(), password, deviceName: this.opts.deviceName ?? 'Pandafit Mac' }),
      });
    } catch { throw new LinkError('failed'); }
    if (res.status === 401 || res.status === 400) throw new LinkError('invalid');
    if (res.status === 429) throw new LinkError('limited');
    if (!res.ok) throw new LinkError('failed');
    let token: unknown;
    try { token = ((await res.json()) as { token?: unknown }).token; } catch { throw new LinkError('failed'); }
    if (typeof token !== 'string' || token === '') throw new LinkError('failed');
    fs.mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    const f = this.file(profileId);
    const data: Stored = { url, name: name.trim(), token };
    writeJsonAtomic(f, data, { mode: 0o600 });
    // A new account starts from the beginning: the old cursors belong to the old server data.
    fs.rmSync(`${f}.cursors`, { force: true });
    this.rejected.delete(profileId);
  }

  /** Local data stays; only the link goes. */
  unlink(profileId: string): void {
    if (!SAFE_ID.test(profileId)) return;
    fs.rmSync(this.file(profileId), { force: true });
    fs.rmSync(`${this.file(profileId)}.cursors`, { force: true });
    this.rejected.delete(profileId);
  }

  status(profileId: string): AccountLinkStatus {
    const d = this.read(profileId);
    if (!d) return { state: 'idle', name: null };
    return { state: this.rejected.has(profileId) ? 'rejected' : 'linked', name: d.name };
  }

  /** For the coach process only: never part of a status, a log or a prompt. Null once the server refused it. */
  token(profileId: string): string | null { return this.rejected.has(profileId) ? null : this.read(profileId)?.token ?? null; }
  url(profileId: string): string | null { return this.read(profileId)?.url ?? null; }

  /** The server said 401: no more calls until the profile is linked again. */
  reject(profileId: string): void { if (this.read(profileId)) this.rejected.add(profileId); }

  cursors(profileId: string): { get(): Promise<SyncCursors>; set(c: SyncCursors): Promise<void> } {
    const f = `${this.file(profileId)}.cursors`;
    return {
      get: async () => {
        try {
          const d = JSON.parse(fs.readFileSync(f, 'utf8')) as { sent?: unknown; received?: unknown; generation?: unknown; resend?: unknown; kinds?: unknown };
          // A version that did not know a kind skipped its records while the cursor moved past them: when the
          // known kinds change, fetch everything again. Records already here stay; fetching them again changes nothing.
          const sameKinds = d.kinds === RECORD_KINDS_SIGNATURE;
          return {
            sent: typeof d.sent === 'number' ? d.sent : 0, received: sameKinds && typeof d.received === 'number' ? d.received : 0,
            ...(typeof d.generation === 'string' ? { generation: d.generation } : {}), ...(d.resend === true ? { resend: true } : {}),
          };
        } catch { return { sent: 0, received: 0 }; }
      },
      set: async (c) => { writeJsonAtomic(f, { ...c, kinds: RECORD_KINDS_SIGNATURE }); },
    };
  }
}

/** What the account sync needs from the links: the Mac's AccountLinks, or the server's internal records link. */
export type RecordLinks = Pick<AccountLinks, 'link' | 'unlink' | 'status' | 'token' | 'url' | 'reject' | 'cursors'>;
