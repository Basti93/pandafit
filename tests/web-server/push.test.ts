import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAccount } from '../../web-server/auth';
import { openDb } from '../../web-server/db';
import { buildServer } from '../../web-server';
import { buildInternal } from '../../web-server/internal';
import { MESSAGES, b64u, buildVersion, runWeekOf, newVapidKeys, validEndpoint, webPushSender, type PushType, type Sender } from '../../web-server/push';
import { login, NOW, PW_A, PW_B, post, rec } from './helpers';

const KEY = newVapidKeys().publicKey; // any valid P-256 point
const AUTH = b64u(Buffer.alloc(16, 3));
const sub = (n: string, host = 'web.push.apple.com') => ({ endpoint: `https://${host}/sub/${n}`, keys: { p256dh: KEY, auth: AUTH } });
const H = (cookie: string) => ({ cookie, host: 'x.test', origin: 'https://x.test' });
const week = (key: string, over: Record<string, unknown> = {}) => ({ kind: 'mealplan', id: `week-${key}`, updatedMs: NOW, deleted: false, body: { week: key, people: [], meals: [] }, ...over });
const runWeek = (key: string, over: Record<string, unknown> = {}, body: Record<string, unknown> = {}) => ({ kind: 'run', id: `week-${key}`, updatedMs: NOW, deleted: false, body: { week: key, announce: true, runs: [{ date: key, kind: 'easy', minutes: 30 }], ...body }, ...over });
// NOW is 2027-01-15 (Friday); the coming week starts 2027-01-18.
const NEXT = '2027-01-18', THIS = '2027-01-11';

