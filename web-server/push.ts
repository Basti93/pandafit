import { createCipheriv, createECDH, createHash, createHmac, createPrivateKey, sign } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { readContact } from '../src/shared/contact';

/**
 * Web Push with Node's own crypto: VAPID (RFC 8292, ES256 JWT) and aes128gcm payload encryption (RFC 8291).
 * Only four messages exist, all short and without health details, because they pass through the browser vendor's push service.
 */
export type PushType = 'version' | 'meal' | 'run' | 'rest' | 'coach';
export const MESSAGES: Record<PushType, { title: string; body: string }> = {
  version: { title: 'Pandafit', body: 'Neue Version von Pandafit. Beim nächsten Öffnen ist sie da.' },
  meal: { title: 'Pandafit', body: 'Dein Essensplan für die Woche ist da.' },
  run: { title: 'Pandafit', body: 'Dein Laufplan für die Woche ist da.' },
  rest: { title: 'Pandafit', body: 'Pause vorbei. Weiter mit dem nächsten Satz.' },
  coach: { title: 'Pandafit', body: 'Dein Coach hat dir geschrieben.' },
};
export const MAX_SUBSCRIPTIONS = 10;
export const SEND_TIMEOUT_MS = 10_000;
const TTL_S = 24 * 3600;

export const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const unb = (s: string): Buffer => Buffer.from(s, 'base64url');
const hmac = (key: Uint8Array, data: Uint8Array): Buffer => createHmac('sha256', key).update(data).digest();
/** HKDF-SHA256 with one output block (all lengths here are at most 32). */
const hkdf = (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Buffer =>
  hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

// ---- endpoint and key checks ----

const EXACT_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
/** https on the default port, to a known push service only, so the server cannot be pointed at other hosts. */
export function validEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 1024) return false;
  let u: URL;
  try { u = new URL(v); } catch { return false; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password) return false;
  return EXACT_HOSTS.includes(u.hostname) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(u.hostname);
}
const isB64u = (v: unknown, bytes: number): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(v) && unb(v).length === bytes;
export const validKeys = (k: unknown): k is { p256dh: string; auth: string } => {
  const o = k as { p256dh?: unknown; auth?: unknown } | null;
  return typeof o === 'object' && o !== null && isB64u(o.p256dh, 65) && unb(o.p256dh as string)[0] === 4 && isB64u(o.auth, 16);
};

// ---- crypto ----

export type VapidKeys = { publicKey: string; privateKey: string };
export const newVapidKeys = (): VapidKeys => {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { publicKey: b64u(e.getPublicKey()), privateKey: b64u(e.getPrivateKey()) };
};

