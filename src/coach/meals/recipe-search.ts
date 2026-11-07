import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { norm, type StoredRecipe } from './recipe-import';
import { canonicalIngredient, facetOf } from './recipe-tags';

/**
 * Searching the recipe collection: SQLite FTS5 over title, canonical ingredients and tag labels, plus facet filters. A pure query
 * function over the database; the meal planner's shortlist uses it too. Only fully tagged, cleanly parsed recipes are found.
 */

export type SearchQuery = {
  /** Free text: "Kichererbsen Spinat". Every word must match (title, an ingredient or a tag label). */
  text?: string;
  /** Tag ids, all of them: "schnell", "vegan", "pasta" or "art:pasta". */
  tags?: string[];
  maxMinutes?: number;
  /** A recipe with an unknown protein value never passes this. */
  minProteinG?: number;
  vegan?: boolean;
  includeIngredients?: string[];
  excludeIngredients?: string[];
  /** Only the collection, or only link recipes (of `owner` if given). Default: both. */
  source?: 'collection' | 'link';
  owner?: string;
  /** The collection plus the link recipes of this person and the household's own ones: what one person may browse. */
  visibleTo?: string;
  /** Only these recipes (an empty list finds nothing). */
  ids?: string[];
  offset?: number;
  limit?: number;
  /** 'rating' (default; with text the text match comes first), or 'sample': a varied, repeatable order by `seed`. */
  order?: 'rating' | 'sample';
  seed?: number;
};

const STOP = new Set(['hab', 'habe', 'haben', 'ich', 'wir', 'und', 'mit', 'ohne', 'oder', 'ein', 'eine', 'einen', 'was', 'kochen', 'gerne', 'gern', 'noch', 'etwas', 'viel', 'mal', 'aus', 'der', 'die', 'das', 'von']);
const MAX_LIMIT = 5000;

/** FTS5 syntax for free text: each word as a prefix, the word and its canonical ingredient name as alternatives; null when nothing is left. */
export function ftsQuery(text: string): string | null {
  const words = norm(text).split(' ').filter((w) => w && !STOP.has(w) && /^[a-z0-9]+$/.test(w));
  if (words.length === 0) return null;
  return words.map((w) => {
    const c = canonicalIngredient(w).split(' ').filter((x) => /^[a-z0-9]+$/.test(x));
    const alts = [...new Set([w, ...c])];
    return `(${alts.map((a) => `"${a}"*`).join(' OR ')})`;
  }).join(' AND ');
}

export function searchRecipes(db: DatabaseSync, q: SearchQuery): StoredRecipe[] {
  // Only what the AI has confirmed as vegetarian is found (and so planned); older rows wait for their re-check.
  const where: string[] = ["r.state = 'ok'", 'r.flagged = 0', "json_extract(r.json, '$.vegCheckedBy') = 'ai'"];
  const args: SQLInputValue[] = [];
  let join = '';
  const fts = q.text ? ftsQuery(q.text) : null;
  if (q.text && !fts) { /* only stop words: no text filter */ }
  if (fts) { join = 'JOIN recipes_fts f ON f.rowid = r.rowid AND recipes_fts MATCH ?'; args.push(fts); }
  for (const t of q.tags ?? []) {
    const [a, b] = t.includes(':') ? t.split(':') as [string, string] : [facetOf(t) ?? '', t];
    where.push(`EXISTS (SELECT 1 FROM recipe_tags t WHERE t.recipe_id = r.id AND t.tag = ?${a ? ' AND t.facet = ?' : ''})`);
    args.push(b); if (a) args.push(a);
  }
  if (q.vegan) { where.push("EXISTS (SELECT 1 FROM recipe_tags t WHERE t.recipe_id = r.id AND t.facet = 'ernaehrung' AND t.tag = 'vegan')"); }
  if (q.maxMinutes !== undefined) { where.push('r.minutes <= ?'); args.push(q.maxMinutes); }
  if (q.minProteinG !== undefined) { where.push('r.protein IS NOT NULL AND r.protein >= ?'); args.push(q.minProteinG); }
  for (const name of q.includeIngredients ?? []) { where.push('EXISTS (SELECT 1 FROM recipe_ingredients i WHERE i.recipe_id = r.id AND i.canon = ?)'); args.push(canonicalIngredient(name)); }
  for (const name of q.excludeIngredients ?? []) { where.push('NOT EXISTS (SELECT 1 FROM recipe_ingredients i WHERE i.recipe_id = r.id AND i.canon = ?)'); args.push(canonicalIngredient(name)); }
  if (q.source) { where.push('r.source = ?'); args.push(q.source); }
  if (q.owner !== undefined) { where.push('r.owner = ?'); args.push(q.owner); }
  if (q.visibleTo !== undefined) { where.push("(r.source = 'collection' OR r.owner = ? OR r.owner = '~own')"); args.push(q.visibleTo); }
  if (q.ids) {
    if (q.ids.length === 0) return [];
    where.push(`r.id IN (${q.ids.map(() => '?').join(',')})`);
    args.push(...q.ids);
  }
  // A balanced meal comes first, only implicitly: nothing about it is shown.
  const rating = "COALESCE(json_extract(r.json, '$.ausgewogen') = 'gut', 0) DESC, COALESCE(r.rating, 0) DESC, COALESCE(r.rating_n, 0) DESC, r.id";
  const order = q.order === 'sample' ? `((r.rowid * 2654435761 + ?) & 4294967295), r.id` : fts ? `f.rank, ${rating}` : rating;
  const orderArgs: SQLInputValue[] = q.order === 'sample' ? [Math.abs(Math.floor(q.seed ?? 0)) % 4294967295] : [];
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(q.limit ?? 50)));
  const rows = db.prepare(`SELECT r.json AS json FROM recipes r ${join} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, ...orderArgs, limit, Math.max(0, Math.floor(q.offset ?? 0))) as { json: string }[];
  return rows.flatMap((r) => { try { return [JSON.parse(r.json) as StoredRecipe]; } catch { return []; } });
}
