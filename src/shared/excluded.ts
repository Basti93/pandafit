import { exerciseTitles, type Exercise } from './exercises';

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * True when an exercise is ruled out. `excluded` holds own catalog ids (and may hold linked Hevy template ids). The exercise is
 * resolved by its id (it is excluded itself, or a Hevy link leads to an excluded own id), by an exact catalog id, or by an exact
 * known title of a catalog exercise (title, Hevy title, aliases). Never fuzzy.
 */
export function isExcluded(e: { id?: string; templateId?: string; title?: string }, excluded: ReadonlySet<string> | undefined, catalog: readonly Exercise[], links?: Readonly<Record<string, string>>): boolean {
  if (!excluded || excluded.size === 0) return false;
  for (const id of [e.id, e.templateId]) {
    if (!id) continue;
    if (excluded.has(id)) return true;
    const linked = links?.[id];
    if (linked && excluded.has(linked)) return true;
  }
  const title = e.title ? norm(e.title) : '';
  if (!title) return false;
  return catalog.some((c) => excluded.has(c.id) && exerciseTitles(c).some((t) => norm(t) === title));
}

/** The catalog entry of an exercise, resolved like `isExcluded` does: by id, by a Hevy link to an own id, else by an exact normalized known title. */
export function resolveCatalogEntry(e: { id?: string; templateId?: string; title?: string }, catalog: readonly Exercise[], links?: Readonly<Record<string, string>>): Exercise | null {
  for (const id of [e.id, e.templateId]) {
    if (!id) continue;
    const hit = catalog.find((c) => c.id === id) ?? (links?.[id] ? catalog.find((c) => c.id === links[id]) : undefined);
    if (hit) return hit;
  }
  const title = e.title ? norm(e.title) : '';
  return title ? catalog.find((c) => exerciseTitles(c).some((t) => norm(t) === title)) ?? null : null;
}
