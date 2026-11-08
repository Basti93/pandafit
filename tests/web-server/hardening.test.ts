import { existsSync, mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { stats } from '../../web-server/auth';
import { run } from '../../web-server/cli';
import { openDb } from '../../web-server/db';
import { login, NOW, PW_A, PW_B, post, rec, setup } from './helpers';

// Logins hash passwords slowly on purpose; on a loaded machine the 5 s default is too short.
vi.setConfig({ testTimeout: 30_000 });

const bad = (app: any, name: string, ip = '10.0.0.1') =>
  app.inject({ method: 'POST', url: '/login', payload: { name, password: 'wrong password' }, remoteAddress: ip });
const get = (app: any, url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

describe('parallel logins', () => {
  it('50 parallel wrong guesses are limited and few reach scrypt; later success still works', async () => {
    const { app } = await setup();
    stats.scryptCalls = 0;
    const res = await Promise.all(Array.from({ length: 50 }, () => bad(app, 'anna')));
    expect(res.filter((r) => r.statusCode === 401).length).toBeLessThanOrEqual(10);
    expect(res.filter((r) => r.statusCode === 429).length).toBeGreaterThanOrEqual(40);
    expect(stats.scryptCalls).toBeLessThanOrEqual(10);
  });

  it('scrypt in flight is capped at 4 globally', async () => {
    const { app } = await setup();
    stats.maxInflight = 0;
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => bad(app, `ghost${i}`, `10.1.0.${i}`)));
    expect(stats.maxInflight).toBeLessThanOrEqual(4);
    expect(res.some((r) => r.statusCode === 429)).toBe(true);
  });

  it('successful logins do not count against the limit', async () => {
    const { app } = await setup();
    for (let i = 0; i < 12; i++) expect((await login(app, 'anna', PW_A)).res.statusCode).toBe(200);
    for (let i = 0; i < 9; i++) await bad(app, 'anna');
    expect((await login(app, 'anna', PW_A)).res.statusCode).toBe(200);
    const par = await Promise.all([1, 2, 3, 4].map(() => login(app, 'ben', PW_B, '10.2.0.1')));
    expect(par.map((p) => p.res.statusCode)).toEqual([200, 200, 200, 200]);
  }, 30_000); // 26 logins, each with a deliberately slow password hash: under full-suite load 5 s is not enough
});

describe('body handling', () => {
  it('a large unauthenticated POST to /records gets 401, a large login body 413', async () => {
    const { app } = await setup();
    const big = JSON.stringify({ records: [], pad: 'x'.repeat(6 * 1024 * 1024) });
    const r = await app.inject({ method: 'POST', url: '/records', headers: { 'content-type': 'application/json' }, payload: big });
    expect(r.statusCode).toBe(401);
    for (const url of ['/login', '/device-token']) {
      const l = await app.inject({ method: 'POST', url, payload: { name: 'anna', password: 'x'.repeat(9000) } });
      expect(l.statusCode, url).toBe(413);
    }
  });
});

describe('records', () => {
  it('a refused record is reported per id; refused is always present', async () => {
    const { app } = await setup();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    const ok = await post(app, { cookie: a }, [rec('fine')]);
    expect(ok.statusCode).toBe(200); expect(ok.json().refused).toEqual([]);
    const r = await post(app, { cookie: a }, [rec('fine2'), rec('bad', NOW, 1, { kind: 'zzz' }), rec('worse', NOW + 9 * 24 * 3600 * 1000)]);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ accepted: 1, refused: [{ kind: 'zzz', id: 'bad', reason: 'unknown kind' }, { kind: 'workout', id: 'worse', reason: 'updatedMs too far ahead' }] });
  });

  it('the same id from two accounts stays separate', async () => {
    const { app } = await setup();
    const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
    await post(app, { cookie: a }, [rec('same', NOW + 10, { who: 'a' })]);
    await post(app, { cookie: b }, [rec('same', NOW, { who: 'b' })]);
    expect((await get(app, '/records', a)).json().records[0].body).toEqual({ who: 'a' });
    expect((await get(app, '/records', b)).json().records[0].body).toEqual({ who: 'b' });
  });

  it('overwritten copies are isolated per account', async () => {
    const { app, dbPath } = await setup();
    const a = (await login(app, 'anna', PW_A)).cookie!, b = (await login(app, 'ben', PW_B)).cookie!;
    for (let k = 0; k < 3; k++) await post(app, { cookie: a }, Array.from({ length: 200 }, (_, i) => rec(`w${i}`, NOW + k, { k })));
    for (let k = 0; k < 4; k++) await post(app, { cookie: b }, Array.from({ length: 200 }, (_, i) => rec(`w${i}`, NOW + k, { k })));
    const db = openDb(dbPath);
    const n = (id: number) => (db.prepare('SELECT COUNT(*) AS c FROM overwritten WHERE account_id = ?').get(id) as { c: number }).c;
    expect(n(1)).toBe(400);
    expect(n(2)).toBe(500);
    db.close();
  });

  it('a cursor above the newest seq resets to a full paged read', async () => {
    const { app } = await setup();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    await post(app, { cookie: a }, [rec('a'), rec('b'), rec('c')]);
    const r = (await get(app, '/records?since=999&limit=2', a)).json();
    expect(r.reset).toBe(true); expect(r.records).toHaveLength(2); expect(r.more).toBe(true); expect(r.cursor).toBe(2);
    const n = (await get(app, '/records?since=3', a)).json();
    expect(n).toMatchObject({ records: [], cursor: 3, more: false, reset: false });
  });
});

