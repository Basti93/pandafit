import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPicture, imageUrlOf, inlinePicture, sniffImage, type Picture } from '../../../src/coach/meals/recipe-image';
import type { Response, Transport } from '../../../src/coach/meals/recipe-link';
import { RecipeStore } from '../../../src/coach/meals/recipe-store';
import { taggingAi } from './fake-ai';

// Tiny generated images: just the bytes that identify the type, plus filler.
const jpeg = (n = 20) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);
const png = (n = 20) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 2)]);
const webp = (n = 20) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([n, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(n, 3)]);

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'recimg-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const recipe = (n: number, over: Record<string, unknown> = {}) => ({
  '@type': 'Recipe', name: `Erfundener Topf ${n}`, recipeYield: '2', recipeIngredient: [`${100 + n} g Linsen`, '1 Zwiebel', '1 EL Öl', `${n} Karotten`], recipeInstructions: ['Alles kochen.'], ...over,
});
const line = (n: number, over: Record<string, unknown> = {}) => ({ ...recipe(n), url: `https://rezepte.example/r${n}`, ...over });
const jsonl = (items: unknown[]) => items.map((x) => JSON.stringify(x)).join('\n') + '\n';
const put = (store: string, name: string, text: string) => { fs.mkdirSync(path.join(store, 'inbox'), { recursive: true }); fs.writeFileSync(path.join(store, 'inbox', name), text); };
const open = () => true;
const idOf = (s: RecipeStore, n: number): string => (s.database().prepare('SELECT id FROM recipes WHERE url = ?').get(`https://rezepte.example/r${n}`) as { id: string }).id;

describe('magic bytes', () => {
  it('knows the three types and nothing else', () => {
    expect(sniffImage(jpeg())).toBe('image/jpeg');
    expect(sniffImage(png())).toBe('image/png');
    expect(sniffImage(webp())).toBe('image/webp');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html></html>'))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull();
  });
  it('takes the type from the bytes: a stated type that disagrees refuses the picture', () => {
    expect(inlinePicture(jpeg().toString('base64'), 'image/jpeg')).toMatchObject({ type: 'image/jpeg' });
    expect(inlinePicture(png().toString('base64'))).toMatchObject({ type: 'image/png' });
    expect(inlinePicture(jpeg().toString('base64'), 'image/png')).toBeNull();
    expect(inlinePicture(Buffer.from('<svg/>').toString('base64'), 'image/png')).toBeNull();
  });
  it('limits an inline picture to 400 KB decoded and refuses bad base64', () => {
    expect(inlinePicture(jpeg(400_000 - 4).toString('base64'))).not.toBeNull();
    expect(inlinePicture(jpeg(400_000).toString('base64'))).toBeNull();
    expect(inlinePicture('not base64!!')).toBeNull();
    expect(inlinePicture('')).toBeNull();
    expect(inlinePicture(42)).toBeNull();
  });
  it('reads the address from a string, a list or an ImageObject, https only', () => {
    expect(imageUrlOf('https://bilder.example/a.jpg')).toBe('https://bilder.example/a.jpg');
    expect(imageUrlOf(['http://x.example/a.jpg', 'https://bilder.example/b.jpg'])).toBe('https://bilder.example/b.jpg');
    expect(imageUrlOf({ '@type': 'ImageObject', url: 'https://bilder.example/c.jpg' })).toBe('https://bilder.example/c.jpg');
    expect(imageUrlOf([{ url: 'https://bilder.example/d.jpg' }])).toBe('https://bilder.example/d.jpg');
    expect(imageUrlOf('data:image/png;base64,AAAA')).toBeNull();
    expect(imageUrlOf(null)).toBeNull();
  });
});

const res = (body: Buffer, over: Partial<Response> = {}): Response => ({ status: 200, headers: { 'content-type': 'image/jpeg' }, body: Readable.from([body]), ...over });
const lookupTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: (address.includes(':') ? 6 : 4) as 4 | 6 }));

