import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { extractRecipe, fetchPage, isPublicAddress, LimitError, readBody, vet, type Response, type Transport } from '../../../src/coach/meals/recipe-link';

const res = (body: string | Buffer | Readable, over: Partial<Response> = {}): Response => ({
  status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: body instanceof Readable ? body : Readable.from([typeof body === 'string' ? Buffer.from(body) : body]), ...over,
});
const lookupTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: (address.includes(':') ? 6 : 4) as 4 | 6 }));

describe('which addresses are public', () => {
  it.each(['127.0.0.1', '127.1.2.3', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.1', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', 'fec0::1', 'not-an-ip', '1.2.3'])(
    'refuses %s', (ip) => { expect(isPublicAddress(ip)).toBe(false); });
  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8'])('accepts %s', (ip) => { expect(isPublicAddress(ip)).toBe(true); });
});

describe('the guard', () => {
  it.each([
    ['http://rezepte.example/a', 'scheme'], ['ftp://rezepte.example/a', 'scheme'], ['file:///etc/passwd', 'scheme'], ['javascript:alert(1)', 'scheme'], ['nonsense', 'scheme'],
    ['https://user:pw@rezepte.example/a', 'credentials'], ['https://rezepte.example:8443/a', 'port'],
    ['https://localhost/a', 'host'], ['https://localhost./a', 'host'], ['https://intranet/a', 'host'], ['https://mein.server.local/a', 'host'], ['https://thing.internal/a', 'host'],
    ['https://127.0.0.1/a', 'private'], ['https://10.1.2.3/a', 'private'], ['https://192.168.0.10/a', 'private'], ['https://[::1]/a', 'private'], ['https://169.254.169.254/latest/meta-data', 'private'],
    ['https://2130706433/a', 'private'], ['https://0x7f.0.0.1/a', 'private'], ['https://[::ffff:127.0.0.1]/a', 'private'], ['https://[fd00::1]/a', 'private'],
  ])('refuses %s (%s)', async (url, why) => {
    const lookup = vi.fn(lookupTo('93.184.216.34'));
    expect(await vet(url, lookup)).toEqual({ refused: why });
  });
  it('refuses a name that resolves to a private address, also when only one of several does', async () => {
    expect(await vet('https://rezepte.example/a', lookupTo('10.0.0.5'))).toEqual({ refused: 'private' });
    expect(await vet('https://rezepte.example/a', lookupTo('93.184.216.34', '127.0.0.1'))).toEqual({ refused: 'private' });
    expect(await vet('https://rezepte.example/a', lookupTo('93.184.216.34', 'fe80::1'))).toEqual({ refused: 'private' });
    expect(await vet('https://rezepte.example/a', async () => { throw new Error('nxdomain'); })).toEqual({ refused: 'unresolved' });
    expect(await vet('https://rezepte.example/a', lookupTo())).toEqual({ refused: 'unresolved' });
  });
  it('accepts a public https address and pins the connection to the checked address', async () => {
    const v = await vet('https://rezepte.example/a?b=1', lookupTo('93.184.216.34'));
    expect(v).toMatchObject({ pinned: { address: '93.184.216.34', family: 4 } });
  });
});

