import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ruleNumber, ruleValues } from '../../shared/training-policy';
import type { Slot } from '../../shared/meals';
import { importRecipe, norm, sanitizeUrl, type Structure, type StoredRecipe } from './recipe-import';

/**
 * The recipe collection: `<root>/recipes/recipes.db` (node:sqlite), the `inbox/` an outside fetcher fills with JSONL files,
 * and `inbox/done/` and `inbox/failed/` for what was taken. The data lives only in the coach volume, never in git.
 * A recipe is stored once per scope: the collection is one scope, each person's link recipes another.
 */

export const collectionUnlock = (): number => ruleNumber('meals.collection-unlock');
const limits = () => ruleValues('meals.import-limits');

export type AddOutcome =
  | { status: 'saved'; recipe: StoredRecipe }
  | { status: 'duplicate'; recipe: StoredRecipe }
  | { status: 'rejected'; reason: string }
  | { status: 'pending'; reason: string }
  | { status: 'failed'; reason: string };

export type RecipeStats = { collection: number; links: number; pending: number; rejected: number; failed: number; duplicates: number; unlock: number };
export type ScanResult = { files: number; imported: number; rejected: number; failed: number; duplicates: number; pending: number };

type Row = { json: string };

const fingerprint = (title: string, ingredients: { name: string }[]): string =>
  crypto.createHash('sha1').update(`${norm(title)}|${[...new Set(ingredients.map((i) => norm(i.name)))].sort().join(',')}`).digest('hex').slice(0, 20);
