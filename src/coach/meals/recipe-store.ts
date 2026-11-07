import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ruleNumber, ruleValues } from '../../shared/training-policy';
import { importRecipe, norm, PROTEIN_UNKNOWN, sanitizeUrl, type Structure, type StoredRecipe } from './recipe-import';
import { searchRecipes, type SearchQuery } from './recipe-search';
import { allTags, classify, deriveVersion, hardTags, mergeTags, parseQualityMin, slotsFrom, tagAi, tagInputHash, tagInputOf, tagLabels, tagPromptVersion, vocabulary, FACETS, type AiTags, type TagAsk } from './recipe-tags';

/**
 * The recipe collection: `<root>/recipes/recipes.db` (node:sqlite), the `inbox/` an outside fetcher fills with JSONL files,
 * and `inbox/done/` and `inbox/failed/` for what was taken. The data lives only in the coach volume, never in git.
 * A recipe is stored once per scope: the collection is one scope, each person's link recipes another.
 *
 * States: `ok` (normalised and tagged: findable and plannable), `pending-tags` (normalised, waiting for the AI's classification: stored,
 * never planned), `pending` (too many unclear ingredient lines and no AI yet: only the source is kept). The original schema.org
 * object is kept for every recipe, so everything derived can be computed again (`deriveVersion`).
 */

export const collectionUnlock = (): number => ruleNumber('meals.collection-unlock');
const limits = () => ruleValues('meals.import-limits');

export type AddOutcome =
  | { status: 'saved'; recipe: StoredRecipe }
  | { status: 'duplicate'; recipe: StoredRecipe }
  | { status: 'forgotten' }
  | { status: 'rejected'; reason: string }
  | { status: 'pending'; reason: string }
  | { status: 'failed'; reason: string };

export type RecipeStats = { collection: number; links: number; pending: number; untagged: number; rejected: number; failed: number; duplicates: number; unlock: number };
export type ScanResult = { files: number; imported: number; rejected: number; failed: number; duplicates: number; pending: number; tagged: number };

type Row = { json: string };
type Ask = Structure & TagAsk;

const fingerprint = (title: string, ingredients: { name: string }[]): string =>
  crypto.createHash('sha1').update(`${norm(title)}|${[...new Set(ingredients.map((i) => norm(i.name)))].sort().join(',')}`).digest('hex').slice(0, 20);
/** The owner of own recipes delivered through the inbox: they belong to the household, so every person sees and may delete them. */
export const OWN_OWNER = '~own';
const scopeOf = (source: 'collection' | 'link', owner: string | undefined): string => (source === 'collection' ? 'c' : `l:${owner ?? ''}`);
const idOf = (scope: string, url: string): string => `${scope[0]}-${crypto.createHash('sha1').update(`${scope}|${url}`).digest('hex').slice(0, 14)}`;
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** The key a stored classification was made under: the prompt version and the vocabulary. A different key means: classify again. */
const currentTagKey = (): string => `${tagPromptVersion()}.${crypto.createHash('sha1').update(JSON.stringify(FACETS.map((f) => vocabulary()[f].map((e) => e.id)))).digest('hex').slice(0, 8)}`;

export type StoreOptions = { /** For tests: pretend the code derives with another version. */ deriveVersion?: number };

export class RecipeStore {
  private db: DatabaseSync | null = null;
  constructor(private readonly dir: string, private readonly nowMs: () => number = () => Date.now(), private readonly opts: StoreOptions = {}) {}

  private version(): number { return this.opts.deriveVersion ?? deriveVersion(); }

