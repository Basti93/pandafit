import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { ruleValues } from '../../shared/training-policy';

/**
 * Fetching a page a person gave as a link, and finding the schema.org Recipe in it. The fetch is guarded against server-side request
 * forgery: https only, the host is resolved here and every address must be a public one, the connection goes to exactly the address
 * that was checked (so the name cannot change under us), redirects are checked again, and size and time are limited.
 */

const limits = () => ruleValues('meals.import-limits');

// ---- Addresses ----

const v4 = (s: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
};
const inV4 = (p: number[], base: [number, number, number, number], bits: number): boolean => {
  const a = ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
  const b = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3]) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
};
const PRIVATE_V4: [[number, number, number, number], number][] = [
  [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10], [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24], [[192, 88, 99, 0], 24], [[192, 168, 0, 0], 16], [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
];

/** Eight 16-bit groups of an IPv6 address, or null. Handles "::" and a dotted IPv4 tail. */
function groups6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail) {
    const p = v4(tail[1]!);
    if (!p) return null;
    s = `${s.slice(0, -tail[1]!.length)}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8) || (halves.length === 2 && fill < 1)) return null;
  const all = [...head, ...new Array<string>(fill).fill('0'), ...rest];
  if (all.length !== 8) return null;
  const out = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

/** True only for a global unicast address: no loopback, private, link-local, unique-local, multicast, reserved or documentation range. */
export function isPublicAddress(ip: string): boolean {
  const p4 = v4(ip);
  if (p4) return !PRIVATE_V4.some(([base, bits]) => inV4(p4, base, bits)) && !(p4[0] === 255);
  const g = groups6(ip);
  if (!g) return false;
  const embedded = (hi: number, lo: number): boolean => isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judged by the IPv4 address inside.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return embedded(g[6]!, g[7]!);
  // NAT64 (64:ff9b::/96): the IPv4 address inside.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(g[6]!, g[7]!);
  // 6to4 (2002::/16) carries an IPv4 address in the next 32 bits.
  if (g[0] === 0x2002) return embedded(g[1]!, g[2]!);
  // Only 2000::/3 is global unicast.
  if ((g[0]! & 0xe000) !== 0x2000) return false;
  // Teredo, documentation, benchmarking, ORCHID and the like.
  if (g[0] === 0x2001 && (g[1]! === 0 || g[1]! === 0x2 || g[1]! === 0xdb8 || (g[1]! >= 0x10 && g[1]! <= 0x2f))) return false;
  if (g[0] === 0x3fff) return false;
  return true;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|lan|home|intranet|corp|test|invalid|onion)$/i;

export type Pinned = { address: string; family: 4 | 6 };
export type Lookup = (host: string) => Promise<Pinned[]>;
export const systemLookup: Lookup = async (host) => (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

export type Refusal = 'scheme' | 'credentials' | 'port' | 'host' | 'private' | 'unresolved';
/** The address to connect to for a URL, or why it is refused. Resolves the host and checks every address it has. */
export async function vet(raw: string, lookup: Lookup = systemLookup): Promise<{ url: URL; pinned: Pinned } | { refused: Refusal }> {
  let url: URL;
  try { url = new URL(raw); } catch { return { refused: 'scheme' }; }
  if (url.protocol !== 'https:') return { refused: 'scheme' };
  if (url.username || url.password) return { refused: 'credentials' };
  if (url.port && url.port !== '443') return { refused: 'port' };
  const host = (url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname).replace(/\.+$/, '');
  if (!host || host.length > 253) return { refused: 'host' };
  if (net.isIP(host)) return isPublicAddress(host) ? { url, pinned: { address: host, family: net.isIP(host) === 6 ? 6 : 4 } } : { refused: 'private' };
  if (BLOCKED_NAMES.test(host) || !host.includes('.')) return { refused: 'host' };
  let found: Pinned[];
  try { found = await lookup(host); } catch { return { refused: 'unresolved' }; }
  if (found.length === 0) return { refused: 'unresolved' };
  // One private address among the answers refuses the host: it could be the one the connection picks.
  if (found.some((a) => !isPublicAddress(a.address))) return { refused: 'private' };
  return { url, pinned: found[0]! };
}

// ---- Fetching ----

export type Response = { status: number; headers: Record<string, string | string[] | undefined>; body: Readable };
/** One GET to exactly `pinned`, over TLS for the URL's host name. */
export type Transport = (url: URL, pinned: Pinned, o: { timeoutMs: number; accept?: string }) => Promise<Response>;

export const httpsTransport: Transport = (url, pinned, o) => new Promise((resolve, reject) => {
  const req = https.request({
    host: url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname, port: 443, path: `${url.pathname}${url.search}`, method: 'GET', servername: net.isIP(url.hostname) ? undefined : url.hostname,
    // The answer of our own check, whatever the name resolves to now.
    lookup: (_h, opts, cb) => { if (opts && (opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: pinned.address, family: pinned.family }]); else cb(null, pinned.address, pinned.family); },
    headers: { accept: o.accept ?? 'text/html,application/xhtml+xml', 'accept-encoding': 'gzip, deflate, br', 'user-agent': 'PandaFit-Rezeptimport/1.0', host: url.host }, timeout: o.timeoutMs,
  }, (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }));
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.end();
});

export class LimitError extends Error { constructor(readonly kind: 'size' | 'time') { super(kind); } }

/** The body as text, or a LimitError when it is bigger than `maxBytes` (after decompression) or not done by `deadlineMs`. */
export const readBody = async (res: Readable, maxBytes: number, deadlineMs: number, encoding?: string): Promise<string> => (await readBytes(res, maxBytes, deadlineMs, encoding)).toString('utf8');

/** The body as bytes, with the same limits as `readBody`. */
export function readBytes(res: Readable, maxBytes: number, deadlineMs: number, encoding?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let stream: Readable = res;
    if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
    else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
    else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
    else if (encoding && encoding !== 'identity') { res.destroy(); reject(new Error('encoding')); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    const finish = (err: Error | null, bytes?: Buffer) => {
      clearTimeout(timer);
      if (err) { stream.destroy(); res.destroy(); reject(err); } else resolve(bytes ?? Buffer.alloc(0));
    };
    const timer = setTimeout(() => finish(new LimitError('time')), Math.max(1, deadlineMs));
    stream.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > maxBytes) { over = true; finish(new LimitError('size')); return; }
      chunks.push(c);
    });
    stream.on('end', () => { if (!over) finish(null, Buffer.concat(chunks)); });
    stream.on('error', (e) => { if (!over) finish(e); });
  });
}

export type Page = { ok: true; html: string; url: string } | { ok: false; reason: Refusal | 'status' | 'type' | 'size' | 'time' | 'redirects' | 'error' };
export type FetchDeps = { lookup?: Lookup; transport?: Transport; nowMs?: () => number };
export const MAX_REDIRECTS = 3;

/** The page at `raw`, within the register's size and time limits. Never throws. */
export async function fetchPage(raw: string, deps: FetchDeps = {}): Promise<Page> {
  const L = limits();
  const now = deps.nowMs ?? Date.now;
  const started = now();
  const deadline = started + L.fetchTimeoutS! * 1000;
  const transport = deps.transport ?? httpsTransport;
  let current = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const v = await vet(current, deps.lookup);
      if ('refused' in v) return { ok: false, reason: v.refused };
      const left = deadline - now();
      if (left <= 0) return { ok: false, reason: 'time' };
      const res = await withTimeout(transport(v.url, v.pinned, { timeoutMs: left }), left);
      const loc = res.headers.location;
      if (res.status >= 300 && res.status < 400 && typeof loc === 'string') {
        res.body.destroy();
        try { current = new URL(loc, v.url).toString(); } catch { return { ok: false, reason: 'status' }; }
        continue;
      }
      if (res.status !== 200) { res.body.destroy(); return { ok: false, reason: 'status' }; }
      const type = String(res.headers['content-type'] ?? '').toLowerCase();
      if (!/(text\/html|application\/xhtml|application\/ld\+json|text\/plain)/.test(type)) { res.body.destroy(); return { ok: false, reason: 'type' }; }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > L.fetchMaxBytes!) { res.body.destroy(); return { ok: false, reason: 'size' }; }
      const enc = typeof res.headers['content-encoding'] === 'string' ? res.headers['content-encoding'].toLowerCase() : undefined;
      const html = await readBody(res.body, L.fetchMaxBytes!, deadline - now(), enc);
      return { ok: true, html, url: v.url.toString() };
    }
    return { ok: false, reason: 'redirects' };
  } catch (e) {
    if (e instanceof LimitError) return { ok: false, reason: e.kind };
    if (e instanceof Error && e.message === 'timeout') return { ok: false, reason: 'time' };
    return { ok: false, reason: 'error' };
  }
}

export const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), Math.max(1, ms));
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

// ---- JSON-LD ----

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isRecipeType = (t: unknown): boolean => (Array.isArray(t) ? t : [t]).some((x) => typeof x === 'string' && /(^|[/#:])Recipe$/i.test(x));

/** The first schema.org Recipe object in a page's JSON-LD: at the top, in an array, inside `@graph`, or nested (`mainEntity`). Null when there is none. */
export function extractRecipe(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi);
  for (const m of scripts) {
    const text = m[1]!.replace(/^\s*(?:<!--|\/\/\s*<!\[CDATA\[|<!\[CDATA\[)/, '').replace(/(?:-->|\]\]>)\s*$/, '').trim();
    let data: unknown;
    try { data = JSON.parse(text); } catch { continue; }
    const found = find(data, 0);
    if (found) return found;
  }
  return null;
}
function find(x: unknown, depth: number): Record<string, unknown> | null {
  if (depth > 6) return null;
  if (Array.isArray(x)) { for (const v of x) { const f = find(v, depth + 1); if (f) return f; } return null; }
  if (!isObj(x)) return null;
  if (isRecipeType(x['@type'])) return x;
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'hasPart']) { const f = find(x[k], depth + 1); if (f) return f; }
  return null;
}