async function server(o: { version?: string; db?: string } = {}) {
  const dbPath = o.db ?? join(mkdtempSync(join(tmpdir(), 'pf-push-')), 'test.db');
  if (!o.db) {
    const db = openDb(dbPath);
    await createAccount(db, 'anna', PW_A);
    await createAccount(db, 'ben', PW_B);
    db.close();
  }
  const sent: { endpoint: string; type: PushType; payload: string }[] = [];
  const gone = new Set<string>();
  const send: Sender = vi.fn(async (s, type, payload) => { sent.push({ endpoint: s.endpoint, type, payload }); return gone.has(s.endpoint) ? 'gone' : 'ok'; });
  const app = buildServer({ dbPath, nowMs: () => NOW, push: { send, version: o.version } });
  const internal = buildInternal({ dbPath, token: 'a'.repeat(64), nowMs: () => NOW, push: { send } });
  return { app, internal, dbPath, sent, gone, send };
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const subscribe = (app: any, cookie: string, body: unknown) => app.inject({ method: 'POST', url: '/push/subscribe', headers: H(cookie), payload: body });

describe('push endpoints', () => {
  it('all push routes need a login', async () => {
    const { app } = await server();
    expect((await app.inject({ method: 'GET', url: '/push/key' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/push/subscribe', payload: sub('a') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/push/unsubscribe', payload: { endpoint: sub('a').endpoint } })).statusCode).toBe(401);
  });

  it('the public key is created once and stays the same across restarts', async () => {
    const a = await server();
    const c = (await login(a.app, 'anna', PW_A)).cookie!;
    const k1 = (await a.app.inject({ method: 'GET', url: '/push/key', headers: { cookie: c } })).json().key;
    expect(Buffer.from(k1, 'base64url').length).toBe(65);
    await a.app.close();
    const b = await server({ db: a.dbPath });
    const c2 = (await login(b.app, 'anna', PW_A)).cookie!;
    expect((await b.app.inject({ method: 'GET', url: '/push/key', headers: { cookie: c2 } })).json().key).toBe(k1);
  });

  it('accepts only https endpoints of known push services', () => {
    for (const ok of ['https://web.push.apple.com/QF', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://db5p.notify.windows.com/w/?token=x'])
      expect(validEndpoint(ok), ok).toBe(true);
    for (const bad of ['http://web.push.apple.com/x', 'https://web.push.apple.com:8443/x', 'https://evil.example/x', 'https://web.push.apple.com.evil.example/x',
      'https://notify.windows.com.evil.example/x', 'https://evilnotify.windows.com/x', 'https://user:pw@fcm.googleapis.com/x', 'https://127.0.0.1/x', 'javascript:alert(1)', 'x'.repeat(2000), 42, null])
      expect(validEndpoint(bad), String(bad).slice(0, 60)).toBe(false);
  });

  it('refuses a bad endpoint or bad keys', async () => {
    const { app } = await server();
    const c = (await login(app, 'anna', PW_A)).cookie!;
    expect((await subscribe(app, c, sub('a', 'evil.example'))).statusCode).toBe(400);
    expect((await subscribe(app, c, { ...sub('a'), keys: { p256dh: 'abc', auth: AUTH } })).statusCode).toBe(400);
    expect((await subscribe(app, c, { ...sub('a'), keys: { p256dh: KEY, auth: 'short' } })).statusCode).toBe(400);
    expect((await subscribe(app, c, sub('a'))).statusCode).toBe(200);
  });

  it('keeps at most 10 subscriptions per account, the newest ones', async () => {
    const { app, sent } = await server({ version: 'v2' });
    const c = (await login(app, 'anna', PW_A)).cookie!;
    for (let i = 0; i < 12; i++) expect((await subscribe(app, c, sub(`n${i}`))).statusCode).toBe(200);
    await post(app, H(c), [week(NEXT)]);
    await vi.waitFor(() => expect(sent.filter((s) => s.type === 'meal')).toHaveLength(10));
    expect(sent.map((s) => s.endpoint)).not.toContain(sub('n0').endpoint);
    expect(sent.map((s) => s.endpoint)).not.toContain(sub('n1').endpoint);
  });
});

describe('meal plan notification', () => {
  it('a new plan week sends once to that account only; the other account never gets it', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
    await subscribe(app, a, sub('anna'));
    await subscribe(app, b, sub('ben'));
    await post(app, H(a), [week(NEXT)]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ endpoint: sub('anna').endpoint, type: 'meal' });
    expect(JSON.parse(sent[0]!.payload)).toEqual({ type: 'meal', title: 'Pandafit', body: 'Dein Essensplan für die Woche ist da.' });
    // An update of the same week, a state record and a tombstone send nothing.
    await post(app, H(a), [week(NEXT, { updatedMs: NOW + 1, body: { week: NEXT, people: [{ id: 'p', name: 'x' }], meals: [] } }), { kind: 'mealplan', id: `state-${NEXT}`, updatedMs: NOW, deleted: false, body: {} }]);
    await post(app, H(a), [week(NEXT, { updatedMs: NOW + 2, deleted: true })]);
    await post(app, H(a), [week(NEXT, { updatedMs: NOW + 3 })]);
    await settle();
    expect(sent).toHaveLength(1);
    // Ben's plan for the same week is his own first time.
    await post(app, H(b), [week(NEXT)]);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.endpoint).toBe(sub('ben').endpoint);
  });

  it('a phone that switches accounts gets only the new account\'s notifications', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
    await subscribe(app, a, sub('phone'));
    await subscribe(app, b, sub('phone')); // same browser, now Ben
    await post(app, H(a), [week(NEXT)]);
    await settle();
    expect(sent).toEqual([]);
  });

  it('logging out ends the subscription of that session', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('phone'));
    await app.inject({ method: 'POST', url: '/logout', headers: H(a) });
    const a2 = (await login(app, 'anna', PW_A)).cookie!;
    await post(app, H(a2), [week(NEXT)]);
    await settle();
    expect(sent).toEqual([]);
  });

  it('unsubscribe removes only the own subscription', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
    await subscribe(app, a, sub('anna'));
    expect((await app.inject({ method: 'POST', url: '/push/unsubscribe', headers: H(b), payload: { endpoint: sub('anna').endpoint } })).statusCode).toBe(200);
    await post(app, H(a), [week(NEXT)]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await app.inject({ method: 'POST', url: '/push/unsubscribe', headers: H(a), payload: { endpoint: sub('anna').endpoint } });
    await post(app, H(a), [week('2027-01-25')]);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('a week that is already over, or a body without the matching key, sends nothing', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    await post(app, H(a), [week('2026-12-28'), week('2027-02-01', { body: { week: '2027-02-08' } })]);
    await settle();
    expect(sent).toEqual([]);
    await post(app, H(a), [week(THIS)]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('a gone subscription (404/410) is removed', async () => {
    const { app, sent, gone } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('old'));
    gone.add(sub('old').endpoint);
    await post(app, H(a), [week(NEXT)]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await settle();
    await post(app, H(a), [week('2027-01-25')]);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('weeks stored before push existed do not notify when they are sent again', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'pf-push-')), 'test.db');
    const db = openDb(dbPath);
    await createAccount(db, 'anna', PW_A);
    db.exec('DROP TABLE push_meal_weeks');
    db.prepare('INSERT INTO records VALUES (1, ?, ?, ?, 0, ?, 1)').run('mealplan', `week-${NEXT}`, NOW, JSON.stringify({ week: NEXT }));
    db.close();
    const { app, sent } = await server({ db: dbPath });
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    await post(app, H(a), [week(NEXT, { updatedMs: NOW + 5 })]);
    await settle();
    expect(sent).toEqual([]);
  });

  it('a slow push service never delays the answer to the phone', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'pf-push-')), 'test.db');
    const db = openDb(dbPath);
    await createAccount(db, 'anna', PW_A);
    db.close();
    const app = buildServer({ dbPath, nowMs: () => NOW, push: { send: () => new Promise(() => {}) } });
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    const r = await post(app, H(a), [week(NEXT)]);
    expect(r.json()).toEqual({ accepted: 1, refused: [] });
  });
});