describe('downloading a picture', () => {
  it('goes through the link import guard: private addresses, http and odd ports never reach the network', async () => {
    const transport = vi.fn<Transport>();
    for (const url of ['https://127.0.0.1/a.jpg', 'http://bilder.example/a.jpg', 'https://bilder.example:8443/a.jpg', 'https://user:pw@bilder.example/a.jpg', 'https://localhost/a.jpg']) {
      expect(await fetchPicture(url, { transport, lookup: lookupTo('93.184.216.34') })).toBeNull();
    }
    expect(await fetchPicture('https://bilder.example/a.jpg', { transport, lookup: lookupTo('10.0.0.5') })).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });
  it('connects to the checked address and asks for pictures', async () => {
    const transport = vi.fn<Transport>(async () => res(jpeg()));
    expect(await fetchPicture('https://bilder.example/a', { transport, lookup: lookupTo('93.184.216.34') })).toMatchObject({ type: 'image/jpeg' });
    expect(transport.mock.calls[0]![1]).toEqual({ address: '93.184.216.34', family: 4 });
    expect(transport.mock.calls[0]![2].accept).toContain('image/');
  });
  it('checks every redirect again', async () => {
    const lookup = vi.fn(async (host: string) => [{ address: host === 'evil.example' ? '169.254.169.254' : '93.184.216.34', family: 4 as const }]);
    const transport = vi.fn<Transport>(async () => res(Buffer.alloc(0), { status: 302, headers: { location: 'https://evil.example/x.jpg' } }));
    expect(await fetchPicture('https://bilder.example/a', { transport, lookup })).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('judges by the bytes, not the header: a page or an svg called image/jpeg is refused', async () => {
    const lookup = lookupTo('93.184.216.34');
    expect(await fetchPicture('https://bilder.example/a', { lookup, transport: async () => res(Buffer.from('<html>no</html>')) })).toBeNull();
    expect(await fetchPicture('https://bilder.example/a', { lookup, transport: async () => res(Buffer.from('<svg/>'), { headers: { 'content-type': 'image/jpeg' } }) })).toBeNull();
    expect(await fetchPicture('https://bilder.example/a', { lookup, transport: async () => res(png(), { headers: { 'content-type': 'text/html' } }) })).toMatchObject({ type: 'image/png' });
  });
  it('stops at 1.5 MB, declared or not, and on an error status', async () => {
    const lookup = lookupTo('93.184.216.34');
    expect(await fetchPicture('https://bilder.example/a', { lookup, transport: async () => res(jpeg(1_400_000)) })).not.toBeNull();
    expect(await fetchPicture('https://bilder.example/a', { lookup, transport: async () => res(jpeg(1_600_000)) })).toBeNull();
    expect(await fetchPicture('https://bilder.example/a', { lookup, transport: async () => res(jpeg(), { headers: { 'content-length': '9000000' } }) })).toBeNull();
    expect(await fetchPicture('https://bilder.example/a', { lookup, transport: async () => res(jpeg(), { status: 404 }) })).toBeNull();
    expect(await fetchPicture('https://bilder.example/a', { lookup, transport: async () => { throw new Error('down'); } })).toBeNull();
  });
});

describe('pictures in the store', () => {
  it('imports an inline picture with the recipe, written whole under its id, and keeps it out of the stored source', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    put(dir, 'a.jsonl', jsonl([line(1, { imageData: jpeg().toString('base64'), imageType: 'image/jpeg' })]));
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ imported: 1, pictures: 1 });
    const id = idOf(s, 1);
    const stored = s.imageOf(id)!;
    expect(stored.type).toBe('image/jpeg');
    expect(stored.file).toBe(path.join(dir, 'images', `${id}.jpg`));
    expect(fs.readFileSync(stored.file).equals(jpeg())).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'images')).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    const raw = (s.database().prepare('SELECT raw FROM recipes').get() as { raw: string }).raw;
    expect(raw).not.toContain('imageData');
    s.close();
  });
  it('writes atomically: a failed write leaves no half file and no record', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    await s.add({ source: 'collection', url: 'https://rezepte.example/r1', recipe: recipe(1) });
    const id = idOf(s, 1);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'images'), 'a file where the folder should be');
    expect(s.setImage(id, { bytes: jpeg(), type: 'image/jpeg' })).toBe(false);
    expect(s.imageOf(id)).toBeNull();
    fs.rmSync(path.join(dir, 'images'));
    expect(s.setImage(id, { bytes: png(), type: 'image/png' })).toBe(true);
    expect(s.imageOf(id)!.type).toBe('image/png');
    s.close();
  });
  it('still imports a recipe whose picture is too big, of the wrong type or missing', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    put(dir, 'a.jsonl', jsonl([
      line(1, { imageData: jpeg(400_000).toString('base64'), imageType: 'image/jpeg' }),
      line(2, { imageData: Buffer.from('<svg/>').toString('base64'), imageType: 'image/png' }),
      line(3),
      line(4, { imageData: 'kein base64!!' }),
    ]));
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ imported: 4, pictures: 0, failed: 0 });
    for (const n of [1, 2, 3, 4]) expect(s.imageOf(idOf(s, n))).toBeNull();
    s.close();
  });
  it('downloads an image address at import, with a budget per scan, and the rest wait for the backfill', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    const get = vi.fn(async (_url: string): Promise<Picture | null> => ({ bytes: webp(), type: 'image/webp' }));
    put(dir, 'a.jsonl', jsonl(Array.from({ length: 25 }, (_, i) => line(i + 1, { image: `https://bilder.example/${i + 1}.webp` }))));
    const r = await s.scanInbox({ noOpenRide: open, fetchPicture: get });
    expect(r).toMatchObject({ imported: 25, pictures: 20 });
    expect(get).toHaveBeenCalledTimes(20);
    expect(s.imageOf(idOf(s, 1))!.type).toBe('image/webp');
    expect(s.imageOf(idOf(s, 25))).toBeNull();
    // Next scan: the backfill takes the rest from the stored source.
    put(dir, 'b.jsonl', jsonl([line(99)]));
    expect(await s.scanInbox({ noOpenRide: open, fetchPicture: get })).toMatchObject({ pictures: 5 });
    expect(s.imageOf(idOf(s, 25))).not.toBeNull();
    s.close();
  });
  it('treats a download that fails as no picture and tries again later, three times at most', async () => {
    let now = 1_000;
    const dir = tmp();
    const s = new RecipeStore(dir, () => now);
    const get = vi.fn(async (_url: string): Promise<Picture | null> => null);
    put(dir, 'a.jsonl', jsonl([line(1, { image: { '@type': 'ImageObject', url: 'https://bilder.example/1.jpg' } })]));
    expect(await s.scanInbox({ noOpenRide: open, fetchPicture: get })).toMatchObject({ imported: 1, pictures: 0 });
    expect(get).toHaveBeenCalledTimes(1);
    // Not again at once; again after a day, and given up after three tries.
    for (const hours of [1, 25, 75, 200]) { now += hours * 3_600_000; put(dir, `x${hours}.jsonl`, jsonl([line(50 + hours)])); await s.scanInbox({ noOpenRide: open, fetchPicture: get }); }
    expect(get).toHaveBeenCalledTimes(3);
    s.close();
  });
  it('does not download while a ride is open', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    await s.add({ source: 'collection', url: 'https://rezepte.example/r1', recipe: recipe(1, { image: 'https://bilder.example/1.jpg' }) });
    const get = vi.fn(async (_url: string): Promise<Picture | null> => ({ bytes: jpeg(), type: 'image/jpeg' }));
    expect(await s.backfillImages({ noOpenRide: () => false, fetch: get }, { left: 20 })).toBe(0);
    expect(get).not.toHaveBeenCalled();
    expect(await s.backfillImages({ noOpenRide: open, fetch: get }, { left: 20 })).toBe(1);
    s.close();
  });
  it('backfills at most the budget and never an address that is not https', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    for (let n = 1; n <= 5; n++) await s.add({ source: 'collection', url: `https://rezepte.example/r${n}`, recipe: recipe(n, { image: n === 1 ? 'http://bilder.example/1.jpg' : `https://bilder.example/${n}.jpg` }) });
    const get = vi.fn(async (_url: string): Promise<Picture | null> => ({ bytes: jpeg(), type: 'image/jpeg' }));
    expect(await s.backfillImages({ noOpenRide: open, fetch: get }, { left: 2 })).toBe(2);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls.some(([u]) => u.startsWith('http://'))).toBe(false);
    expect(await s.backfillImages({ noOpenRide: open, fetch: get }, { left: 20 })).toBe(2);
    expect(await s.backfillImages({ noOpenRide: open, fetch: get }, { left: 20 })).toBe(0);
    s.close();
  });

  it('attaches a picture to a recipe delivered again with the same address, keeping tags and verdict, and never overwrites', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    put(dir, 'a.jsonl', jsonl([line(1)]));
    await s.scanInbox({ noOpenRide: open });
    await s.tagIds([idOf(s, 1)], taggingAi());
    const before = s.get(idOf(s, 1))!;
    expect(before.vegCheckedBy).toBe('ai');
    put(dir, 'b.jsonl', jsonl([line(1, { imageData: jpeg().toString('base64'), imageType: 'image/jpeg' })]));
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ imported: 0, pictures: 1, duplicates: 0 });
    expect(s.imageOf(idOf(s, 1))!.type).toBe('image/jpeg');
    expect(s.get(idOf(s, 1))).toEqual(before);
    expect(s.collectionCount()).toBe(1);
    // A third delivery with another picture keeps the first one.
    put(dir, 'c.jsonl', jsonl([line(1, { imageData: png().toString('base64'), imageType: 'image/png' })]));
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ pictures: 0, duplicates: 1 });
    expect(fs.readFileSync(s.imageOf(idOf(s, 1))!.file).equals(jpeg())).toBe(true);
    s.close();
  });
  it('ignores a picture for an address the household deleted or the AI rejected', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    await s.add({ source: 'link', owner: '~own', url: 'https://rezepte.example/r1', recipe: recipe(1) });
    s.remove('max', idOf(s, 1));
    const veg = await s.add({ source: 'collection', url: 'https://rezepte.example/r2', recipe: recipe(2) });
    expect(veg.status).toBe('saved');
    await s.tagIds([idOf(s, 2)], taggingAi(() => ({ vegetarisch: false })));
    const pic = { imageData: jpeg().toString('base64'), imageType: 'image/jpeg' };
    put(dir, 'a.jsonl', jsonl([line(1, { pandafitOwn: true, ...pic }), line(2, pic)]));
    expect(await s.scanInbox({ noOpenRide: open })).toMatchObject({ imported: 0, pictures: 0 });
    expect(fs.existsSync(path.join(dir, 'images'))).toBe(false);
    s.close();
  });
  it('removes the picture with the recipe', async () => {
    const dir = tmp();
    const s = new RecipeStore(dir);
    await s.add({ source: 'link', owner: 'max', url: 'https://rezepte.example/r1', recipe: recipe(1) });
    const id = idOf(s, 1);
    s.setImage(id, { bytes: jpeg(), type: 'image/jpeg' });
    const file = s.imageOf(id)!.file;
    expect(s.remove('max', id)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    s.close();
  });
});