const scopeOf = (source: 'collection' | 'link', owner: string | undefined): string => (source === 'collection' ? 'c' : `l:${owner ?? ''}`);
const idOf = (scope: string, url: string): string => `${scope[0]}-${crypto.createHash('sha1').update(`${scope}|${url}`).digest('hex').slice(0, 14)}`;
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class RecipeStore {
  private db: DatabaseSync | null = null;
  constructor(private readonly dir: string, private readonly nowMs: () => number = () => Date.now()) {}

  private open(): DatabaseSync {
    if (this.db) return this.db;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path.join(this.dir, 'recipes.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, url TEXT NOT NULL, fp TEXT, source TEXT NOT NULL, owner TEXT, state TEXT NOT NULL,
        title TEXT NOT NULL, slots TEXT NOT NULL, rating REAL, rating_n INTEGER, imported_ms INTEGER NOT NULL, json TEXT NOT NULL, raw TEXT,
        UNIQUE (scope, url), UNIQUE (scope, fp)
      );
      CREATE INDEX IF NOT EXISTS recipes_state ON recipes (state, source);
      CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS progress (file TEXT PRIMARY KEY, done INTEGER NOT NULL);
    `);
    this.db = db;
    return db;
  }
  close(): void { try { this.db?.close(); } catch { /* closed */ } this.db = null; }

  private bump(key: string, by = 1): void {
    this.open().prepare('INSERT INTO counters (key, n) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET n = n + excluded.n').run(key, by);
  }
  private counter(key: string): number {
    const r = this.open().prepare('SELECT n FROM counters WHERE key = ?').get(key) as { n: number } | undefined;
    return r?.n ?? 0;
  }

  /** Imports one schema.org Recipe object for a scope. Rejected and failed ones are only counted; a pending one is kept to be tried again. */
  async add(input: { source: 'collection' | 'link'; owner?: string; url: string; recipe: unknown; ask?: Structure }): Promise<AddOutcome> {
    const url = sanitizeUrl(input.url);
    if (!url) { this.bump('failed'); return { status: 'failed', reason: 'bad url' }; }
    const scope = scopeOf(input.source, input.owner);
    const known = this.byUrl(scope, url);
    if (known) { this.bump('duplicates'); return { status: 'duplicate', recipe: known }; }
    const r = await importRecipe(input.recipe, input.ask ? { ask: input.ask } : {});
    if (r.status === 'rejected') { this.bump('rejected'); return r; }
    if (r.status === 'failed') { this.bump('failed'); return r; }
    const now = this.nowMs();
    const id = idOf(scope, url);
    if (r.status === 'pending') {
      try {
        this.open().prepare('INSERT INTO recipes (id, scope, url, fp, source, owner, state, title, slots, rating, rating_n, imported_ms, json, raw) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)')
          .run(id, scope, url, input.source, input.owner ?? null, 'pending', '', '', now, '{}', JSON.stringify(input.recipe));
      } catch { this.bump('duplicates'); return { status: 'duplicate', recipe: this.byUrl(scope, url) ?? ({} as StoredRecipe) }; }
      this.bump('pendingSeen');
      return r;
    }
    const stored: StoredRecipe = { ...r.recipe, id, source: input.source, sourceUrl: url, importedAtMs: now, ...(input.owner ? { owner: input.owner } : {}) };
    const dup = this.findByFingerprint(scope, fingerprint(stored.title, stored.ingredients));
    if (dup) { this.bump('duplicates'); return { status: 'duplicate', recipe: dup }; }
    try { this.insertOk(stored, scope, input.recipe); } catch { this.bump('duplicates'); return { status: 'duplicate', recipe: this.byUrl(scope, url) ?? stored }; }
    this.bump('imported');
    return { status: 'saved', recipe: stored };
  }

  private insertOk(r: StoredRecipe, scope: string, _raw: unknown): void {
    this.open().prepare('INSERT INTO recipes (id, scope, url, fp, source, owner, state, title, slots, rating, rating_n, imported_ms, json, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .run(r.id, scope, r.sourceUrl, fingerprint(r.title, r.ingredients), r.source, r.owner ?? null, 'ok', r.title, r.slots.join(','), r.rating?.value ?? null, r.rating?.count ?? null, r.importedAtMs, JSON.stringify(r));
  }
  private parse(row: Row | undefined): StoredRecipe | null {
    if (!row) return null;
    try { return JSON.parse(row.json) as StoredRecipe; } catch { return null; }
  }
  private byUrl(scope: string, url: string): StoredRecipe | null {
    return this.parse(this.open().prepare("SELECT json FROM recipes WHERE scope = ? AND url = ? AND state = 'ok'").get(scope, url) as Row | undefined);
  }
  private findByFingerprint(scope: string, fp: string): StoredRecipe | null {
    return this.parse(this.open().prepare('SELECT json FROM recipes WHERE scope = ? AND fp = ?').get(scope, fp) as Row | undefined);
  }

  /** Link recipes of one person, newest first. */
  mine(owner: string): StoredRecipe[] {
    return (this.open().prepare("SELECT json FROM recipes WHERE source = 'link' AND owner = ? AND state = 'ok' ORDER BY imported_ms DESC").all(owner) as Row[]).flatMap((r) => this.parse(r) ?? []);
  }
  /** Every person's link recipes: all of them are candidates for the household's plan. */
  links(): StoredRecipe[] {
    return (this.open().prepare("SELECT json FROM recipes WHERE source = 'link' AND state = 'ok' ORDER BY imported_ms DESC").all() as Row[]).flatMap((r) => this.parse(r) ?? []);
  }
  /** A person deletes their own link recipe. True when one was removed. */
  remove(owner: string, id: string): boolean {
    const r = this.open().prepare("DELETE FROM recipes WHERE id = ? AND source = 'link' AND owner = ?").run(id, owner);
    return Number(r.changes) > 0;
  }
  get(id: string): StoredRecipe | null {
    return this.parse(this.open().prepare("SELECT json FROM recipes WHERE id = ? AND state = 'ok'").get(id) as Row | undefined);
  }
  /** Collection recipes for a meal, best rated first (the tie-breaker of the shortlist); recipes without a meal slot are not usable. */
  collectionFor(slot: Slot): StoredRecipe[] {
    return (this.open().prepare("SELECT json FROM recipes WHERE source = 'collection' AND state = 'ok' AND (',' || slots || ',') LIKE ? ORDER BY COALESCE(rating, 0) DESC, COALESCE(rating_n, 0) DESC, id").all(`%,${slot},%`) as Row[]).flatMap((r) => this.parse(r) ?? []);
  }

  /** Collection recipes that can be a meal (not counting link imports). */
  collectionCount(): number {
    return Number((this.open().prepare("SELECT COUNT(*) AS n FROM recipes WHERE source = 'collection' AND state = 'ok' AND slots != ''").get() as { n: number }).n);
  }
  stats(): RecipeStats {
    const o = this.open();
    const links = Number((o.prepare("SELECT COUNT(*) AS n FROM recipes WHERE source = 'link' AND state = 'ok'").get() as { n: number }).n);
    const pending = Number((o.prepare("SELECT COUNT(*) AS n FROM recipes WHERE state = 'pending'").get() as { n: number }).n);
    return { collection: this.collectionCount(), links, pending, rejected: this.counter('rejected'), failed: this.counter('failed'), duplicates: this.counter('duplicates'), unlock: collectionUnlock() };
  }
  /** Whether the collection may be planned from. */
  unlocked(): boolean { return this.collectionCount() >= collectionUnlock(); }

  /** Link imports today (UTC day) by the household; `tookOne` counts one more. */
  linksToday(): number { return this.counter(`links-${dayKey(this.nowMs())}`); }
  countLink(): void { this.bump(`links-${dayKey(this.nowMs())}`); }

  /** Pending recipes get another go, at most `max`. */
  async retryPending(ask: Structure | undefined, max: number): Promise<number> {
    if (!ask || max <= 0) return 0;
    const rows = this.open().prepare("SELECT id, scope, url, source, owner, raw FROM recipes WHERE state = 'pending' ORDER BY imported_ms LIMIT ?").all(max) as { id: string; scope: string; url: string; source: 'collection' | 'link'; owner: string | null; raw: string }[];
    let done = 0;
    for (const row of rows) {
      let raw: unknown;
      try { raw = JSON.parse(row.raw); } catch { this.open().prepare('DELETE FROM recipes WHERE id = ?').run(row.id); continue; }
      const r = await importRecipe(raw, { ask });
      if (r.status === 'pending') continue;
      this.open().prepare('DELETE FROM recipes WHERE id = ?').run(row.id);
      done++;
      if (r.status === 'rejected') { this.bump('rejected'); continue; }
      if (r.status === 'failed') { this.bump('failed'); continue; }
      const stored: StoredRecipe = { ...r.recipe, id: row.id, source: row.source, sourceUrl: row.url, importedAtMs: this.nowMs(), ...(row.owner ? { owner: row.owner } : {}) };
      try { this.insertOk(stored, row.scope, raw); this.bump('imported'); } catch { this.bump('duplicates'); }
    }
    return done;
  }

  // ---- The inbox ----

  inboxDir(): string { return path.join(this.dir, 'inbox'); }

  /**
   * Imports waiting inbox files, line by line, at most `perScan` recipes in all (the rest next time; a file stays in `inbox/` until every line
   * is done, its progress kept in the database, so no line is imported twice). A finished file moves to `inbox/done/` with a small result
   * file next to it; one with no usable line, or one that cannot be read, moves to `inbox/failed/` with the reason. Never with a ride open.
   * Only `*.jsonl` files count: the fetcher writes under another name and renames it when complete.
   */
  async scanInbox(o: { noOpenRide: () => boolean; ask?: Structure }): Promise<ScanResult> {
    const total: ScanResult = { files: 0, imported: 0, rejected: 0, failed: 0, duplicates: 0, pending: 0 };
    if (!o.noOpenRide()) return total;
    const inbox = this.inboxDir();
    let names: string[] = [];
    try { names = fs.readdirSync(inbox).filter((n) => /^\w[\w.-]*\.jsonl$/.test(n)).sort(); } catch { /* no inbox yet */ }
    if (names.length === 0 && this.counter('pendingSeen') === 0) return total;
    const L = limits();
    let budget = L.perScan!;
    let ai = L.aiPerScan!;
    const askLimited: Structure | undefined = o.ask ? async (i) => { if (ai <= 0) throw new Error('ai budget'); ai--; return o.ask!(i); } : undefined;
    for (const name of names) {
      if (budget <= 0 || !o.noOpenRide()) break;
      const file = path.join(inbox, name);
      const result = { imported: 0, rejected: 0, failed: 0, duplicates: 0, pending: 0 };
      let lines: string[];
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > 256_000_000) throw new Error('file too large');
        lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
      } catch (e) { this.moveFile(name, 'failed', `unreadable: ${e instanceof Error ? e.message : 'error'}`); total.failed++; continue; }
      const start = (this.open().prepare('SELECT done FROM progress WHERE file = ?').get(name) as { done: number } | undefined)?.done ?? 0;
      let i = start;
      for (; i < lines.length && budget > 0; i++) {
        if (!o.noOpenRide()) break;
        budget--;
        const line = lines[i]!;
        let obj: unknown;
        try { if (line.length > L.maxLineBytes!) throw new Error('line too long'); obj = JSON.parse(line); } catch { result.failed++; this.bump('failed'); continue; }
        const rec = typeof obj === 'object' && obj !== null && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
        const url = rec && typeof rec.url === 'string' ? rec.url : rec && typeof rec['@id'] === 'string' ? rec['@id'] : '';
        if (!rec || !url) { result.failed++; this.bump('failed'); continue; }
        let out: AddOutcome;
        try { out = await this.add({ source: 'collection', url, recipe: rec, ...(askLimited ? { ask: askLimited } : {}) }); } catch { result.failed++; this.bump('failed'); continue; }
        if (out.status === 'saved') result.imported++;
        else if (out.status === 'duplicate') result.duplicates++;
        else if (out.status === 'rejected') result.rejected++;
        else if (out.status === 'pending') result.pending++;
        else result.failed++;
      }
      this.open().prepare('INSERT INTO progress (file, done) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET done = excluded.done').run(name, i);
      for (const k of Object.keys(result) as (keyof typeof result)[]) total[k] += result[k];
      if (i >= lines.length) {
        const usable = result.imported + result.rejected + result.duplicates + result.pending > 0 || start > 0;
        if (usable) this.moveFile(name, 'done', JSON.stringify({ lines: lines.length, ...result, atMs: this.nowMs() }));
        else this.moveFile(name, 'failed', 'no usable line');
        this.open().prepare('DELETE FROM progress WHERE file = ?').run(name);
        total.files++;
      }
    }
    // Recipes that waited for the AI get another try with what is left of its budget.
    if (budget > 0 && askLimited && o.noOpenRide()) total.imported += await this.retryPending(askLimited, Math.min(budget, ai));
    return total;
  }

  /** Moves an inbox file to `done/` or `failed/`; the note goes next to it as `<name>.result.json` or `<name>.reason.txt`. */
  private moveFile(name: string, to: 'done' | 'failed', note: string): void {
    const target = path.join(this.inboxDir(), to);
    fs.mkdirSync(target, { recursive: true });
    const from = path.join(this.inboxDir(), name);
    let dest = path.join(target, name);
    if (fs.existsSync(dest)) dest = path.join(target, `${Date.now()}-${name}`);
    try { fs.renameSync(from, dest); } catch { return; }
    try { fs.writeFileSync(`${dest}.${to === 'done' ? 'result.json' : 'reason.txt'}`, note); } catch { /* the move is what counts */ }
  }
}
