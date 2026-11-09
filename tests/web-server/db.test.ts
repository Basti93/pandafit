import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS, openDb } from '../../web-server/db';

const tmpPath = () => join(mkdtempSync(join(tmpdir(), 'pf-db-')), 'test.db');
const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tables = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const ALL_TABLES = ['accounts', 'devices', 'login_attempts', 'meta', 'overwritten', 'push_meal_weeks', 'push_run_weeks', 'push_subs', 'records', 'sessions'];

// The schema as the first commit created it (no meta, push, deleted/stale columns).
const OLDEST = `
  CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL);
  CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires_ms INTEGER NOT NULL);
  CREATE TABLE devices (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, revoked INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE records (account_id INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, updated_ms REAL NOT NULL, deleted INTEGER NOT NULL, body TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (account_id, kind, id));
  CREATE INDEX records_seq ON records (account_id, seq);
  CREATE TABLE overwritten (n INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, updated_ms REAL NOT NULL, body TEXT NOT NULL, at_ms INTEGER NOT NULL);
  CREATE TABLE login_attempts (at_ms INTEGER NOT NULL, ip TEXT NOT NULL, account_key TEXT NOT NULL);
  INSERT INTO accounts (name, salt, hash) VALUES ('anna', 's', 'h');
  INSERT INTO records VALUES (1, 'mealplan', 'week-2026-11-02', 1, 0, '{}', 1);
  INSERT INTO records VALUES (1, 'mealplan', 'week-2026-10-26', 1, 1, '{}', 2);
  INSERT INTO records VALUES (1, 'run', 'week-2026-11-02', 1, 0, '{"announce":1}', 3);
  INSERT INTO records VALUES (1, 'run', 'week-2026-10-26', 1, 0, '{"announce":0}', 4);
  INSERT INTO overwritten (account_id, kind, id, updated_ms, body, at_ms) VALUES (1, 'workout', 'a', 1, '{"old":1}', 5);`;

const make = (sql: string) => { const p = tmpPath(); const d = new DatabaseSync(p); d.exec(sql); d.close(); return p; };
const count = (db: DatabaseSync, t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;

describe('migrations', () => {
  it('a fresh database gets all tables and the current version', () => {
    const db = openDb(':memory:');
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(ALL_TABLES);
  });

  it('the oldest schema keeps its data, gains columns and tables, and is lifted to version 1', () => {
    const p = make(OLDEST);
    const db = openDb(p);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(ALL_TABLES);
    expect(count(db, 'records')).toBe(4);
    expect(db.prepare('SELECT body, deleted, stale FROM overwritten').all()).toEqual([{ body: '{"old":1}', deleted: 0, stale: 0 }]);
    // weeks stored before notifications existed count as announced
    expect(db.prepare('SELECT week FROM push_meal_weeks').all()).toEqual([{ week: '2026-11-02' }]);
    expect(db.prepare('SELECT week FROM push_run_weeks').all()).toEqual([{ week: '2026-11-02' }]);
    db.close();
  });

  it('a database with push tables but without meal_weeks seeds only the missing table', () => {
    const p = make(`${OLDEST.replace(/CREATE TABLE overwritten[^;]*;/, `CREATE TABLE overwritten (n INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, updated_ms REAL NOT NULL, body TEXT NOT NULL, at_ms INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, stale INTEGER NOT NULL DEFAULT 0);`)}
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE push_subs (endpoint TEXT PRIMARY KEY, account_id INTEGER NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, session_hash TEXT, device_id INTEGER, created_ms INTEGER NOT NULL);
      CREATE TABLE push_run_weeks (account_id INTEGER NOT NULL, week TEXT NOT NULL, PRIMARY KEY (account_id, week));
      INSERT INTO push_subs VALUES ('e', 1, 'p', 'a', NULL, NULL, 1);`);
    const db = openDb(p);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT week FROM push_meal_weeks').all()).toEqual([{ week: '2026-11-02' }]);
    expect(count(db, 'push_run_weeks')).toBe(0); // existed already: not seeded again
    expect(count(db, 'push_subs')).toBe(1);
    db.close();
  });

  it('opening twice is idempotent and keeps the generation and the data', () => {
    const p = make(OLDEST);
    const a = openDb(p);
    const gen = (a.prepare("SELECT value FROM meta WHERE key = 'generation'").get() as { value: string }).value;
    a.close();
    const b = openDb(p);
    expect(version(b)).toBe(MIGRATIONS.length);
    expect(b.prepare("SELECT value FROM meta WHERE key = 'generation'").get()).toEqual({ value: gen });
    expect(count(b, 'records')).toBe(4);
    b.close();
  });

  it('a failing migration rolls back completely and keeps the earlier version', () => {
    const db = new DatabaseSync(':memory:');
    const steps = [
      (d: DatabaseSync) => d.exec('CREATE TABLE a (x INTEGER)'),
      (d: DatabaseSync) => { d.exec('CREATE TABLE b (x INTEGER)'); throw new Error('boom'); },
    ];
    expect(() => migrate(db, steps)).toThrow('boom');
    expect(version(db)).toBe(1);
    expect(tables(db)).toEqual(['a']);
  });
});
