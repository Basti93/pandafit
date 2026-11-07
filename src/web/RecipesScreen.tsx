import { useEffect, useId, useRef, useState } from 'react';
import {
  DAY_SHORT, dayDate, dayIndex, eatersOf, mealKey, placeAnswer, readPlaceRequest, recipeAmount, SLOT_LABEL, SLOTS, weekOf, type Meal, type MealPlan, type MealState,
  type PlaceRequest, type RecipeDetail, type RecipePage, type RecipeSummary, type Slot,
} from '../shared/meals';
import { Sheet } from '../tracking/ui/kit';

/** What the recipe screens need from the Essen page. */
export type RecipeCtx = {
  fetchFn: typeof fetch;
  now: () => number;
  /** This person's favourite recipe ids, from their records. */
  favs: ReadonlySet<string>;
  toggleFav: (id: string, on: boolean) => void;
  /** The readable plans of this and next week. */
  weeks: { plan: MealPlan; state: MealState }[];
  place: (week: string, meal: string, recipeId: string) => Promise<void>;
  /** This person's "In den Plan" requests, newest first. */
  placements: PlaceRequest[];
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const readSummary = (x: unknown): RecipeSummary | null => {
  if (!isObj(x) || typeof x.id !== 'string' || typeof x.title !== 'string' || typeof x.minutes !== 'number') return null;
  return {
    id: x.id, title: x.title, minutes: x.minutes, proteinG: typeof x.proteinG === 'number' ? x.proteinG : null, keepsDays: typeof x.keepsDays === 'number' ? x.keepsDays : 0,
    own: x.own === true, fav: x.fav === true, image: x.image === true, tags: Array.isArray(x.tags) ? x.tags.filter((t): t is string => typeof t === 'string') : [],
  };
};
const readPage = (x: unknown): RecipePage | null => (isObj(x) && Array.isArray(x.items) ? { items: x.items.flatMap((i) => readSummary(i) ?? []), more: x.more === true } : null);
const readDetail = (x: unknown): RecipeDetail | null => {
  const s = readSummary(x);
  if (!s || !isObj(x) || !Array.isArray(x.ingredients) || !Array.isArray(x.steps)) return null;
  return { ...s, ingredients: x.ingredients as RecipeDetail['ingredients'], steps: x.steps.filter((t): t is string => typeof t === 'string'), sourceUrl: typeof x.sourceUrl === 'string' ? x.sourceUrl : '' };
};
async function getJson(fetchFn: typeof fetch, path: string): Promise<unknown> {
  try {
    const res = await fetchFn(path, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const imageUrl = (id: string) => `/coach/recipes/${id}/image`;
/** A soft colour block from the id, with the title's first letter: the calm stand-in when there is no picture. */
const hueOf = (id: string): number => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 17);

/** The recipe's picture, or the colour block when it has none or cannot be loaded. `big` is the 16:9 picture of the recipe view. */
export function RecipePicture({ id, title, has, big }: { id: string; title: string; has: boolean; big?: boolean }) {
  const [failed, setFailed] = useState(false);
  const cls = big ? 'rc-hero' : 'rc-thumb';
  if (has && !failed) return <img className={cls} src={imageUrl(id)} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <span className={`${cls} rc-blank`} style={{ ['--rc-hue' as string]: String(hueOf(id)) }} aria-hidden="true">{(title.trim()[0] ?? '?').toUpperCase()}</span>;
}

/** The heart: small, one tap, labelled for screen readers. */
export function Heart({ on, title, onToggle }: { on: boolean; title: string; onToggle: () => void }) {
  return <button type="button" className="link rc-heart" aria-pressed={on} aria-label={on ? `${title} aus den Favoriten nehmen` : `${title} zu den Favoriten`} onClick={onToggle}>{on ? '♥' : '♡'}</button>;
}

/** The one most useful fact besides the time: protein-rich, then quick, then meal-prep, else the first label (as the vocabulary writes it). */
const MAIN_FACTS = ['Proteinreich', 'Schnell', 'Meal-Prep'];
const minutesLine = (r: RecipeSummary): string => {
  const fact = MAIN_FACTS.find((f) => r.tags.includes(f)) ?? r.tags[0];
  return [`${r.minutes} Min`, ...(fact ? [fact.replace(' und ', ' & ')] : [])].join(' · ');
};

const season = (ms: number): string => { const m = new Date(ms).getMonth() + 1; return m >= 3 && m <= 5 ? 'fruehling' : m >= 6 && m <= 8 ? 'sommer' : m >= 9 && m <= 11 ? 'herbst' : 'winter'; };
const MEAL_CHIPS = [['mahlzeit:fruehstueck', 'Frühstück'], ['mahlzeit:mittag', 'Mittag'], ['mahlzeit:abend', 'Abend']] as const;
const OTHER_CHIPS = [['schnell', 'schnell'], ['proteinreich', 'proteinreich'], ['saison', 'Saison']] as const;
const PAGE = 20;

/** "Rezepte": search and chips on top, the list below, 20 at a time. */
export function RecipesSheet({ ctx, onClose }: { ctx: RecipeCtx; onClose: () => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<ReadonlySet<string>>(new Set());
  const [items, setItems] = useState<RecipeSummary[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [viewId, setViewId] = useState<string | null>(null);
  const run = useRef(0);
  const now = ctx.now();
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);

  const query = (offset: number): string => {
    const tags = [...chips].filter((c) => c !== 'fav' && c !== 'own').map((c) => (c === 'saison' ? `saison:${season(now)}` : c));
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (tags.length) p.set('tags', tags.join(','));
    if (chips.has('own')) p.set('own', '1');
    if (chips.has('fav')) p.set('fav', '1');
    p.set('limit', String(PAGE));
    if (offset) p.set('offset', String(offset));
    return `/coach/recipes/search?${p.toString()}`;
  };
  const load = async (offset: number) => {
    const mine = ++run.current;
    if (offset === 0) setState('loading');
    const page = readPage(await getJson(ctx.fetchFn, query(offset)));
    if (mine !== run.current) return;
    if (!page) { setState('error'); return; }
    setItems((old) => (offset === 0 ? page.items : [...old, ...page.items.filter((i) => !old.some((o) => o.id === i.id))]));
    setMore(page.more);
    setState('ok');
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(0); }, [q, chips]);

  const toggle = (id: string) => setChips((old) => {
    const next = new Set(old);
    if (next.has(id)) next.delete(id);
    else { if (id.startsWith('mahlzeit:')) for (const [m] of MEAL_CHIPS) next.delete(m); next.add(id); }
    return next;
  });
  // What the person just un-hearted leaves the Favoriten list at once; the server learns it with the next sync.
  const shown = chips.has('fav') ? items.filter((i) => ctx.favs.has(i.id)) : items;
  const searchId = useId();
  return (
    <Sheet title="Rezepte" onClose={onClose}>
      <label className="tk-field" htmlFor={searchId}><span className="rc-sr">Rezept suchen</span>
        <input id={searchId} type="search" aria-label="Rezept suchen" placeholder="Rezept oder Zutat suchen" maxLength={80} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="rc-chips" role="group" aria-label="Filter">
        {[['fav', 'Favoriten'], ['own', 'Eigene'], ...MEAL_CHIPS, ...OTHER_CHIPS].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={chips.has(id!)} onClick={() => toggle(id!)}>{label}</button>
        ))}
      </div>
      {state === 'error' && (
        <p className="muted" role="status">Die Rezepte sind gerade nicht erreichbar. <button type="button" className="link" onClick={() => void load(0)}>Nochmal</button></p>
      )}
      {state === 'loading' && items.length === 0 && <p className="muted" role="status">Einen Moment …</p>}
      {state === 'ok' && shown.length === 0 && <p className="muted">{chips.has('fav') && !q && chips.size === 1 ? 'Noch keine Favoriten. Tippe bei einem Rezept auf das Herz.' : 'Dazu gibt es nichts.'}</p>}
      {shown.length > 0 && (
        <ul className="tk-rows rc-list" aria-label="Rezepte">
          {shown.map((r) => (
            <li key={r.id} className="rc-row">
              <button type="button" className="rc-open" onClick={() => setViewId(r.id)}>
                <RecipePicture id={r.id} title={r.title} has={r.image} />
                <span className="rc-text"><span className="rc-title">{r.title}</span><small className="muted">{minutesLine(r)}</small></span>
              </button>
              <Heart on={ctx.favs.has(r.id)} title={r.title} onToggle={() => ctx.toggleFav(r.id, !ctx.favs.has(r.id))} />
            </li>
          ))}
        </ul>
      )}
      {more && state === 'ok' && <button type="button" className="secondary" onClick={() => void load(items.length)}>Mehr anzeigen</button>}
      {viewId && <RecipeView ctx={ctx} id={viewId} onClose={() => setViewId(null)} />}
    </Sheet>
  );
}

const factsLine = (d: RecipeDetail): string => [`${d.minutes} Min`, ...(d.proteinG !== null && d.proteinG > 0 ? [`${d.proteinG} g Eiweiß`] : []), d.keepsDays > 0 ? `hält ${d.keepsDays} ${d.keepsDays === 1 ? 'Tag' : 'Tage'}` : 'am besten frisch'].join(' · ');

/** One recipe in full: picture, facts, tags, portions, ingredients, steps, the original. */
export function RecipeView({ ctx, id, onClose }: { ctx: RecipeCtx; id: string; onClose: () => void }) {
  const [d, setD] = useState<RecipeDetail | null | 'error'>(null);
  const [portions, setPortions] = useState(2);
  const [planning, setPlanning] = useState(false);
  useEffect(() => {
    let live = true;
    void getJson(ctx.fetchFn, `/coach/recipes/${encodeURIComponent(id)}`).then((x) => { if (live) setD(readDetail(x) ?? 'error'); });
    return () => { live = false; };
  }, [ctx.fetchFn, id]);
  const fav = ctx.favs.has(id);
  return (
    <Sheet title={d && d !== 'error' ? d.title : 'Rezept'} onClose={onClose}
      actions={d && d !== 'error' ? (
        <>
          <button type="button" onClick={() => setPlanning(true)}>In den Plan ›</button>
          <button type="button" className="secondary rc-favbtn" aria-pressed={fav} onClick={() => ctx.toggleFav(id, !fav)}>{fav ? '♥ Favorit' : '♡ Zu Favoriten'}</button>
        </>
      ) : undefined}>
      {d === null && <p className="muted" role="status">Einen Moment …</p>}
      {d === 'error' && <p className="muted" role="status">Dieses Rezept ist gerade nicht zu öffnen.</p>}
      {d && d !== 'error' && (
        <div className="rc-view">
          <RecipePicture id={d.id} title={d.title} has={d.image} big />
          <p className="muted rc-facts">{factsLine(d)}</p>
          {d.tags.length > 0 && <ul className="rc-tags" aria-label="Schlagwörter">{d.tags.map((t) => <li key={t}>{t.replace(' und ', ' & ')}</li>)}</ul>}
          <div className="rc-portions" role="group" aria-label="Portionen">
            <button type="button" className="secondary" aria-label="Eine Portion weniger" disabled={portions <= 1} onClick={() => setPortions(portions - 1)}>−</button>
            <span aria-live="polite">{portions} {portions === 1 ? 'Portion' : 'Portionen'}</span>
            <button type="button" className="secondary" aria-label="Eine Portion mehr" disabled={portions >= 4} onClick={() => setPortions(portions + 1)}>+</button>
          </div>
          <ul className="pm-ingredients">{d.ingredients.map((i, n) => <li key={n}><b>{recipeAmount(i, portions)}</b> {i.name}</li>)}</ul>
          <ol className="pm-steps">{d.steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
          {d.sourceUrl && <p className="muted pm-meta"><a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">Zum Originalrezept ›</a></p>}
        </div>
      )}
      {planning && d && d !== 'error' && <PlaceSheet ctx={ctx} recipe={d} onClose={() => setPlanning(false)} />}
    </Sheet>
  );
}

/** "In den Plan": a day and a meal of this or next week; the dish there is replaced, checked by the coach like a swap. */
function PlaceSheet({ ctx, recipe, onClose }: { ctx: RecipeCtx; recipe: RecipeSummary; onClose: () => void }) {
  const t = ctx.now();
  const current = weekOf(t);
  const today = dayIndex(t);
  const [weekKey, setWeekKey] = useState(ctx.weeks.find((w) => w.plan.week === current)?.plan.week ?? ctx.weeks[0]?.plan.week ?? null);
  const week = ctx.weeks.find((w) => w.plan.week === weekKey);
  const [day, setDay] = useState(Math.min(6, Math.max(week?.plan.week === current ? today : 0, 0)));
  const [slot, setSlot] = useState<Slot>('abend');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const key = mealKey(day, slot);
  const meal: Meal | undefined = week?.plan.meals.find((m) => m.day === day && m.slot === slot);
  const eaters = week ? (meal ? eatersOf(week.plan, week.state, key) : week.plan.people.map((p) => p.id)) : [];
  const names = week ? week.plan.people.filter((p) => eaters.includes(p.id)).map((p) => p.name) : [];
  const answer = sentAt === null ? null : ctx.placements.find((p) => p.atMs >= sentAt && p.recipeId === recipe.id && p.week === weekKey && p.meal === key);
  const past = (d: number) => week?.plan.week === current && d < today;
  const send = () => { if (!week) return; setSentAt(ctx.now() - 1000); void ctx.place(week.plan.week, key, recipe.id); };
  return (
    <Sheet title="In den Plan" size="small" onClose={onClose}
      actions={answer?.result === 'placed' ? <button type="button" onClick={onClose}>Fertig</button> : <button type="button" disabled={!week || past(day) || (sentAt !== null && !answer?.result)} onClick={send}>Eintragen</button>}>
      {!week ? <p className="muted">Es gibt noch keinen Essensplan, in den das Rezept passt.</p> : (
        <div className="rc-place">
          {ctx.weeks.length > 1 && (
            <div className="tk-textseg" role="group" aria-label="Woche">
              {ctx.weeks.map((w) => <button key={w.plan.week} type="button" className="link" aria-pressed={w.plan.week === weekKey} onClick={() => { setWeekKey(w.plan.week); setDay(w.plan.week === current ? Math.max(day, today) : day); setSentAt(null); }}>{w.plan.week === current ? 'Diese Woche' : 'Nächste Woche'}</button>)}
            </div>
          )}
          <div className="rc-daypick" role="group" aria-label="Tag">
            {DAY_SHORT.map((d, i) => (
              <button key={d} type="button" aria-pressed={i === day} disabled={past(i)} onClick={() => { setDay(i); setSentAt(null); }}>
                <b>{d}</b><span>{dayDate(week.plan.week, i).split('.')[0]}</span>
              </button>
            ))}
          </div>
          <div className="rc-slotpick" role="group" aria-label="Mahlzeit">
            {SLOTS.map((s) => <button key={s} type="button" aria-pressed={s === slot} onClick={() => { setSlot(s); setSentAt(null); }}>{SLOT_LABEL[s]}</button>)}
          </div>
          <p className="muted pm-meta">{meal ? `Ersetzt: ${meal.dish.title}` : 'Noch frei'}{names.length > 0 ? ` · isst mit: ${names.join(', ')}` : ''}</p>
          {sentAt !== null && <p className={answer?.result ? 'pm-reply' : 'pm-reply pending'} role="status">{placeAnswer(answer?.result ?? null)}</p>}
        </div>
      )}
    </Sheet>
  );
}

/** The placements of a person, newest first. */
export const placements = (records: { id: string; deleted: boolean; body: unknown }[] | null): PlaceRequest[] =>
  (records ?? []).flatMap((r) => { const q = !r.deleted ? readPlaceRequest(r.id, r.body) : null; return q ? [q] : []; }).sort((a, b) => b.atMs - a.atMs);