  /** The database, for the search function. */
  database(): DatabaseSync { return this.open(); }
  private open(): DatabaseSync {
    if (this.db) return this.db;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path.join(this.dir, 'recipes.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, url TEXT NOT NULL, fp TEXT, source TEXT NOT NULL, owner TEXT, state TEXT NOT NULL,
        title TEXT NOT NULL, rating REAL, rating_n INTEGER, imported_ms INTEGER NOT NULL, minutes INTEGER, protein INTEGER, vegan INTEGER,
        quality REAL, flagged INTEGER NOT NULL DEFAULT 0, derive_version INTEGER NOT NULL DEFAULT 0,
        tag_key TEXT, tag_hash TEXT, tag_tries INTEGER NOT NULL DEFAULT 0, tag_next_ms INTEGER NOT NULL DEFAULT 0, ai_json TEXT,
        json TEXT NOT NULL, raw TEXT,
        UNIQUE (scope, url), UNIQUE (scope, fp)
      );
      CREATE INDEX IF NOT EXISTS recipes_state ON recipes (state, source);
      CREATE TABLE IF NOT EXISTS recipe_tags (recipe_id TEXT NOT NULL, facet TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (recipe_id, facet, tag));
      CREATE INDEX IF NOT EXISTS recipe_tags_tag ON recipe_tags (tag, facet);
      CREATE TABLE IF NOT EXISTS recipe_ingredients (recipe_id TEXT NOT NULL, canon TEXT NOT NULL, PRIMARY KEY (recipe_id, canon));
      CREATE INDEX IF NOT EXISTS recipe_ingredients_canon ON recipe_ingredients (canon);
      CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(title, ingredients, tags, tokenize = 'unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS progress (file TEXT PRIMARY KEY, done INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS forgotten (url TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS vegRejected (url TEXT PRIMARY KEY, prompt_version INTEGER NOT NULL);
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
  private count(sql: string, ...args: (string | number)[]): number { return Number((this.open().prepare(sql).get(...args) as { n: number }).n); }

  // ---- Adding ----

  /**
   * Imports one schema.org Recipe object for a scope. Rejected and failed ones are only counted. With `tagAsk`, a recipe added alone is
   * classified at once (a link recipe works at once); a collection recipe waits for the batch.
   */
  async add(input: { source: 'collection' | 'link'; owner?: string; url: string; recipe: unknown; ask?: Structure; tagAsk?: TagAsk }): Promise<AddOutcome> {
    const url = sanitizeUrl(input.url);
    if (!url) { this.bump('failed'); return { status: 'failed', reason: 'bad url' }; }
    if (input.source === 'link' && input.owner === OWN_OWNER) {
      // An own recipe from the inbox: one the household deleted is not brought back, and one already in the collection becomes own (keeping its tags).
      if (this.open().prepare('SELECT 1 AS x FROM forgotten WHERE url = ?').get(url)) { this.bump('duplicates'); return { status: 'forgotten' }; }
      const upgraded = this.upgradeToOwn(url);
      if (upgraded) { this.bump('duplicates'); return { status: 'duplicate', recipe: upgraded }; }
    }
    // A page the AI judged not vegetarian is not brought back, until the prompt version changes (then it is judged again).
    const vr = this.open().prepare('SELECT prompt_version AS v FROM vegRejected WHERE url = ?').get(url) as { v: number } | undefined;
    if (vr) {
      if (vr.v === tagPromptVersion()) return { status: 'rejected', reason: 'ai: not vegetarian' };
      this.open().prepare('DELETE FROM vegRejected WHERE url = ?').run(url);
    }
    const scope = scopeOf(input.source, input.owner);
    const known = this.byUrl(scope, url);
    if (known) { this.bump('duplicates'); return { status: 'duplicate', recipe: known }; }
    const r = await importRecipe(input.recipe, input.ask ? { ask: input.ask } : {});
    if (r.status === 'rejected') { this.bump('rejected'); return r; }
    if (r.status === 'failed') { this.bump('failed'); return r; }
    const now = this.nowMs();
    const id = idOf(scope, url);
    const raw = JSON.stringify({ url, fetchedAtMs: now, recipe: input.recipe });
    if (r.status === 'pending') {
      try {
        this.open().prepare('INSERT INTO recipes (id, scope, url, fp, source, owner, state, title, imported_ms, flagged, derive_version, json, raw) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
          .run(id, scope, url, input.source, input.owner ?? null, 'pending', '', now, this.version(), '{}', raw);
      } catch { this.bump('duplicates'); return { status: 'duplicate', recipe: this.byUrl(scope, url) ?? ({} as StoredRecipe) }; }
      this.bump('pendingSeen');
      return r;
    }
    const stored: StoredRecipe = { ...r.recipe, id, source: input.source, sourceUrl: url, importedAtMs: now, ...(input.owner ? { owner: input.owner } : {}), deriveVersion: this.version() };
    const dup = this.findByFingerprint(scope, fingerprint(stored.title, stored.ingredients));
    if (dup) { this.bump('duplicates'); return { status: 'duplicate', recipe: dup }; }
    try { this.insertUntagged(stored, scope, raw); } catch { this.bump('duplicates'); return { status: 'duplicate', recipe: this.byUrl(scope, url) ?? stored }; }
    this.bump('imported');
    if (input.tagAsk) await this.tagIds([id], input.tagAsk);
    const now_ = this.any(id);
    if (!now_ && input.tagAsk) return { status: 'rejected', reason: 'ai: not vegetarian' };
    return { status: 'saved', recipe: now_ ?? stored };
  }

  private upgradeToOwn(url: string): StoredRecipe | null {
    const o = this.open();
    const row = o.prepare("SELECT id, json FROM recipes WHERE scope = 'c' AND url = ? AND state != 'pending'").get(url) as { id: string; json: string } | undefined;
    const old = this.parse(row);
    if (!row || !old) return null;
    if (this.byUrl(scopeOf('link', OWN_OWNER), url)) return null;
    const next: StoredRecipe = { ...old, source: 'link', owner: OWN_OWNER };
    try {
      o.prepare('UPDATE recipes SET scope = ?, source = ?, owner = ?, json = ? WHERE id = ?').run(scopeOf('link', OWN_OWNER), 'link', OWN_OWNER, JSON.stringify(next), row.id);
    } catch { return null; }
    return next;
  }

  private columns(r: StoredRecipe): [number, number | null, number, number, number] {
    return [r.minutes, r.proteinG === PROTEIN_UNKNOWN ? null : r.proteinG, r.vegan ? 1 : 0, r.parseQuality, r.parseQuality < parseQualityMin() ? 1 : 0];
  }
  private insertUntagged(r: StoredRecipe, scope: string, raw: string): void {
    const [minutes, protein, vegan, quality, flagged] = this.columns(r);
    this.open().prepare('INSERT INTO recipes (id, scope, url, fp, source, owner, state, title, rating, rating_n, imported_ms, minutes, protein, vegan, quality, flagged, derive_version, json, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.id, scope, r.sourceUrl, fingerprint(r.title, r.ingredients), r.source, r.owner ?? null, 'pending-tags', r.title, r.rating?.value ?? null, r.rating?.count ?? null, r.importedAtMs, minutes, protein, vegan, quality, flagged, r.deriveVersion, JSON.stringify(r), raw);
  }

  private parse(row: Row | undefined): StoredRecipe | null {
    if (!row) return null;
    try { return JSON.parse(row.json) as StoredRecipe; } catch { return null; }
  }
  private byUrl(scope: string, url: string): StoredRecipe | null {
    return this.parse(this.open().prepare("SELECT json FROM recipes WHERE scope = ? AND url = ? AND state != 'pending'").get(scope, url) as Row | undefined);
  }
  private any(id: string): StoredRecipe | null { return this.parse(this.open().prepare("SELECT json FROM recipes WHERE id = ? AND state != 'pending'").get(id) as Row | undefined); }
  private findByFingerprint(scope: string, fp: string): StoredRecipe | null {
    return this.parse(this.open().prepare('SELECT json FROM recipes WHERE scope = ? AND fp = ?').get(scope, fp) as Row | undefined);
  }

  // ---- Reading ----

  /** Link recipes of one person, newest first. */
  mine(owner: string): StoredRecipe[] {
    return (this.open().prepare("SELECT json FROM recipes WHERE source = 'link' AND (owner = ? OR owner = ?) AND state != 'pending' ORDER BY imported_ms DESC").all(owner, OWN_OWNER) as Row[]).flatMap((r) => this.parse(r) ?? []);
  }
  /** Every person's link recipes that can be planned: all of them are candidates for the household's plan. */
  links(): StoredRecipe[] { return this.search({ source: 'link', limit: 5000 }); }
  /** A person deletes their own link recipe. True when one was removed. */
  remove(owner: string, id: string): boolean {
    const own = this.open().prepare("SELECT url, owner FROM recipes WHERE id = ? AND source = 'link' AND (owner = ? OR owner = ?)").get(id, owner, OWN_OWNER) as { url: string; owner: string } | undefined;
    if (!own) return false;
    if (own.owner === OWN_OWNER) this.open().prepare('INSERT OR IGNORE INTO forgotten (url) VALUES (?)').run(own.url);
    this.deleteRow(id);
    return true;
  }
  get(id: string): StoredRecipe | null {
    return this.parse(this.open().prepare("SELECT json FROM recipes WHERE id = ? AND state = 'ok'").get(id) as Row | undefined);
  }
  search(q: SearchQuery): StoredRecipe[] { return searchRecipes(this.open(), q); }

  /** Collection recipes (tagged, plannable) for a meal: a bounded, varied sample, in an order that depends on `seed`. */
  collectionFor(slot: string, limit = 2000, seed = 0): StoredRecipe[] { return this.search({ source: 'collection', tags: [`mahlzeit:${slot}`], limit, order: 'sample', seed }); }

  /** Collection recipes that can be planned (tagged, with a meal slot, not counting link imports). */
  collectionCount(): number { return this.count("SELECT COUNT(*) AS n FROM recipes WHERE source = 'collection' AND state = 'ok' AND flagged = 0"); }
  stats(): RecipeStats {
    return {
      collection: this.collectionCount(), links: this.count("SELECT COUNT(*) AS n FROM recipes WHERE source = 'link' AND state != 'pending'"),
      pending: this.count("SELECT COUNT(*) AS n FROM recipes WHERE state = 'pending'"), untagged: this.count("SELECT COUNT(*) AS n FROM recipes WHERE state = 'pending-tags'"),
      rejected: this.counter('rejected'), failed: this.counter('failed'), duplicates: this.counter('duplicates'), unlock: collectionUnlock(),
    };
  }
  /** Whether the collection may be planned from. */
  unlocked(): boolean { return this.collectionCount() >= collectionUnlock(); }

  /** Link imports today (UTC day) by the household. */
  linksToday(): number { return this.counter(`links-${dayKey(this.nowMs())}`); }
  countLink(): void { this.bump(`links-${dayKey(this.nowMs())}`); }

  private deleteRow(id: string): void {
    const o = this.open();
    const rid = (o.prepare('SELECT rowid AS r FROM recipes WHERE id = ?').get(id) as { r: number } | undefined)?.r;
    if (rid !== undefined) o.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(rid);
    o.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(id);
    o.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(id);
    o.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  }

  // ---- Tagging ----

  private rowsToTag(where: string, args: (string | number)[], limit: number): { id: string; json: StoredRecipe; ai: AiTags | null; hash: string | null; key: string | null; tries: number }[] {
    const rows = this.open().prepare(`SELECT id, json, ai_json, tag_hash, tag_key, tag_tries FROM recipes WHERE ${where} ORDER BY imported_ms, id LIMIT ?`).all(...args, limit) as { id: string; json: string; ai_json: string | null; tag_hash: string | null; tag_key: string | null; tag_tries: number }[];
    return rows.flatMap((r) => {
      const json = this.parse(r);
      let ai: AiTags | null = null;
      try { ai = r.ai_json ? (JSON.parse(r.ai_json) as AiTags) : null; } catch { ai = null; }
      return json ? [{ id: r.id, json, ai, hash: r.tag_hash, key: r.tag_key, tries: r.tag_tries }] : [];
    });
  }

  /** Writes a complete classification: the rules' facts and the AI's, the slots, the tag and ingredient tables and the search index. */
  private finalize(r: StoredRecipe, ai: AiTags, hash: string): void {
    const o = this.open();
    const hard = hardTags({ minutes: r.minutes, proteinG: r.proteinG === PROTEIN_UNKNOWN ? null : r.proteinG, keepsDays: r.keepsDays, vegan: r.vegan, ingredients: r.ingredients });
    const tags = mergeTags(ai, hard);
    const next: StoredRecipe = { ...r, tags, slots: slotsFrom(tags.mahlzeit) };
    // Only the AI's own `true` is a verdict; an old classification without one keeps serving until it is asked again.
    if (ai.vegetarisch === true) { next.vegCheckedBy = 'ai'; next.vegReason = ai.grund; }
    const rid = (o.prepare('SELECT rowid AS r FROM recipes WHERE id = ?').get(r.id) as { r: number } | undefined)?.r;
    if (rid === undefined) return;
    o.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(rid);
    o.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(r.id);
    o.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(r.id);
    for (const t of allTags(tags)) o.prepare('INSERT OR IGNORE INTO recipe_tags (recipe_id, facet, tag) VALUES (?, ?, ?)').run(r.id, t.facet, t.tag);
    for (const c of next.canon) o.prepare('INSERT OR IGNORE INTO recipe_ingredients (recipe_id, canon) VALUES (?, ?)').run(r.id, c);
    o.prepare('INSERT INTO recipes_fts (rowid, title, ingredients, tags) VALUES (?, ?, ?, ?)').run(rid, norm(r.title), next.canon.join(' '), norm(tagLabels(tags).join(' ')));
    o.prepare("UPDATE recipes SET state = 'ok', json = ?, ai_json = ?, tag_hash = ?, tag_key = ?, tag_tries = 0, tag_next_ms = 0 WHERE id = ?").run(JSON.stringify(next), JSON.stringify(ai), hash, currentTagKey(), r.id);
  }

  /** The AI says: not vegetarian. The recipe is removed and counted as rejected, its url remembered for this prompt version. */
  private rejectVeg(id: string): void {
    const o = this.open();
    const row = o.prepare('SELECT url FROM recipes WHERE id = ?').get(id) as { url: string } | undefined;
    if (row) o.prepare('INSERT OR REPLACE INTO vegRejected (url, prompt_version) VALUES (?, ?)').run(row.url, tagPromptVersion());
    this.deleteRow(id);
    this.bump('rejected');
  }

  private later(id: string, tries: number): void {
    const A = tagAi();
    const wait = Math.min(A.backoffMaxMinutes!, A.backoffMinutes! * 2 ** Math.min(tries, 10)) * 60_000;
    this.open().prepare('UPDATE recipes SET tag_tries = tag_tries + 1, tag_next_ms = ? WHERE id = ?').run(this.nowMs() + wait, id);
  }

  /** Classifies these recipes in batches. A cached classification (same input, same prompt version) costs no call. Returns how many are tagged now. */
  private async tagRows(rows: ReturnType<RecipeStore['rowsToTag']>, ask: TagAsk, calls: { left: number }): Promise<number> {
    const key = currentTagKey();
    let done = 0;
    const todo: { row: (typeof rows)[number]; input: ReturnType<typeof tagInputOf>; hash: string }[] = [];
    for (const row of rows) {
      const r = row.json;
      const input = tagInputOf({ id: r.id, title: r.title, ingredients: r.ingredients, steps: r.steps, category: r.category, keywords: r.keywords, ...(r.vegHint ? { vegHint: r.vegHint } : {}) });
      const hash = tagInputHash(input);
      if (row.ai && typeof row.ai.vegetarisch === 'boolean' && row.hash === hash && row.key === key) { this.finalize(r, row.ai, hash); done++; continue; }
      todo.push({ row, input, hash });
    }
    const size = tagAi().batch!;
    for (let i = 0; i < todo.length; i += size) {
      if (calls.left <= 0) break;
      calls.left--;
      const batch = todo.slice(i, i + size);
      const got = await classify(batch.map((b) => b.input), ask);
      for (const b of batch) {
        const ai = got.get(b.row.id);
        if (ai?.vegetarisch === false) this.rejectVeg(b.row.id);
        else if (ai) { this.finalize(b.row.json, ai, b.hash); done++; } else this.later(b.row.id, b.row.tries);
      }
    }
    return done;
  }

  /** Classifies the recipes with the given ids at once (a link recipe). */
  async tagIds(ids: string[], ask: TagAsk): Promise<number> {
    const rows = ids.flatMap((id) => this.rowsToTag("id = ? AND state = 'pending-tags'", [id], 1));
    return this.tagRows(rows, ask, { left: 1 });
  }

  /** Recipes waiting for tags whose backoff is over, and recipes classified under an older prompt or vocabulary, within `calls` AI calls. */
  async tagWaiting(ask: TagAsk, calls: number): Promise<number> {
    const budget = { left: calls };
    const A = tagAi();
    const waiting = this.rowsToTag("state = 'pending-tags' AND tag_next_ms <= ?", [this.nowMs()], A.batch! * calls);
    let done = await this.tagRows(waiting, ask, budget);
    if (budget.left > 0) {
      // The stale ones keep serving their old tags until the new ones arrive.
      const stale = this.rowsToTag("state = 'ok' AND tag_key != ? AND tag_next_ms <= ?", [currentTagKey(), this.nowMs()], Math.min(A.retagPerScan!, A.batch! * budget.left));
      done += await this.tagRows(stale, ask, budget);
    }
    return done;
  }

  // ---- Deriving again, and the recipes that waited for the AI ----

  /** Recipes derived under an older `deriveVersion` are derived again from their source, `max` at a time. */
  async rederive(max: number): Promise<number> {
    const o = this.open();
    const rows = o.prepare("SELECT id, raw, json, ai_json, tag_hash FROM recipes WHERE state IN ('ok', 'pending-tags') AND derive_version != ? ORDER BY imported_ms, id LIMIT ?").all(this.version(), max) as { id: string; raw: string | null; json: string; ai_json: string | null; tag_hash: string | null }[];
    let n = 0;
    for (const row of rows) {
      const old = this.parse(row);
      let raw: { recipe?: unknown } | null = null;
      try { raw = row.raw ? (JSON.parse(row.raw) as { recipe?: unknown }) : null; } catch { raw = null; }
      if (!old || !raw?.recipe) { o.prepare('UPDATE recipes SET derive_version = ? WHERE id = ?').run(this.version(), row.id); continue; }
      const r = await importRecipe(raw.recipe);
      n++;
      if (r.status === 'rejected') { this.deleteRow(row.id); this.bump('rejected'); continue; }
      if (r.status !== 'ok') { o.prepare('UPDATE recipes SET derive_version = ? WHERE id = ?').run(this.version(), row.id); continue; }
      const next: StoredRecipe = { ...r.recipe, id: old.id, source: old.source, sourceUrl: old.sourceUrl, importedAtMs: old.importedAtMs, ...(old.owner ? { owner: old.owner } : {}), deriveVersion: this.version() };
      const [minutes, protein, vegan, quality, flagged] = this.columns(next);
      try {
        o.prepare('UPDATE recipes SET fp = ?, title = ?, rating = ?, rating_n = ?, minutes = ?, protein = ?, vegan = ?, quality = ?, flagged = ?, derive_version = ?, json = ? WHERE id = ?')
          .run(fingerprint(next.title, next.ingredients), next.title, next.rating?.value ?? null, next.rating?.count ?? null, minutes, protein, vegan, quality, flagged, this.version(), JSON.stringify(next), row.id);
      } catch { o.prepare('UPDATE recipes SET derive_version = ? WHERE id = ?').run(this.version(), row.id); continue; }
      let ai: AiTags | null = null;
      try { ai = row.ai_json ? (JSON.parse(row.ai_json) as AiTags) : null; } catch { ai = null; }
      if (ai && old.tags) {
        // The old classification stays; when the AI's input changed it is asked again in the background (tag_key emptied).
        const hash = tagInputHash(tagInputOf({ id: next.id, title: next.title, ingredients: next.ingredients, steps: next.steps, category: next.category, keywords: next.keywords, ...(next.vegHint ? { vegHint: next.vegHint } : {}) }));
        this.finalize(next, ai, row.tag_hash ?? hash);
        if (hash !== row.tag_hash) o.prepare("UPDATE recipes SET tag_key = '' WHERE id = ?").run(row.id);
      }
    }
    return n;
  }

  /** Pending recipes (unclear ingredient lines) get another go with the AI, at most `max`. */
  async retryPending(ask: Structure | undefined, max: number): Promise<number> {
    if (!ask || max <= 0) return 0;
    const rows = this.open().prepare("SELECT id, scope, url, source, owner, raw FROM recipes WHERE state = 'pending' ORDER BY imported_ms LIMIT ?").all(max) as { id: string; scope: string; url: string; source: 'collection' | 'link'; owner: string | null; raw: string }[];
    let done = 0;
    for (const row of rows) {
      let raw: { recipe?: unknown; fetchedAtMs?: number };
      try { raw = JSON.parse(row.raw) as typeof raw; } catch { this.deleteRow(row.id); continue; }
      const r = await importRecipe(raw.recipe, { ask });
      if (r.status === 'pending') continue;
      this.deleteRow(row.id);
      done++;
      if (r.status === 'rejected') { this.bump('rejected'); continue; }
      if (r.status === 'failed') { this.bump('failed'); continue; }
      const stored: StoredRecipe = { ...r.recipe, id: row.id, source: row.source, sourceUrl: row.url, importedAtMs: this.nowMs(), ...(row.owner ? { owner: row.owner } : {}), deriveVersion: this.version() };
      try { this.insertUntagged(stored, row.scope, row.raw); this.bump('imported'); } catch { this.bump('duplicates'); }
    }
    return done;
  }

  // ---- The inbox ----

  inboxDir(): string { return path.join(this.dir, 'inbox'); }

  /**
   * Imports waiting inbox files, line by line, at most `perScan` recipes in all (the rest next time; a file stays in `inbox/` until every line
   * is done, its progress kept in the database, so no line is imported twice). A finished file moves to `inbox/done/` with a small result
   * file next to it; one with no usable line, or one that cannot be read, moves to `inbox/failed/` with the reason. Then the upkeep:
   * derive again after a version change, tag what waits for the AI, structure what waited for it. Never with a ride open.
   * Only `*.jsonl` files count: the fetcher writes under another name and renames it when complete.
   */
  async scanInbox(o: { noOpenRide: () => boolean; ask?: Ask }): Promise<ScanResult> {
    const total: ScanResult = { files: 0, imported: 0, rejected: 0, failed: 0, duplicates: 0, pending: 0, tagged: 0 };
    if (!o.noOpenRide()) return total;
    const inbox = this.inboxDir();
    let names: string[] = [];
    try { names = fs.readdirSync(inbox).filter((n) => /^\w[\w.-]*\.jsonl$/.test(n)).sort(); } catch { /* no inbox yet */ }
    const L = limits();
    let budget = L.perScan!;
    const calls = { left: L.aiPerScan! };
    const askLimited: Ask | undefined = o.ask ? async (i) => { if (calls.left <= 0) throw new Error('ai budget'); calls.left--; return o.ask!(i); } : undefined;
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
        const { pandafitOwn, ...recipe } = rec;
        const own = pandafitOwn === true;
        try { out = await this.add({ source: own ? 'link' : 'collection', ...(own ? { owner: OWN_OWNER } : {}), url, recipe: own ? recipe : rec, ...(askLimited ? { ask: askLimited } : {}) }); } catch { result.failed++; this.bump('failed'); continue; }
        if (out.status === 'saved') result.imported++;
        else if (out.status === 'duplicate' || out.status === 'forgotten') result.duplicates++;
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
    // Upkeep, batched and within the AI budget; the ride may have started meanwhile.
    if (o.noOpenRide()) await this.rederive(L.perScan!);
    if (askLimited && o.noOpenRide()) total.tagged += await this.tagWaiting(askLimited, calls.left);
    if (askLimited && o.noOpenRide() && calls.left > 0) await this.retryPending(askLimited, Math.min(calls.left, 10));
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
