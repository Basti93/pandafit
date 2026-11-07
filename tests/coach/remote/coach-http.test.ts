import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { CoachHttpError, coachHttp } from '../../../src/coach/remote/coach-http';

afterEach(() => { vi.useRealTimers(); });

const fileOf = (chunks: number) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chttp-')), 'item');
  fs.writeFileSync(file, Buffer.alloc(chunks * 64 * 1024, 1));
  return file;
};
const aborted = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));

test('a ride opening mid-stream stops the item upload before the next chunk', async () => {
  const file = fileOf(8);
  const w = { open: false, read: 0 };
  const fetchFn = (async (_u: string | URL, init: RequestInit = {}) => {
    for await (const _c of init.body as unknown as AsyncIterable<Uint8Array>) {
      w.read++;
      if (w.read === 2) w.open = true;
    }
    return new Response('{"result":"ok"}', { status: 200 });
  }) as typeof fetch;
  const http = coachHttp({ url: 'https://coach.test', token: 't', fetchFn, mayContinue: () => !w.open });
  await expect(http.putItem('garmin-db', file, 'x')).rejects.toMatchObject({ kind: 'stopped' });
  expect(w.read).toBe(2);
});

test('a ride opening while the upload waits on the server stops it within the check interval', async () => {
  const file = fileOf(1);
  const w = { open: false };
  // The body is read whole, then the server takes its time to answer.
  const fetchFn = (async (_u: string | URL, init: RequestInit = {}) => {
    for await (const _c of init.body as unknown as AsyncIterable<Uint8Array>) { /* read */ }
    return aborted(init.signal!);
  }) as typeof fetch;
  // The timeout is far away: 'stopped' well before it can only come from the check. The bound is loose, for a loaded machine.
  const http = coachHttp({ url: 'https://coach.test', token: 't', fetchFn, mayContinue: () => !w.open, checkMs: 20, timeoutMs: 60_000 });
  const started = Date.now();
  const out = http.putItem('garmin-db', file, 'x');
  setTimeout(() => { w.open = true; }, 30);
  await expect(out).rejects.toMatchObject({ kind: 'stopped' });
  expect(Date.now() - started).toBeLessThan(10_000);
});

test('a ride upload stops the same way', async () => {
  const w = { open: false, read: 0 };
  const fetchFn = (async (_u: string | URL, init: RequestInit = {}) => {
    for await (const _c of init.body as unknown as AsyncIterable<Uint8Array>) { if (++w.read === 1) w.open = true; }
    return new Response('{"sha256":"x","same":false}', { status: 200 });
  }) as typeof fetch;
  const files = { 'meta.json': '{}', 'session.json': '{}', 'samples.jsonl': 'x'.repeat(300 * 1024), 'events.jsonl': '' };
  const http = coachHttp({ url: 'https://coach.test', token: 't', fetchFn, mayContinue: () => !w.open });
  await expect(http.putRide({ v: 1, rideId: 'ride-1', files, fit: null, sha256: 'x' })).rejects.toBeInstanceOf(CoachHttpError);
  expect(w.read).toBe(1);
});

test('finish waits up to five minutes in total; other calls one', async () => {
  vi.useFakeTimers();
  const hang = (async (_u: string | URL, init: RequestInit = {}) => aborted(init.signal!)) as typeof fetch;
  const http = coachHttp({ url: 'https://coach.test', token: 't', fetchFn: hang });
  const m = { profile: { id: 'pa', name: 'A', ftpW: 200 }, rides: [], items: [] };
  let fin: unknown = 'pending';
  http.finish(m as never).then(() => { fin = 'ok'; }, (e: unknown) => { fin = e; });
  let st: unknown = 'pending';
  http.status().then(() => { st = 'ok'; }, (e: unknown) => { st = e; });
  await vi.advanceTimersByTimeAsync(60_001);
  expect(st).toMatchObject({ kind: 'offline' });
  expect(fin).toBe('pending');
  await vi.advanceTimersByTimeAsync(4 * 60_000);
  expect(fin).toMatchObject({ kind: 'offline' });
});

test('a server without the coach (404 on /coach) counts as not there yet, not as a refusal', async () => {
  const fetchFn = (async () => new Response('Not Found', { status: 404 })) as typeof fetch;
  const http = coachHttp({ url: 'https://coach.test', token: 't', fetchFn });
  const e = await http.status().catch((x: unknown) => x);
  expect(e).toBeInstanceOf(CoachHttpError);
  expect((e as CoachHttpError).kind).toBe('offline');
});

test('listRides and getRide read the account\'s rides', async () => {
  const calls: string[] = [];
  const fetchFn = (async (u: string | URL, init: RequestInit = {}) => {
    calls.push(`${init.method} ${String(u)}`);
    if (String(u).endsWith('/rides')) return new Response(JSON.stringify({ rides: [{ rideId: 'ride-1', sha256: 'a', status: 'finished', startedAtMs: 1 }, { rideId: 'x' }] }), { status: 200 });
    return new Response(JSON.stringify({ v: 1, rideId: 'ride-1', files: {}, fit: null, sha256: 'a' }), { status: 200 });
  }) as typeof fetch;
  const http = coachHttp({ url: 'https://coach.test', token: 't', fetchFn });
  expect(await http.listRides()).toEqual([{ rideId: 'ride-1', sha256: 'a', status: 'finished', startedAtMs: 1 }]);
  expect((await http.getRide('ride-1')).rideId).toBe('ride-1');
  await expect(http.getRide('ride-2')).rejects.toBeInstanceOf(CoachHttpError);
  expect(calls).toEqual(['GET https://coach.test/coach/rides', 'GET https://coach.test/coach/rides/ride-1', 'GET https://coach.test/coach/rides/ride-2']);
});
