import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAccount } from '../../web-server/auth';
import { openDb } from '../../web-server/db';
import { buildServer } from '../../web-server';
import { MESSAGES, b64u, newVapidKeys, webPushSender, type PushType, type Sender } from '../../web-server/push';
import { login, NOW, PW_A, PW_B } from './helpers';

const KEY = newVapidKeys().publicKey;
const AUTH = b64u(Buffer.alloc(16, 3));
const sub = (n: string) => ({ endpoint: `https://web.push.apple.com/sub/${n}`, keys: { p256dh: KEY, auth: AUTH } });
const H = (cookie: string) => ({ cookie, host: 'x.test', origin: 'https://x.test' });

async function server() {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'pf-rest-')), 'test.db');
  const db = openDb(dbPath);
  await createAccount(db, 'anna', PW_A);
  await createAccount(db, 'ben', PW_B);
  db.close();
  const sent: { endpoint: string; type: PushType; payload: string }[] = [];
  const gone = new Set<string>();
  const send: Sender = async (s, type, payload) => { sent.push({ endpoint: s.endpoint, type, payload }); return gone.has(s.endpoint) ? 'gone' : 'ok'; };
  const app = buildServer({ dbPath, nowMs: () => NOW, push: { send } });
  return { app, sent, gone };
}
const subscribe = (app: any, cookie: string, s: ReturnType<typeof sub>) => app.inject({ method: 'POST', url: '/push/subscribe', headers: H(cookie), payload: s });
const rest = (app: any, cookie: string, body: unknown) => app.inject({ method: 'POST', url: '/push/rest', headers: H(cookie), payload: body });
const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

describe('rest end alarm', () => {
  it('needs a login and a valid body', async () => {
    const { app } = await server();
    expect((await app.inject({ method: 'POST', url: '/push/rest', payload: { endpoint: sub('a').endpoint, atMs: NOW + 1000 } })).statusCode).toBe(401);
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    const e = sub('anna').endpoint;
    for (const bad of [null, {}, { endpoint: 5, atMs: NOW + 1000 }, { endpoint: e }, { endpoint: e, atMs: 'x' }, { endpoint: e, atMs: NOW }, { endpoint: e, atMs: NOW - 5 }, { endpoint: e, atMs: NOW + 15 * 60_000 + 1 }])
      expect((await rest(app, a, bad)).statusCode, JSON.stringify(bad)).toBe(400);
  });

  it('an endpoint of another account or an unknown one is 404', async () => {
    const { app } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
    await subscribe(app, a, sub('anna'));
    const r = await rest(app, b, { endpoint: sub('anna').endpoint, atMs: NOW + 1000 });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'not found' });
    expect((await rest(app, a, { endpoint: sub('nope').endpoint, atMs: null })).statusCode).toBe(404);
  });

  it('sends the rest push to that one subscription only, at the time, and not twice', async () => {
    fake();
    try {
      const { app, sent } = await server();
      const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
      await subscribe(app, a, sub('phone')); await subscribe(app, a, sub('tablet')); await subscribe(app, b, sub('ben'));
      expect((await rest(app, a, { endpoint: sub('phone').endpoint, atMs: NOW + 60_000 })).statusCode).toBe(200);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ endpoint: sub('phone').endpoint, type: 'rest' });
      expect(JSON.parse(sent[0]!.payload)).toEqual({ type: 'rest', title: 'Pandafit', body: 'Die Pause ist vorbei. Weiter geht es mit dem nächsten Satz.' });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sent).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('null cancels, a new alarm replaces the old one', async () => {
    fake();
    try {
      const { app, sent } = await server();
      const a = (await login(app, 'anna', PW_A)).cookie!;
      await subscribe(app, a, sub('phone'));
      const e = sub('phone').endpoint;
      await rest(app, a, { endpoint: e, atMs: NOW + 30_000 });
      expect((await rest(app, a, { endpoint: e, atMs: null })).statusCode).toBe(200);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(sent).toEqual([]);
      await rest(app, a, { endpoint: e, atMs: NOW + 30_000 });
      await rest(app, a, { endpoint: e, atMs: NOW + 90_000 });
      await vi.advanceTimersByTimeAsync(40_000);
      expect(sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(sent).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('unsubscribe, logout and close clear the alarm', async () => {
    fake();
    try {
      const { app, sent } = await server();
      const a = (await login(app, 'anna', PW_A)).cookie!;
      const e = sub('p1').endpoint;
      await subscribe(app, a, sub('p1'));
      await rest(app, a, { endpoint: e, atMs: NOW + 30_000 });
      await app.inject({ method: 'POST', url: '/push/unsubscribe', headers: H(a), payload: { endpoint: e } });
      await subscribe(app, a, sub('p1'));
      await vi.advanceTimersByTimeAsync(40_000);
      expect(sent).toEqual([]);
      await rest(app, a, { endpoint: e, atMs: NOW + 30_000 });
      await app.inject({ method: 'POST', url: '/logout', headers: H(a) });
      const a2 = (await login(app, 'anna', PW_A)).cookie!;
      await subscribe(app, a2, sub('p1'));
      await vi.advanceTimersByTimeAsync(40_000);
      expect(sent).toEqual([]);
      await rest(app, a2, { endpoint: e, atMs: NOW + 30_000 });
      await app.close();
      await vi.advanceTimersByTimeAsync(40_000);
      expect(sent).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('a gone subscription is removed after the rest push', async () => {
    fake();
    try {
      const { app, sent, gone } = await server();
      const a = (await login(app, 'anna', PW_A)).cookie!;
      const e = sub('p1').endpoint;
      await subscribe(app, a, sub('p1'));
      gone.add(e);
      await rest(app, a, { endpoint: e, atMs: NOW + 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(sent).toHaveLength(1);
      expect((await rest(app, a, { endpoint: e, atMs: NOW + 1000 })).statusCode).toBe(404);
    } finally { vi.useRealTimers(); }
  });

  it('the real sender uses a short TTL and high urgency for rest only', async () => {
    const calls: RequestInit[] = [];
    const send = webPushSender({ keys: newVapidKeys(), subject: () => 'https://x.test', now: () => NOW, fetchFn: (async (_u: string, init: RequestInit) => { calls.push(init); return new Response(null, { status: 201 }); }) as never });
    const s = { endpoint: sub('a').endpoint, p256dh: KEY, auth: AUTH };
    await send(s, 'rest', 'x'); await send(s, 'meal', 'x');
    expect(calls[0]!.headers).toMatchObject({ TTL: '60', Urgency: 'high' });
    expect(calls[1]!.headers).toMatchObject({ TTL: String(24 * 3600), Urgency: 'normal' });
    expect(MESSAGES.rest.body).toBe('Die Pause ist vorbei. Weiter geht es mit dem nächsten Satz.');
  });
});
