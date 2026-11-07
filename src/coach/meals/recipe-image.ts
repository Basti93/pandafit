import { ruleValues } from '../../shared/training-policy';
import { LimitError, MAX_REDIRECTS, readBytes, vet, withTimeout, httpsTransport, type FetchDeps } from './recipe-link';

/**
 * A recipe's picture. It arrives inline (base64, from a fetcher that needed keys) or as an https address, which is downloaded here with
 * the link import's guard (https, public address only, redirects checked again, time and size limited). The type comes from the first
 * bytes, never from a header or a name. The picture is stored as it is: there is no image library and nothing is resized.
 */

export type ImageType = 'image/jpeg' | 'image/webp' | 'image/png';
export type Picture = { bytes: Buffer; type: ImageType };
export const EXT: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };
export const TYPE_OF_EXT: Record<string, ImageType> = { jpg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };

const limits = () => ruleValues('meals.import-limits');

/** JPEG, WebP or PNG by the magic bytes; null for anything else (SVG, HTML, GIF, a truncated file). */
export function sniffImage(b: Buffer): ImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** A picture delivered inline: base64 up to the register's size, whose real type is one of the three (the stated type may only agree). */
export function inlinePicture(data: unknown, stated?: unknown): Picture | null {
  if (typeof data !== 'string' || data.length === 0 || data.length > Math.ceil(limits().imageMaxBytes! * 4 / 3) + 8) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0 || bytes.length > limits().imageMaxBytes!) return null;
  const type = sniffImage(bytes);
  if (!type || (typeof stated === 'string' && stated !== type)) return null;
  return { bytes, type };
}

/** The first https address in a schema.org `image` value: a string, a list, or an ImageObject with `url`. */
export function imageUrlOf(x: unknown, depth = 0): string | null {
  if (depth > 3) return null;
  if (typeof x === 'string') return /^https:\/\//i.test(x.trim()) && x.length <= 2048 ? x.trim() : null;
  if (Array.isArray(x)) { for (const v of x.slice(0, 10)) { const u = imageUrlOf(v, depth + 1); if (u) return u; } return null; }
  if (typeof x === 'object' && x !== null) { const o = x as Record<string, unknown>; return imageUrlOf(o.url ?? o.contentUrl, depth + 1); }
  return null;
}

/** Downloads a picture. Never throws; null for a refusal, a failure, a size over the limit or a wrong type. */
export async function fetchPicture(raw: string, deps: FetchDeps = {}): Promise<Picture | null> {
  const L = limits();
  const now = deps.nowMs ?? Date.now;
  const deadline = now() + L.fetchTimeoutS! * 1000;
  const transport = deps.transport ?? httpsTransport;
  let current = raw;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const v = await vet(current, deps.lookup);
      if ('refused' in v) return null;
      const left = deadline - now();
      if (left <= 0) return null;
      const res = await withTimeout(transport(v.url, v.pinned, { timeoutMs: left, accept: 'image/jpeg,image/webp,image/png' }), left);
      const loc = res.headers.location;
      if (res.status >= 300 && res.status < 400 && typeof loc === 'string') {
        res.body.destroy();
        try { current = new URL(loc, v.url).toString(); } catch { return null; }
        continue;
      }
      if (res.status !== 200) { res.body.destroy(); return null; }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > L.imageFetchMaxBytes!) { res.body.destroy(); return null; }
      const enc = typeof res.headers['content-encoding'] === 'string' ? res.headers['content-encoding'].toLowerCase() : undefined;
      const bytes = await readBytes(res.body, L.imageFetchMaxBytes!, deadline - now(), enc);
      const type = sniffImage(bytes);
      return type ? { bytes, type } : null;
    }
    return null;
  } catch (e) {
    if (e instanceof LimitError) return null;
    return null;
  }
}