describe('version notification', () => {
  it('a new version is sent once to everyone, not again on a restart with the same version', async () => {
    const one = await server({ version: 'v1' });
    const a = (await login(one.app, 'anna', PW_A)).cookie!, b = (await login(one.app, 'ben', PW_B)).cookie!;
    await subscribe(one.app, a, sub('anna'));
    await subscribe(one.app, b, sub('ben'));
    await one.app.close();

    const two = await server({ db: one.dbPath, version: 'v2' });
    await two.app.ready();
    await vi.waitFor(() => expect(two.sent).toHaveLength(2));
    expect(two.sent.every((s) => s.type === 'version')).toBe(true);
    expect(JSON.parse(two.sent[0]!.payload).body).toBe('Es gibt eine neue Version von Pandafit. Beim nächsten Öffnen ist sie da.');
    await two.app.close();

    const three = await server({ db: one.dbPath, version: 'v2' });
    await three.app.ready();
    await settle();
    expect(three.sent).toEqual([]);
    await three.app.close();
  });

  it('skips accounts that switched the notice off, but other types still reach them', async () => {
    const one = await server({ version: 'v1' });
    const a = (await login(one.app, 'anna', PW_A)).cookie!, b = (await login(one.app, 'ben', PW_B)).cookie!;
    await subscribe(one.app, a, sub('anna'));
    await subscribe(one.app, b, sub('ben'));
    const off = { kind: 'contact', id: 'contact', updatedMs: NOW, deleted: false, body: { email: null, weekly: false, atMs: NOW, updates: false } };
    expect((await post(one.app, H(a), [off])).statusCode).toBe(200);
    await one.app.close();

    const two = await server({ db: one.dbPath, version: 'v2' });
    await two.app.ready();
    await vi.waitFor(() => expect(two.sent).toHaveLength(1));
    await settle();
    expect(two.sent.map((s) => s.endpoint)).toEqual([sub('ben').endpoint]);
    // A meal plan push still goes to the opted-out account.
    const a2 = (await login(two.app, 'anna', PW_A)).cookie!;
    await subscribe(two.app, a2, sub('anna'));
    await post(two.app, H(a2), [week(NEXT)]);
    await vi.waitFor(() => expect(two.sent.some((s) => s.type === 'meal' && s.endpoint === sub('anna').endpoint)).toBe(true));
    await two.app.close();
  });

  it('the build version is a hash of the built files', () => {
    const d = mkdtempSync(join(tmpdir(), 'pf-web-'));
    writeFileSync(join(d, 'index.html'), 'a');
    const v1 = buildVersion(d);
    expect(buildVersion(d)).toBe(v1);
    writeFileSync(join(d, 'index.html'), 'b');
    expect(buildVersion(d)).not.toBe(v1);
  });
});

describe('real sender', () => {
  it('posts an encrypted message with VAPID to the push service and maps 410 to gone, without logging the payload', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let status = 201;
    const send = webPushSender({ keys: newVapidKeys(), subject: () => 'https://x.test', now: () => NOW, fetchFn: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status }); }) as never });
    const s = { endpoint: sub('a').endpoint, p256dh: KEY, auth: AUTH };
    expect(await send(s, 'meal', '{"secret":"payload"}')).toBe('ok');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe(s.endpoint);
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(Buffer.from(calls[0]!.init.body as Uint8Array).toString()).not.toContain('secret');
    status = 410;
    expect(await send(s, 'meal', 'x')).toBe('gone');
    status = 500;
    expect(await send(s, 'meal', '{"secret":"payload"}')).toBe('failed');
    expect(await send({ ...s, endpoint: 'https://evil.example/x' }, 'meal', 'x')).toBe('failed');
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|vapid|sub\/a/);
    warn.mockRestore();
  });
});

