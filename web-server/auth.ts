import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 1024;
export const MAX_ACCOUNTS = 2;
export const MAX_SCRYPT_INFLIGHT = 4;
export const stats = { scryptCalls: 0, inflight: 0, maxInflight: 0 };
const KEYLEN = 64;

const scryptAsync = (password: string, salt: Buffer): Promise<Buffer> => {
  stats.scryptCalls++;
  stats.maxInflight = Math.max(stats.maxInflight, ++stats.inflight);
  return new Promise((resolve, reject) => scrypt(password, salt, KEYLEN, (e, key) => { stats.inflight--; if (e) reject(e); else resolve(key); }));
};
const checkLength = (password: string) => {
  if (password.length < MIN_PASSWORD) throw new Error(`password needs at least ${MIN_PASSWORD} characters`);
  if (password.length > MAX_PASSWORD) throw new Error(`password may have at most ${MAX_PASSWORD} characters`);
};

export const newToken = (): string => randomBytes(32).toString('hex');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const safeEqual = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

export const hashPassword = async (password: string): Promise<{ salt: string; hash: string }> => {
  const salt = randomBytes(16);
  return { salt: salt.toString('hex'), hash: (await scryptAsync(password, salt)).toString('hex') };
};

const DUMMY_SALT = randomBytes(16);
const DUMMY_HASH = randomBytes(KEYLEN);

/** Unknown names do the same scrypt work, so timing does not reveal who has an account. */
export const verifyPassword = async (db: DatabaseSync, name: string, password: string): Promise<number | null | 'busy'> => {
  if (stats.inflight >= MAX_SCRYPT_INFLIGHT) return 'busy';
  const row = db.prepare('SELECT id, salt, hash FROM accounts WHERE name = ?').get(name) as { id: number; salt: string; hash: string } | undefined;
  const key = await scryptAsync(password, row ? Buffer.from(row.salt, 'hex') : DUMMY_SALT);
  const ok = safeEqual(key, row ? Buffer.from(row.hash, 'hex') : DUMMY_HASH);
  return row && ok ? row.id : null;
};

export const countAccounts = (db: DatabaseSync): number => (db.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }).c;

export const createAccount = async (db: DatabaseSync, name: string, password: string, opts: { force?: boolean } = {}): Promise<number> => {
  if (!name.trim() || name.length > 100) throw new Error('name must be 1 to 100 characters');
  checkLength(password);
  if (countAccounts(db) >= MAX_ACCOUNTS && !opts.force) throw new Error('two accounts exist already; use --force to add another');
  const { salt, hash } = await hashPassword(password);
  try {
    return Number(db.prepare('INSERT INTO accounts (name, salt, hash) VALUES (?, ?, ?)').run(name, salt, hash).lastInsertRowid);
  } catch {
    throw new Error('name already exists');
  }
};

export const setPassword = async (db: DatabaseSync, name: string, password: string): Promise<void> => {
  checkLength(password);
  const { salt, hash } = await hashPassword(password);
  const r = db.prepare('UPDATE accounts SET salt = ?, hash = ? WHERE name = ?').run(salt, hash, name);
  if (!r.changes) throw new Error('no such account');
  db.prepare('DELETE FROM sessions WHERE account_id = (SELECT id FROM accounts WHERE name = ?)').run(name);
  db.prepare('UPDATE devices SET revoked = 1 WHERE account_id = (SELECT id FROM accounts WHERE name = ?)').run(name);
  db.prepare('DELETE FROM login_attempts WHERE account_key = ?').run(name.toLowerCase());
};

export const listDevices = (db: DatabaseSync) =>
  db.prepare('SELECT d.id, a.name AS account, d.name, d.revoked FROM devices d JOIN accounts a ON a.id = d.account_id ORDER BY d.id').all() as
    { id: number; account: string; name: string; revoked: number }[];

export const revokeDevice = (db: DatabaseSync, id: number): boolean => db.prepare('UPDATE devices SET revoked = 1 WHERE id = ?').run(id).changes > 0;

// --- rate limit, stored in the database so a restart does not reset it ---
export const LIMIT = 10;
/** Per account, only to slow down guessing spread over many addresses; a few tries must never lock the owner out. */
export const ACCOUNT_LIMIT = 100;
export const WINDOW_MS = 15 * 60 * 1000;

export const isLimited = (db: DatabaseSync, now: number, ip: string, key: string): boolean => {
  db.prepare('DELETE FROM login_attempts WHERE at_ms <= ?').run(now - WINDOW_MS);
  const c = (col: string, v: string) =>
    (db.prepare(`SELECT COUNT(*) AS c FROM login_attempts WHERE ${col} = ?`).get(v) as { c: number }).c;
  return c('ip', ip) >= LIMIT || c('account_key', key) >= ACCOUNT_LIMIT;
};
/** Counted before the password check, so parallel guesses cannot slip past the limit. Returns the row to drop again on success. */
export const recordAttempt = (db: DatabaseSync, now: number, ip: string, key: string): number =>
  Number(db.prepare('INSERT INTO login_attempts (at_ms, ip, account_key) VALUES (?, ?, ?)').run(now, ip, key).lastInsertRowid);
export const dropAttempt = (db: DatabaseSync, rowid: number): void => { db.prepare('DELETE FROM login_attempts WHERE rowid = ?').run(rowid); };

// --- client address ---
const v4 = (s: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.some((x) => x > 255) ? null : ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
};
const normalize = (ip: string) => ip.replace(/^::ffff:/i, '');
export const inCidr = (ip: string, cidr: string): boolean => {
  const [net, bitsS] = cidr.split('/');
  const a = v4(normalize(ip)), b = v4(net ?? '');
  const bits = bitsS === undefined ? 32 : Number(bitsS);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
};
/** X-Forwarded-For counts only when the socket peer is in the trusted network; the rightmost untrusted hop is the client. */
export const clientIp = (socketIp: string, xff: string | undefined, trustCidr?: string): string => {
  const sock = normalize(socketIp || 'unknown');
  if (!trustCidr || !xff || !inCidr(sock, trustCidr)) return sock;
  const hops = xff.split(',').map((h) => normalize(h.trim())).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!inCidr(hops[i]!, trustCidr)) return hops[i]!.slice(0, 64);
  return sock;
};
