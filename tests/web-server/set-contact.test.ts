import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAccount } from '../../web-server/auth';
import { openDb } from '../../web-server/db';
import { run } from '../../web-server/cli';
import { contactOf, contactRecord } from '../../src/shared/contact';
import { putRecords } from '../../web-server/records';

async function fresh() {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'pf-')), 'test.db');
  const db = openDb(dbPath);
  await createAccount(db, 'anna', 'correct horse a1');
  db.close();
  const out: string[] = [];
  const cli = (...args: string[]) => run(['set-contact', ...args], dbPath, { readPassword: async () => '', out: (s) => out.push(s) });
  const stored = () => {
    const d = new DatabaseSync(dbPath);
    const r = d.prepare("SELECT updated_ms, deleted, body FROM records WHERE kind = 'contact' AND id = 'contact'").get() as { updated_ms: number; deleted: number; body: string } | undefined;
    d.close();
    return r ? { updatedMs: r.updated_ms, body: JSON.parse(r.body) as Record<string, unknown> } : undefined;
  };
  return { dbPath, out, cli, stored };
}

describe('set-updates', () => {
  it('writes updates, keeps email and weekly, and refuses bad input', async () => {
    const { dbPath, cli, stored, out } = await fresh();
    const upd = (...a: string[]) => run(['set-updates', ...a], dbPath, { readPassword: async () => '', out: (s) => out.push(s) });
    expect(await upd('anna', 'off')).toBe(0);
    expect(stored()?.body).toMatchObject({ email: null, weekly: false, updates: false });
    await cli('anna', 'a@example.org', 'weekly', 'on');
    expect(stored()?.body).toMatchObject({ email: 'a@example.org', weekly: true, updates: false });
    const before = stored()!.updatedMs;
    expect(await upd('anna', 'on')).toBe(0);
    expect(stored()?.body).toMatchObject({ email: 'a@example.org', weekly: true, updates: true });
    expect(stored()!.updatedMs).toBeGreaterThan(before);
    expect(await upd('anna', 'maybe')).toBe(1);
    expect(await upd('nobody', 'off')).toBe(1);
    expect(await upd('anna')).toBe(1);
  });
});

describe('set-contact', () => {
  it('writes the contact record, with the switch off unless asked', async () => {
    const { cli, stored, out } = await fresh();
    expect(await cli('anna', 'a@example.org')).toBe(0);
    expect(stored()?.body).toMatchObject({ email: 'a@example.org', weekly: false });
    expect(await cli('anna', 'a@example.org', 'weekly', 'on')).toBe(0);
    expect(stored()?.body).toMatchObject({ email: 'a@example.org', weekly: true });
    // A new address keeps the switch as it was.
    expect(await cli('anna', 'b@example.org')).toBe(0);
    expect(stored()?.body).toMatchObject({ email: 'b@example.org', weekly: true });
    expect(out.join('\n')).not.toContain('example.org');
  });

  it('is stamped above the stored record, also one from the future', async () => {
    const { dbPath, cli, stored } = await fresh();
    const db = openDb(dbPath);
    const ahead = Date.now() + 3600_000;
    putRecords(db, 1, [contactRecord({ email: 'old@example.org', weekly: true }, ahead)], Date.now());
    db.close();
    expect(await cli('anna', 'new@example.org')).toBe(0);
    expect(stored()!.updatedMs).toBeGreaterThan(ahead);
    expect(stored()!.body).toMatchObject({ email: 'new@example.org' });
  });

  it('"-" removes the address and the switch', async () => {
    const { cli, stored } = await fresh();
    await cli('anna', 'a@example.org', 'weekly', 'on');
    expect(await cli('anna', '-')).toBe(0);
    expect(contactOf([{ kind: 'contact', id: 'contact', updatedMs: 1, deleted: false, body: stored()!.body }])).toEqual({ email: null, weekly: false });
  });

  it('refuses a bad address, an unknown account and bad words, and writes nothing', async () => {
    const { cli, stored, out } = await fresh();
    expect(await cli('anna', 'kein-mail')).toBe(1);
    expect(await cli('nobody', 'a@example.org')).toBe(1);
    expect(await cli('anna', 'a@example.org', 'weekly', 'maybe')).toBe(1);
    expect(await cli('anna')).toBe(1);
    expect(stored()).toBeUndefined();
    expect(out.every((l) => l.startsWith('error:'))).toBe(true);
  });
});
