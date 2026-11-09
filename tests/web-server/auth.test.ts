import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { clientIp, createAccount, isLimited, listDevices, recordAttempt, revokeDevice } from '../../web-server/auth';
import { run } from '../../web-server/cli';
import { openDb } from '../../web-server/db';
import { login, NOW, PW_A, PW_B, setup } from './helpers';

// Logins hash passwords slowly on purpose; on a loaded machine the 5 s default is too short.
vi.setConfig({ testTimeout: 30_000 });

describe('auth', () => {
  it('passwords are stored with scrypt, never in plain text', async () => {
    const { dbPath } = await setup();
    const db = openDb(dbPath);
    const rows = db.prepare('SELECT * FROM accounts').all() as { salt: string; hash: string }[];
    expect(JSON.stringify(rows)).not.toContain(PW_A);
    expect(rows[0]!.hash).toMatch(/^[0-9a-f]{128}$/);
    expect(rows[0]!.salt).not.toBe(rows[1]!.salt);
    await expect(createAccount(db, 'short', '123456789')).rejects.toThrow(/10/);
  });

  it('a third account cannot be created without the command', async () => {
    const { dbPath } = await setup();
    const db = openDb(dbPath);
    await expect(createAccount(db, 'cara', 'long enough pw')).rejects.toThrow(/--force/);
    await createAccount(db, 'cara', 'long enough pw', { force: true });
    db.close();
    const out: string[] = [];
    const io = { readPassword: async () => 'long enough pw 2', out: (s: string) => out.push(s) };
    expect(await run(['create-account', '--name', 'dora'], dbPath, io)).toBe(1);
    expect(await run(['create-account', '--name', 'dora', '--force'], dbPath, io)).toBe(0);
  });

  it('the cookie is HttpOnly, Secure and SameSite=Strict and lasts 90 days, renewed on use', async () => {
    const { app, clock } = await setup();
    const { res, cookie } = await login(app, 'anna', PW_A);
    const sc = String(res.headers['set-cookie']);
    expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/Secure/); expect(sc).toMatch(/SameSite=Strict/);
    expect(sc).toContain(`Max-Age=${90 * 24 * 3600}`);
    clock.now = NOW + 80 * 24 * 3600 * 1000;
    expect((await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookie! } })).statusCode).toBe(200);
    clock.now = NOW + 160 * 24 * 3600 * 1000; // 80 days after renewal
    expect((await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookie! } })).statusCode).toBe(200);
    clock.now = NOW + 300 * 24 * 3600 * 1000;
    expect((await app.inject({ method: 'GET', url: '/me', headers: { cookie: cookie! } })).statusCode).toBe(401);
  });

  it('10 failed logins per IP within 15 minutes are refused for 15 minutes, with the same answer for an unknown name', async () => {
    const { app, clock } = await setup();
    const bad = (name: string, ip: string) => app.inject({ method: 'POST', url: '/login', payload: { name, password: 'wrong password' }, remoteAddress: ip });
    const a = await bad('anna', '10.0.0.1'), u = await bad('nobody', '10.0.0.2');
    expect(a.statusCode).toBe(401); expect(u.statusCode).toBe(401);
    expect(a.body).toBe(u.body);
    // 10 failures from one IP lock that IP, the same account stays open from another IP
    for (let i = 0; i < 10; i++) await bad('anna', '10.0.1.1');
    expect((await bad('anna', '10.0.1.1')).statusCode).toBe(429);
    expect((await login(app, 'anna', PW_A, '10.0.1.1')).res.statusCode).toBe(429);
    expect((await login(app, 'anna', PW_A, '10.0.2.2')).res.statusCode).toBe(200);
    clock.now += 15 * 60 * 1000 + 1;
    expect((await login(app, 'anna', PW_A, '10.0.1.1')).res.statusCode).toBe(200);
    // per IP, over many names
    for (let i = 0; i < 10; i++) await bad(`ghost${i}`, '10.9.9.9');
    expect((await bad('ghost99', '10.9.9.9')).statusCode).toBe(429);
    expect((await bad('ghost99', '10.9.9.8')).statusCode).toBe(401);
  });

  it('100 failed logins per account within 15 minutes lock the account across IPs', () => {
    const db = openDb(':memory:');
    for (let i = 0; i < 99; i++) recordAttempt(db, NOW, `10.1.${i % 250}.${Math.floor(i / 250)}`, 'anna');
    expect(isLimited(db, NOW, '10.9.9.9', 'anna')).toBe(false);
    recordAttempt(db, NOW, '10.8.8.8', 'anna');
    expect(isLimited(db, NOW, '10.9.9.9', 'anna')).toBe(true);
    expect(isLimited(db, NOW, '10.9.9.9', 'ben')).toBe(false);
  });

  it('the limit survives a restart', async () => {
    const { app, dbPath, clock } = await setup();
    for (let i = 0; i < 10; i++) await app.inject({ method: 'POST', url: '/login', payload: { name: 'anna', password: 'wrong password' } });
    await app.close();
    const { buildServer } = await import('../../web-server');
    const again = buildServer({ dbPath, nowMs: () => clock.now });
    expect((await login(again, 'anna', PW_A)).res.statusCode).toBe(429);
  });

  it('X-Forwarded-For is trusted only from the proxy network', async () => {
    expect(clientIp('172.18.0.2', '203.0.113.5', '172.18.0.0/16')).toBe('203.0.113.5');
    expect(clientIp('172.18.0.2', '1.1.1.1, 203.0.113.5', '172.18.0.0/16')).toBe('203.0.113.5');
    expect(clientIp('198.51.100.7', '203.0.113.5', '172.18.0.0/16')).toBe('198.51.100.7');
    expect(clientIp('172.18.0.2', '203.0.113.5')).toBe('172.18.0.2');
    // end to end: spoofed header from outside does not dodge the limit
    const { app } = await setup({ trustProxyCidr: '172.18.0.0/16' });
    const bad = (ip: string, xff: string) => app.inject({ method: 'POST', url: '/login', payload: { name: 'g' + Math.random(), password: 'wrong password' }, remoteAddress: ip, headers: { 'x-forwarded-for': xff } });
    for (let i = 0; i < 10; i++) await bad('198.51.100.7', `9.9.9.${i}`);
    expect((await bad('198.51.100.7', '9.9.9.200')).statusCode).toBe(429);
    for (let i = 0; i < 10; i++) await bad('172.18.0.2', '203.0.113.5');
    expect((await bad('172.18.0.2', '203.0.113.5')).statusCode).toBe(429);
    expect((await bad('172.18.0.2', '203.0.113.6')).statusCode).toBe(401);
  });

  it('a revoked token no longer works and tokens are stored hashed', async () => {
    const { app, dbPath } = await setup();
    const res = await app.inject({ method: 'POST', url: '/device-token', payload: { name: 'anna', password: PW_A, deviceName: 'mac' } });
    const { token, deviceId } = res.json() as { token: string; deviceId: number };
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'GET', url: '/me', headers: h })).json()).toEqual({ name: 'anna' });
    const { cookie } = await login(app, 'anna', PW_A);
    const db = openDb(dbPath);
    const dump = JSON.stringify([db.prepare('SELECT * FROM devices').all(), db.prepare('SELECT * FROM sessions').all()]);
    expect(dump).not.toContain(token); expect(dump).not.toContain(cookie!.split('=')[1]);
    expect(listDevices(db)).toHaveLength(1);
    expect(revokeDevice(db, deviceId)).toBe(true);
    db.close();
    expect((await app.inject({ method: 'GET', url: '/me', headers: h })).statusCode).toBe(401);
  });
});