describe('sessions and cli', () => {
  it('renewal sets a new cookie and a later expiry', async () => {
    const { app, dbPath, clock } = await setup();
    const { cookie } = await login(app, 'anna', PW_A);
    const db = openDb(dbPath);
    const exp = () => (db.prepare('SELECT expires_ms AS e FROM sessions').get() as { e: number }).e;
    const before = exp();
    clock.now += 3600 * 1000;
    const r = await get(app, '/me', cookie!);
    expect(String(r.headers['set-cookie'])).toContain(cookie!);
    expect(exp()).toBe(before + 3600 * 1000);
    db.close();
  });

  it('logout sends exactly one clearing cookie', async () => {
    const { app } = await setup();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    const r = await app.inject({ method: 'POST', url: '/logout', headers: { cookie: a, host: 'x.test', origin: 'http://x.test' } });
    const sc = r.headers['set-cookie'];
    expect(Array.isArray(sc)).toBe(false);
    expect(String(sc)).toContain('Max-Age=0');
  });

  it('set-password ends sessions, revokes devices and clears that name\'s attempts', async () => {
    const { app, dbPath } = await setup();
    const { cookie } = await login(app, 'anna', PW_A);
    const t = (await app.inject({ method: 'POST', url: '/device-token', payload: { name: 'anna', password: PW_A, deviceName: 'm' } })).json().token;
    await bad(app, 'anna'); await bad(app, 'ben');
    const out: string[] = [];
    expect(await run(['set-password', '--name', 'anna'], dbPath, { readPassword: async () => 'brand new password', out: (s) => out.push(s) })).toBe(0);
    expect(out.join(' ')).toMatch(/device/);
    expect((await get(app, '/me', cookie!)).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(401);
    const db = openDb(dbPath);
    expect(db.prepare("SELECT account_key FROM login_attempts").all()).toEqual([{ account_key: 'ben' }]);
    db.close();
    const tooLong = await run(['set-password', '--name', 'anna'], dbPath, { readPassword: async () => 'x'.repeat(1025), out: (s) => out.push(s) });
    expect(tooLong).toBe(1);
  });
});

describe('files', () => {
  it('data directory is private; dotfiles and symlink escapes are not served; HEAD needs login', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pf-h-'));
    mkdirSync(join(root, 'public', '.well-known'), { recursive: true });
    writeFileSync(join(root, 'public', 'index.html'), 'hi');
    writeFileSync(join(root, 'public', '.env'), 'k=v');
    writeFileSync(join(root, 'public', '.well-known', 'x.txt'), 'wk');
    writeFileSync(join(root, 'secret.txt'), 'secret');
    symlinkSync(join(root, 'secret.txt'), join(root, 'public', 'link.txt'));
    const dbPath = join(root, 'newdata', 'p.db');
    const { buildServer } = await import('../../web-server');
    const app = buildServer({ dbPath, staticDir: join(root, 'public') });
    expect(statSync(join(root, 'newdata')).mode & 0o777).toBe(0o700);
    expect(existsSync(dbPath)).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/.env' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/link.txt' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/.well-known/x.txt' })).statusCode).toBe(200);
    for (const url of ['/me', '/records']) expect((await app.inject({ method: 'HEAD', url })).statusCode, url).toBe(401);
  });

  it('serves the Panda runtime files with their types and a CSP that allows WebAssembly but never eval', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pf-w-'));
    mkdirSync(join(root, 'public', 'assets'), { recursive: true });
    for (const f of ['rive.wasm', 'panda.riv', 'shojumaru.ttf']) writeFileSync(join(root, 'public', 'assets', f), Buffer.from([0, 97, 115, 109]));
    const { buildServer } = await import('../../web-server');
    const app = buildServer({ dbPath: join(root, 'p.db'), staticDir: join(root, 'public') });
    const get = (f: string) => app.inject({ method: 'GET', url: `/assets/${f}` });
    const wasm = await get('rive.wasm');
    expect(wasm.statusCode).toBe(200);
    expect(wasm.headers['content-type']).toBe('application/wasm');
    expect((await get('panda.riv')).headers['content-type']).toBe('application/octet-stream');
    expect((await get('shojumaru.ttf')).headers['content-type']).toBe('font/ttf');
    const csp = String(wasm.headers['content-security-policy']);
    expect(csp).toMatch(/script-src 'self' 'wasm-unsafe-eval'(;|$)/);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("default-src 'self'");
  });

  it('HEAD works for a logged-in user', async () => {
    const { app } = await setup();
    const a = (await login(app, 'anna', PW_A)).cookie!;
    const r = await app.inject({ method: 'HEAD', url: '/me', headers: { cookie: a } });
    expect(r.statusCode).toBe(200); expect(r.body).toBe('');
  });
});