/** RFC 8291: one aes128gcm record. `fixed` is for the test vector only. */
export function encryptPayload(plain: Buffer, sub: { p256dh: string; auth: string }, fixed?: { salt: Buffer; senderPrivate: Buffer }): Buffer {
  const ua = unb(sub.p256dh);
  if (ua.length !== 65 || ua[0] !== 4) throw new Error('bad receiver key');
  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(fixed.senderPrivate); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(ua); // throws for a point that is not on the curve
  const ikm = hkdf(unb(sub.auth), secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32);
  const salt = fixed?.salt ?? Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([plain, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head[20] = asPub.length;
  return Buffer.concat([head, asPub, body]);
}

/** RFC 8292: `vapid t=<JWT>, k=<public key>`, valid for 12 hours, audience is the push service's origin. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowMs: number): string {
  const pub = unb(keys.publicKey);
  const key = createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) } });
  const enc = (o: unknown) => b64u(Buffer.from(JSON.stringify(o)));
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: subject })}`;
  return `vapid t=${data}.${b64u(sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }))}, k=${keys.publicKey}`;
}

// ---- keys, version and sending ----

const meta = (db: DatabaseSync, key: string) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
const setMeta = (db: DatabaseSync, key: string, value: string) => { db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run(key, value); };

/** Created once at the first start and kept in the database (and so in its backups), never in the repo or image. */
export function vapidKeys(db: DatabaseSync): VapidKeys {
  db.prepare("INSERT OR IGNORE INTO meta VALUES ('vapid', ?)").run(JSON.stringify(newVapidKeys()));
  return JSON.parse(meta(db, 'vapid')!) as VapidKeys;
}

/** A hash of the built web app: it changes exactly when a new version of the app is deployed. */
export function buildVersion(dir: string): string {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const h = createHash('sha256');
  for (const f of walk(dir).sort()) h.update(relative(dir, f)).update('\0').update(readFileSync(f));
  return h.digest('hex').slice(0, 16);
}

export type Subscription = { endpoint: string; p256dh: string; auth: string };
export type SendResult = 'ok' | 'gone' | 'failed';
export type Sender = (sub: Subscription, type: PushType, payload: string) => Promise<SendResult>;

/** The real sender: one encrypted POST with a timeout. Only the push service's host and status are ever logged. */
export function webPushSender(o: { keys: VapidKeys; subject: () => string | null; fetchFn?: typeof fetch; now?: () => number; timeoutMs?: number }): Sender {
  const f = o.fetchFn ?? fetch;
  return async (sub, type, payload) => {
    const host = (() => { try { return new URL(sub.endpoint).hostname; } catch { return '?'; } })();
    const subject = o.subject();
    if (!validEndpoint(sub.endpoint) || !subject) { console.warn('push: not sent', host, subject ? 'bad endpoint' : 'no subject'); return 'failed'; }
    try {
      const res = await f(sub.endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(o.timeoutMs ?? SEND_TIMEOUT_MS),
        headers: {
          TTL: type === 'rest' ? '60' : String(TTL_S), Urgency: type === 'rest' ? 'high' : 'normal', Topic: `pandafit-${type}`, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
          Authorization: vapidAuthorization(sub.endpoint, o.keys, subject, (o.now ?? Date.now)()),
        },
        body: new Uint8Array(encryptPayload(Buffer.from(payload), sub)),
      });
      if (res.status === 404 || res.status === 410) return 'gone';
      if (!res.ok) { console.warn('push: send failed', host, res.status); return 'failed'; }
      return 'ok';
    } catch (e) {
      console.warn('push: send failed', host, (e as { name?: string }).name ?? 'Error');
      return 'failed';
    }
  };
}

/** Subscriptions whose login still holds: a live session or a device token that is not revoked. */
const LIVE = `((s.session_hash IS NOT NULL AND EXISTS (SELECT 1 FROM sessions x WHERE x.token_hash = s.session_hash AND x.account_id = s.account_id AND x.expires_ms > :now))
  OR (s.device_id IS NOT NULL AND EXISTS (SELECT 1 FROM devices d WHERE d.id = s.device_id AND d.account_id = s.account_id AND d.revoked = 0)))`;

export type Push = {
  /** Fire and forget: never awaited by a request. The promise is for tests. */
  notifyAccount(accountId: number, type: PushType): Promise<void>;
  notifyAll(type: PushType): Promise<void>;
  /** One subscription only (it must still belong to the account and be live). */
  notifyEndpoint(accountId: number, endpoint: string, type: PushType): Promise<void>;
};

/** Accounts whose contact record says `updates: false` (a missing value means on). */
const updatesOff = (db: DatabaseSync): Set<number> => {
  const rows = db.prepare("SELECT account_id, body FROM records WHERE kind = 'contact' AND id = 'contact' AND deleted = 0").all() as { account_id: number; body: string }[];
  const off = new Set<number>();
  for (const r of rows) { try { if (readContact(JSON.parse(r.body))?.updates === false) off.add(r.account_id); } catch { /* unreadable: stays on */ } }
  return off;
};

export function createPush(db: DatabaseSync, send: Sender | null, now: () => number): Push {
  const run = async (type: PushType, accountId: number | null, endpoint?: string): Promise<void> => {
    if (!send) return;
    try {
      db.prepare(`DELETE FROM push_subs AS s WHERE NOT ${LIVE}`).run({ now: now() });
      const optedOut = type === 'version' && accountId === null ? updatesOff(db) : new Set<number>();
      const subs = (endpoint !== undefined
        ? db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE account_id = ? AND endpoint = ?').all(accountId, endpoint)
        : accountId === null
        ? db.prepare('SELECT endpoint, p256dh, auth, account_id FROM push_subs').all().filter((s) => type !== 'version' || !optedOut.has((s as { account_id: number }).account_id))
        : db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE account_id = ?').all(accountId)) as Subscription[];
      const payload = JSON.stringify({ type, ...MESSAGES[type] });
      await Promise.all(subs.map(async (s) => {
        const r = await send(s, type, payload).catch((): SendResult => 'failed');
        if (r === 'gone') db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint);
      }));
    } catch (e) {
      console.warn('push: error', (e as { name?: string }).name ?? 'Error');
    }
  };
  return { notifyAccount: (id, type) => run(type, id), notifyAll: (type) => run(type, null), notifyEndpoint: (id, endpoint, type) => run(type, id, endpoint) };
}

export type PushOptions = {
  /** 'web': the real push services. Null or missing: nothing is ever sent (tests, the restore drill). */
  send?: Sender | 'web' | null;
  /** VAPID subject (mailto: or https:); defaults to the public origin the app is used from. */
  subject?: string;
  /** The build version of the web app; announced once when it differs from the last one. */
  version?: string | null;
};

/** The keys and the sender for one database handle, as the options ask. */
export function pushFor(db: DatabaseSync, opts: PushOptions | undefined, now: () => number): { keys: VapidKeys; push: Push } {
  const keys = vapidKeys(db);
  const send = opts?.send === 'web' ? webPushSender({ keys, subject: () => opts.subject ?? storedOrigin(db), now }) : opts?.send ?? null;
  return { keys, push: createPush(db, send, now) };
}

/** At startup: a version that differs from the last one announced is stored first (so a crash loop cannot repeat it), then sent once. */
export function announceVersion(db: DatabaseSync, push: Push, version: string): Promise<void> | null {
  if (meta(db, 'push_version') === version) return null;
  setMeta(db, 'push_version', version);
  return push.notifyAll('version');
}

/** The plan record of a week (`week-YYYY-MM-DD` with that key in its body) that is not over yet. Nothing else of the meal plan is read. */
export function mealWeekOf(r: { kind: string; id: string; deleted: boolean; body: unknown }, nowMs: number): string | null {
  if (r.kind !== 'mealplan' || r.deleted) return null;
  const m = /^week-(\d{4}-\d{2}-\d{2})$/.exec(r.id);
  const week = (r.body as { week?: unknown } | null)?.week;
  if (!m || week !== m[1]) return null;
  const start = Date.parse(`${m[1]}T00:00:00Z`);
  return Number.isFinite(start) && start + 8 * 86_400_000 > nowMs ? m[1]! : null;
}

/** The run plan of a week (`run` record `week-YYYY-MM-DD`) that the coach announces, that has runs and that is not over yet. Nothing else of it is read. */
export function runWeekOf(r: { kind: string; id: string; deleted: boolean; body: unknown }, nowMs: number): string | null {
  const b = r.body as { announce?: unknown; runs?: unknown } | null;
  if (r.kind !== 'run' || r.deleted || b?.announce !== true || !Array.isArray(b.runs) || b.runs.length === 0) return null;
  const m = /^week-(\d{4}-\d{2}-\d{2})$/.exec(r.id);
  const week = (r.body as { week?: unknown } | null)?.week;
  if (!m || week !== m[1]) return null;
  const start = Date.parse(`${m[1]}T00:00:00Z`);
  return Number.isFinite(start) && start + 8 * 86_400_000 > nowMs ? m[1]! : null;
}

export const storedOrigin = (db: DatabaseSync): string | null => meta(db, 'push_origin') ?? null;
export const rememberOrigin = (db: DatabaseSync, origin: string): void => { if (meta(db, 'push_origin') !== origin) setMeta(db, 'push_origin', origin); };
