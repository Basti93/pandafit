import fs from 'node:fs';
import type { RideUpload } from '../ride-upload-format';
import type { BeginResult, FinishResult, Manifest, MigrationItem } from '../server/migration';

/** Without an answer for this long, a call is given up. For uploads: without a byte moving for this long. */
const TIMEOUT_MS = 60_000;
/** The finish checks and installs everything on the server, a large database included: it gets longer. */
const FINISH_TIMEOUT_MS = 5 * 60_000;
/** How often an upload looks whether a ride opened. */
const CHECK_MS = 1000;
const CHUNK = 64 * 1024;

/**
 * offline: no answer, a cut connection, a timeout or a server that cannot take it now (5xx): try again later.
 * rejected: the login itself failed (401); the link is rejected. refused: the server said no to this request (4xx).
 * stopped: a ride opened, so the request was given up; tried again after the ride.
 * Carries no body and no header: never a secret.
 */
export class CoachHttpError extends Error {
  constructor(readonly kind: 'offline' | 'rejected' | 'refused' | 'stopped', readonly status: number | null = null, readonly reason: string | null = null) {
    super(`Coach-Server: ${kind}${status === null ? '' : ` ${status}`}${reason ? ` ${reason}` : ''}`);
  }
}

export type ServerRide = { rideId: string; sha256: string; status: 'finished' | 'aborted'; startedAtMs: number };