describe('fetching', () => {
  it('never touches the network for a refused address', async () => {
    const transport = vi.fn<Transport>();
    expect(await fetchPage('https://127.0.0.1/a', { transport })).toEqual({ ok: false, reason: 'private' });
    expect(await fetchPage('http://rezepte.example/a', { transport, lookup: lookupTo('93.184.216.34') })).toEqual({ ok: false, reason: 'scheme' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('connects to the address it checked', async () => {
    const transport = vi.fn<Transport>(async () => res('<html>ok</html>'));
    const p = await fetchPage('https://rezepte.example/a', { transport, lookup: lookupTo('93.184.216.34') });
    expect(p).toMatchObject({ ok: true, html: '<html>ok</html>' });
    expect(transport.mock.calls[0]![1]).toEqual({ address: '93.184.216.34', family: 4 });
  });
  it('checks every redirect again, and refuses one to a private address', async () => {
    const lookup = vi.fn(async (host: string) => [{ address: host === 'evil.example' ? '169.254.169.254' : '93.184.216.34', family: 4 as const }]);
    const transport = vi.fn<Transport>(async () => res('', { status: 302, headers: { location: 'https://evil.example/x' } }));
    expect(await fetchPage('https://rezepte.example/a', { transport, lookup })).toEqual({ ok: false, reason: 'private' });
    expect(transport).toHaveBeenCalledTimes(1);
    const toHttp = vi.fn<Transport>(async () => res('', { status: 301, headers: { location: 'http://rezepte.example/b' } }));
    expect(await fetchPage('https://rezepte.example/a', { transport: toHttp, lookup })).toEqual({ ok: false, reason: 'scheme' });
    const toLocal = vi.fn<Transport>(async () => res('', { status: 301, headers: { location: 'https://127.0.0.1/' } }));
    expect(await fetchPage('https://rezepte.example/a', { transport: toLocal, lookup })).toEqual({ ok: false, reason: 'private' });
  });
  it('follows a few redirects and then gives up', async () => {
    const lookup = lookupTo('93.184.216.34');
    let n = 0;
    const loop = vi.fn<Transport>(async () => res('', { status: 302, headers: { location: `https://rezepte.example/${++n}` } }));
    expect(await fetchPage('https://rezepte.example/a', { transport: loop, lookup })).toEqual({ ok: false, reason: 'redirects' });
    expect(loop).toHaveBeenCalledTimes(4);
  });
  it('refuses other answers and other content', async () => {
    const lookup = lookupTo('93.184.216.34');
    expect(await fetchPage('https://rezepte.example/a', { lookup, transport: async () => res('x', { status: 404 }) })).toEqual({ ok: false, reason: 'status' });
    expect(await fetchPage('https://rezepte.example/a', { lookup, transport: async () => res('x', { headers: { 'content-type': 'image/png' } }) })).toEqual({ ok: false, reason: 'type' });
  });
  it('refuses a page that says it is bigger than 2 MB, and one that turns out to be', async () => {
    const lookup = lookupTo('93.184.216.34');
    expect(await fetchPage('https://rezepte.example/a', { lookup, transport: async () => res('x', { headers: { 'content-type': 'text/html', 'content-length': String(2_000_001) } }) })).toEqual({ ok: false, reason: 'size' });
    const big = Readable.from((function* () { for (let i = 0; i < 30; i++) yield Buffer.alloc(100_000, 97); })());
    expect(await fetchPage('https://rezepte.example/a', { lookup, transport: async () => res(big) })).toEqual({ ok: false, reason: 'size' });
  });
  it('stops after 10 seconds in all, also when the server is silent', async () => {
    let now = 0;
    const silent = new Readable({ read() { /* never */ } });
    vi.useFakeTimers();
    try {
      const p = fetchPage('https://rezepte.example/a', { lookup: lookupTo('93.184.216.34'), nowMs: () => now, transport: async () => res(silent) });
      now = 1000;
      await vi.advanceTimersByTimeAsync(10_500);
      expect(await p).toEqual({ ok: false, reason: 'time' });
    } finally { vi.useRealTimers(); }
  });
  it('gives up when the connection itself hangs', async () => {
    vi.useFakeTimers();
    try {
      const p = fetchPage('https://rezepte.example/a', { lookup: lookupTo('93.184.216.34'), transport: () => new Promise<Response>(() => { /* never */ }) });
      await vi.advanceTimersByTimeAsync(10_500);
      expect(await p).toEqual({ ok: false, reason: 'time' });
    } finally { vi.useRealTimers(); }
  });
  it('reads a compressed page, and counts the size after decompression', async () => {
    const lookup = lookupTo('93.184.216.34');
    const html = '<html>' + 'a'.repeat(1000) + '</html>';
    const ok = await fetchPage('https://rezepte.example/a', { lookup, transport: async () => res(gzipSync(html), { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }) });
    expect(ok).toMatchObject({ ok: true, html });
    const bomb = gzipSync(Buffer.alloc(5_000_000, 97));
    expect(bomb.length).toBeLessThan(100_000);
    expect(await fetchPage('https://rezepte.example/a', { lookup, transport: async () => res(bomb, { headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' } }) })).toEqual({ ok: false, reason: 'size' });
  });
});

describe('reading a body', () => {
  it('stops at the size limit and at the deadline', async () => {
    await expect(readBody(Readable.from([Buffer.alloc(11)]), 10, 1000)).rejects.toBeInstanceOf(LimitError);
    await expect(readBody(Readable.from([Buffer.alloc(10)]), 10, 1000)).resolves.toHaveLength(10);
    await expect(readBody(new Readable({ read() { /* never */ } }), 10, 30)).rejects.toMatchObject({ kind: 'time' });
    await expect(readBody(Readable.from(['x']), 10, 1000, 'weird')).rejects.toThrow('encoding');
  });
});

describe('finding the recipe in a page', () => {
  const page = (...blocks: unknown[]) => `<html><head>${blocks.map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`).join('\n')}</head><body></body></html>`;
  const recipe = { '@type': 'Recipe', name: 'Erfundener Eintopf' };
  it('finds it at the top, in an array, in @graph, nested and with a list of types', () => {
    expect(extractRecipe(page(recipe))).toMatchObject({ name: 'Erfundener Eintopf' });
    expect(extractRecipe(page([{ '@type': 'WebSite' }, recipe]))).toMatchObject({ name: 'Erfundener Eintopf' });
    expect(extractRecipe(page({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization' }, { '@type': ['Article', 'Recipe'], name: 'Im Graph' }] }))).toMatchObject({ name: 'Im Graph' });
    expect(extractRecipe(page({ '@type': 'WebPage', mainEntity: recipe }))).toMatchObject({ name: 'Erfundener Eintopf' });
    expect(extractRecipe(page({ '@type': 'https://schema.org/Recipe', name: 'Voller Typ' }))).toMatchObject({ name: 'Voller Typ' });
  });
  it('skips broken blocks and other blocks before it', () => {
    expect(extractRecipe(page('{kaputt', { '@type': 'BreadcrumbList' }, recipe))).toMatchObject({ name: 'Erfundener Eintopf' });
    expect(extractRecipe(`<script type='application/ld+json'>\n<!--\n${JSON.stringify(recipe)}\n-->\n</script>`)).toMatchObject({ name: 'Erfundener Eintopf' });
  });
  it('returns null without a recipe', () => {
    expect(extractRecipe(page({ '@type': 'Article' }))).toBeNull();
    expect(extractRecipe('<html><p>nichts</p></html>')).toBeNull();
    expect(extractRecipe(page({ '@type': 'Product', name: 'Recipe book' }))).toBeNull();
  });
});
