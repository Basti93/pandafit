import { RECIPE_ID, RECIPE_PAGE, type RecipeDetail, type RecipePage, type RecipeSummary } from '../../shared/meals';
import { PROTEIN_UNKNOWN, type StoredRecipe } from './recipe-import';
import type { RecipeStore } from './recipe-store';
import { allTags, FACETS, facetOf, labelOf, vocabulary, type Facet } from './recipe-tags';

/** What the app may ask when browsing; every value is checked here, none is trusted. */
export type BrowseQuery = { q?: string; tags?: string[]; own?: boolean; fav?: boolean; limit?: number; offset?: number };

/** Tags worth showing, most telling first: soft and hard properties, then the kind and the cuisine; the diet and "all year" say little. */
const shownTags = (r: StoredRecipe): string[] => {
  if (!r.tags) return [];
  const order: Facet[] = ['eigenschaft', 'art', 'kueche', 'saison'];
  return allTags(r.tags).filter((t) => order.includes(t.facet) && t.tag !== 'ganzjaehrig').sort((a, b) => order.indexOf(a.facet) - order.indexOf(b.facet)).map((t) => labelOf(t.facet, t.tag));
};

export const summaryOf = (r: StoredRecipe, fav: boolean, hasImage: boolean): RecipeSummary => ({
  id: r.id, title: r.title, minutes: r.minutes, proteinG: r.proteinG === PROTEIN_UNKNOWN ? null : r.proteinG, keepsDays: r.keepsDays,
  own: r.source === 'link', fav, image: hasImage, tags: shownTags(r),
});

/** A tag id the vocabulary knows ("schnell", "mahlzeit:abend"); anything else is dropped. */
export function knownTag(t: string): string | null {
  if (t.length > 40) return null;
  const [a, b] = t.includes(':') ? t.split(':') as [string, string] : [null, t];
  if (a) return (FACETS as readonly string[]).includes(a) && vocabulary()[a as Facet].some((e) => e.id === b) ? t : null;
  return facetOf(b) ? b : null;
}

/** One page of the recipes a person may browse (only those the AI confirmed as vegetarian), with their favourites marked. */
export function browse(store: RecipeStore, person: string, favs: ReadonlySet<string>, q: BrowseQuery): RecipePage {
  const limit = Math.max(1, Math.min(RECIPE_PAGE, Math.floor(q.limit ?? RECIPE_PAGE)));
  const tags = [...new Set((q.tags ?? []).flatMap((t) => knownTag(t) ?? []))].slice(0, 6);
  const found = store.search({
    ...(q.q ? { text: q.q.slice(0, 80) } : {}), tags, visibleTo: person, ...(q.own ? { source: 'link' as const } : {}), ...(q.fav ? { ids: [...favs].slice(0, 2000) } : {}),
    limit: limit + 1, offset: Math.max(0, Math.min(10_000, Math.floor(q.offset ?? 0))),
  });
  return { items: found.slice(0, limit).map((r) => summaryOf(r, favs.has(r.id), store.imageOf(r.id) !== null)), more: found.length > limit };
}

/** The full recipe for the view, or null when the person may not see it (unknown, not confirmed, or another person's link recipe). */
export function detail(store: RecipeStore, person: string, favs: ReadonlySet<string>, id: string): RecipeDetail | null {
  if (!RECIPE_ID.test(id)) return null;
  const r = store.canSee(id, person);
  if (!r) return null;
  return { ...summaryOf(r, favs.has(r.id), store.imageOf(r.id) !== null), ingredients: r.ingredients.map((i) => ({ ...i })), steps: [...r.steps], sourceUrl: r.sourceUrl };
}