export type CoachHttp = {
  status(): Promise<{ profileId: string | null; moved: boolean }>;
  putRide(u: RideUpload): Promise<{ sha256: string; same: boolean }>;
  /** The closed rides the server holds for this account. */
  listRides(): Promise<ServerRide[]>;
  /** One ride in the upload format. */
  getRide(rideId: string): Promise<RideUpload>;
  /** A refusal (another profile holds the account) is an answer, not an error. */
  begin(m: Manifest): Promise<BeginResult>;
  /** Streams the file from disk as it is read; never holds it whole. */
  putItem(name: MigrationItem, file: string, sha256: string): Promise<void>;
  finish(m: Manifest): Promise<FinishResult>;
  /** The household's meal file, as bytes. */
  meals(file: string): Promise<void>;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

type Body = { kind: 'none' } | { kind: 'json'; value: unknown } | { kind: 'stream'; chunks: () => AsyncIterable<Buffer>; type: string };

/** A buffer in pieces, so an upload's progress can be seen. */
async function* pieces(b: Buffer): AsyncIterable<Buffer> {
  for (let i = 0; i < b.length; i += CHUNK) yield b.subarray(i, i + CHUNK);
}

/**
 * The server coach's routes for one linked profile, reached through the api at `<url>/coach/<route>` with the device token.
 * Uploads (rides, items) are given up only when no byte moved for a minute, so a slow line still gets 128 MiB through; every
 * other call has a minute in total. A 401 rejects the link: nothing is tried again until it is linked anew.
 */
export const coachHttp = (opts: {
  url: string; token: string; fetchFn?: typeof fetch; reject?: () => void;
  /** False once a ride opened: an upload under way is given up within `checkMs` ('stopped'). */
  mayContinue?: () => boolean;
  timeoutMs?: number; finishTimeoutMs?: number; checkMs?: number;
}): CoachHttp => {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const may = (): boolean => { try { return opts.mayContinue?.() ?? true; } catch { return false; } };
  const base = `${opts.url.replace(/\/+$/, '')}/coach`;

  const call = async (method: 'GET' | 'POST' | 'PUT', route: string, body: Body, o: { idle: boolean; totalMs?: number; headers?: Record<string, string>; conflictAnswer?: (d: unknown) => boolean }): Promise<unknown> => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => ctrl.abort(), o.totalMs ?? timeoutMs);
      timer.unref?.();
    };
    arm();
    // A total timeout is armed once; an idle one again with every byte that moves.
    const moved = o.idle ? arm : () => {};
    // An upload stops when a ride opens: before every chunk, and every second while it waits.
    let stopped = false;
    const stop = (): boolean => {
      if (!stopped && !may()) { stopped = true; ctrl.abort(); }
      return stopped;
    };
    const watch = o.idle && opts.mayContinue ? setInterval(stop, opts.checkMs ?? CHECK_MS) : null;
    watch?.unref?.();
    async function* watched(src: AsyncIterable<Buffer>): AsyncIterable<Buffer> {
      for await (const c of src) {
        if (o.idle && stop()) throw new CoachHttpError('stopped');
        moved(); yield c; moved();
      }
    }
    const headers: Record<string, string> = { authorization: `Bearer ${opts.token}`, ...(o.headers ?? {}) };
    const init: RequestInit & { duplex?: 'half' } = { method, headers, signal: ctrl.signal };
    if (body.kind === 'json') {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body.value);
    } else if (body.kind === 'stream') {
      headers['content-type'] = body.type;
      init.body = watched(body.chunks()) as unknown as BodyInit;
      init.duplex = 'half';
    }
    let res: Response;
    let text: string;
    try {
      res = await fetchFn(`${base}${route}`, init);
      moved();
      text = await res.text();
    } catch {
      // Deliberately without the cause: it may name the address or a header.
      throw new CoachHttpError(stopped ? 'stopped' : 'offline');
    } finally {
      if (timer) clearTimeout(timer);
      if (watch) clearInterval(watch);
    }
    if (res.status === 401) {
      try { opts.reject?.(); } catch { /* the token stays unused anyway */ }
      throw new CoachHttpError('rejected', 401);
    }
    let data: unknown = null;
    try { data = text === '' ? null : JSON.parse(text); } catch { /* not JSON */ }
    if (res.ok || (res.status === 409 && o.conflictAnswer?.(data))) return data;
    const reason = isObj(data) && typeof data.reason === 'string' ? data.reason : isObj(data) && typeof data.result === 'string' ? data.result : null;
    // 503 is the api's "coach not there now"; any 5xx is worth another try. A 404 is a server that has no coach yet
    // (the api without PANDAFIT_COACH_URL): not a refusal, so no move starts and no problem is shown.
    throw new CoachHttpError(res.status >= 500 || res.status === 404 ? 'offline' : 'refused', res.status, reason);
  };

  const answer = <T>(data: unknown, ok: (d: Record<string, unknown>) => boolean): T => {
    if (!isObj(data) || !ok(data)) throw new CoachHttpError('offline', null, 'unexpected answer');
    return data as T;
  };
  const fileChunks = (file: string) => () => fs.createReadStream(file, { highWaterMark: CHUNK }) as AsyncIterable<Buffer>;

  return {
    status: async () => {
      const d = answer<{ profileId: unknown; moved: unknown }>(await call('GET', '/status', { kind: 'none' }, { idle: false }), (x) => typeof x.moved === 'boolean');
      return { profileId: typeof d.profileId === 'string' ? d.profileId : null, moved: d.moved === true };
    },
    putRide: async (u) => {
      const bytes = Buffer.from(JSON.stringify(u));
      const d = await call('PUT', `/rides/${encodeURIComponent(u.rideId)}`, { kind: 'stream', chunks: () => pieces(bytes), type: 'application/json' }, { idle: true });
      return answer(d, (x) => typeof x.sha256 === 'string' && typeof x.same === 'boolean');
    },
    listRides: async () => {
      const d = answer<{ rides: unknown }>(await call('GET', '/rides', { kind: 'none' }, { idle: false }), (x) => Array.isArray(x.rides));
      return (d.rides as unknown[]).filter((r): r is ServerRide => isObj(r) && typeof r.rideId === 'string' && typeof r.sha256 === 'string'
        && (r.status === 'finished' || r.status === 'aborted') && typeof r.startedAtMs === 'number');
    },
    getRide: async (rideId) => {
      // A ride may weigh 32 MiB: a minute without a byte moving is the limit, not a minute in total.
      const d = await call('GET', `/rides/${encodeURIComponent(rideId)}`, { kind: 'none' }, { idle: true });
      return answer<RideUpload>(d, (x) => x.v === 1 && x.rideId === rideId && typeof x.sha256 === 'string' && isObj(x.files));
    },
    begin: async (m) => {
      // A 409 is an answer only as the refusal; any other 409 refuses the request.
      const d = await call('POST', '/migrate/begin', { kind: 'json', value: m }, { idle: false, conflictAnswer: (x) => isObj(x) && x.state === 'refused' });
      if (isObj(d) && d.state === 'refused') return { state: 'refused', reason: 'other-profile' };
      return answer<BeginResult>(d, (x) => (x.state === 'open' && Array.isArray(x.haveItems) && Array.isArray(x.haveRides)) || (x.state === 'done' && typeof x.profileId === 'string'));
    },
    putItem: async (name, file, sha256) => {
      await call('PUT', `/migrate/item/${encodeURIComponent(name)}`, { kind: 'stream', chunks: fileChunks(file), type: 'application/octet-stream' }, { idle: true, headers: { 'x-sha256': sha256 } });
    },
    finish: async (m) => {
      const d = await call('POST', '/migrate/finish', { kind: 'json', value: m }, { idle: false, totalMs: opts.finishTimeoutMs ?? FINISH_TIMEOUT_MS });
      return answer<FinishResult>(d, (x) => (x.state === 'done' && isObj(x.counts)) || (x.state === 'missing' && Array.isArray(x.items) && Array.isArray(x.rides)));
    },
    meals: async (file) => {
      const bytes = fs.readFileSync(file);
      await call('POST', '/migrate/meals', { kind: 'stream', chunks: () => pieces(bytes), type: 'application/octet-stream' }, { idle: false });
    },
  };
};