describe('run week notification', () => {
  it('a new announced run week notifies the account once', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
    await subscribe(app, a, sub('anna'));
    await subscribe(app, b, sub('ben'));
    await post(app, H(a), [runWeek(NEXT)]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ endpoint: sub('anna').endpoint, type: 'run' });
    await post(app, H(a), [runWeek(NEXT, { updatedMs: NOW + 1 })]);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('a run week with announce false, a resend or a past week does not notify', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    await post(app, H(a), [runWeek(NEXT, {}, { announce: false }), runWeek('2027-01-04'), runWeek('2026-11-02'), runWeek('2027-01-25', {}, { week: NEXT }),
      { kind: 'run', id: 'status', updatedMs: NOW, deleted: false, body: { week: NEXT, announce: true } }, runWeek('2027-02-01', { deleted: true })]);
    await settle();
    expect(sent).toEqual([]);
    const runs = [{ date: NEXT, kind: 'easy', minutes: 30 }];
    expect(runWeekOf({ kind: 'run', id: `week-${NEXT}`, deleted: false, body: { week: NEXT, announce: true, runs } }, NOW)).toBe(NEXT);
    expect(runWeekOf({ kind: 'mealplan', id: `week-${NEXT}`, deleted: false, body: { week: NEXT, announce: true, runs } }, NOW)).toBeNull();
    // A paused week without runs is no plan to announce.
    expect(runWeekOf({ kind: 'run', id: `week-${NEXT}`, deleted: false, body: { week: NEXT, announce: true, runs: [] } }, NOW)).toBeNull();
    expect(runWeekOf({ kind: 'run', id: `week-${NEXT}`, deleted: false, body: { week: NEXT, announce: true } }, NOW)).toBeNull();
    // Announced first as a quiet week, later announced: that is the first announcement.
    await post(app, H(a), [runWeek(NEXT, { updatedMs: NOW + 1 })]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await post(app, H(a), [runWeek(NEXT, { updatedMs: NOW + 2 })]);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('a paused run week without runs sends no push; once it has runs it does, once', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    await post(app, H(a), [runWeek(NEXT, {}, { runs: [] })]);
    await settle();
    expect(sent).toEqual([]);
    await post(app, H(a), [runWeek(NEXT, { updatedMs: NOW + 1 })]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('run weeks stored before the table existed count as announced', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'pf-push-')), 'test.db');
    const db = openDb(dbPath);
    await createAccount(db, 'anna', PW_A);
    db.exec('DROP TABLE push_run_weeks');
    db.prepare('INSERT INTO records VALUES (1, ?, ?, ?, 0, ?, 1)').run('run', `week-${NEXT}`, NOW, JSON.stringify({ week: NEXT, announce: true }));
    db.prepare('INSERT INTO records VALUES (1, ?, ?, ?, 0, ?, 2)').run('run', 'week-2027-01-25', NOW, JSON.stringify({ week: '2027-01-25', announce: false }));
    db.close();
    const { app, sent } = await server({ db: dbPath });
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    await post(app, H(a), [runWeek(NEXT, { updatedMs: NOW + 5 })]);
    await settle();
    expect(sent).toEqual([]);
  });

  it('the run push carries no health details', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    await post(app, H(a), [runWeek(NEXT, {}, { note: 'Wade schmerzt', hrCap: 140 })]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.parse(sent[0]!.payload)).toEqual({ type: 'run', ...MESSAGES.run });
    expect(MESSAGES.run).toEqual({ title: 'Pandafit', body: 'Dein Laufplan für die Woche ist da.' });
  });
});

describe('coach note notification', () => {
  const note = (id: string, body: object) => ({ kind: 'chat', id, updatedMs: NOW, deleted: false, body: { role: 'coach', text: 'Morgen: Rad, locker.', atMs: NOW, ...body } });
  const viaCoach = (internal: any, records: unknown[]) => internal.inject({ method: 'POST', url: '/internal/accounts/1/records', headers: { authorization: `Bearer ${'a'.repeat(64)}` }, payload: { records } });
  it('a new coach message written for a push notifies its account once; answers and rider messages do not', async () => {
    const { app, internal, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    await viaCoach(internal, [note('n1', { push: true })]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ endpoint: sub('anna').endpoint, type: 'coach' });
    await viaCoach(internal, [{ ...note('n1', { push: true }), updatedMs: NOW + 1 }, note('n2', {}), { ...note('n3', { push: true }), body: { role: 'rider', text: 'x', atMs: NOW, push: true } }]);
    await settle();
    expect(sent).toHaveLength(1);
  });
  it('a client cannot write a coach message with push: only that record is refused, the rest is stored', async () => {
    const { app, sent } = await server();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await subscribe(app, a, sub('anna'));
    const res = await post(app, H(a), [note('n1', { push: true }), note('n2', {}), rec('w1')]);
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(2);
    expect(res.json().refused).toEqual([{ kind: 'chat', id: 'n1', reason: 'coach push message from a client' }]);
    await settle();
    expect(sent).toHaveLength(0);
    const ids = (await app.inject({ method: 'GET', url: '/records', headers: H(a) })).json().records.map((r: { id: string }) => r.id);
    expect(ids.sort()).toEqual(['n2', 'w1']);
  });
});
