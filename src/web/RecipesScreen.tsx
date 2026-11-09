import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../tracking/ui/data/api';
import {
  DAY_SHORT, dayDate, dayIndex, mealKey, placeAnswer, readPlaceRequest, SLOT_LABEL, SLOTS, weekOf, type Meal, type MealPlan, type MealState,
  type PlaceRequest, type RecipeDetail, type RecipePage as RecipeResults, type RecipeSummary, type Slot,
} from '../shared/meals';
import { Card, ConfirmLink, HeadCard, Kicker, PillButton, RoundButton } from '../tracking/ui/kit';
import { EssenPage } from './essen/EssenPage';
import { MealImage } from './essen/MealImage';
import { eaterNames, eatersLine, placeButton, placeDefault, placedSentence, recipeSentence } from './essen/meals-view';
import { IngredientsCard, StepsCard } from './essen/RecipeParts';

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
  /** Deletes one of this person's own recipes (by recipe id). */
  deleteOwn?: (id: string) => void;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const readSummary = (x: unknown): RecipeSummary | null => {
  if (!isObj(x) || typeof x.id !== 'string' || typeof x.title !== 'string' || typeof x.minutes !== 'number') return null;
  return {
    id: x.id, title: x.title, minutes: x.minutes, proteinG: typeof x.proteinG === 'number' ? x.proteinG : null, keepsDays: typeof x.keepsDays === 'number' ? x.keepsDays : 0,
    own: x.own === true, fav: x.fav === true, image: x.image === true, tags: Array.isArray(x.tags) ? x.tags.filter((t): t is string => typeof t === 'string') : [],
  };
};
const readPage = (x: unknown): RecipeResults | null => (isObj(x) && Array.isArray(x.items) ? { items: x.items.flatMap((i) => readSummary(i) ?? []), more: x.more === true } : null);
const readDetail = (x: unknown): RecipeDetail | null => {
  const s = readSummary(x);
  if (!s || !isObj(x) || !Array.isArray(x.ingredients) || !Array.isArray(x.steps)) return null;
  return { ...s, ingredients: x.ingredients as RecipeDetail['ingredients'], steps: x.steps.filter((t): t is string => typeof t === 'string'), sourceUrl: typeof x.sourceUrl === 'string' ? x.sourceUrl : '' };
};
async function getJson(fetchFn: typeof fetch, path: string): Promise<unknown> {
  try {
    const res = await apiFetch(fetchFn, path);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

const imageUrl = (id: string) => `/coach/recipes/${id}/image`;
/** A soft colour block from the id: the calm stand-in when there is no picture. */
const hueOf = (id: string): number => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 17);

/** The recipe's picture in the list, or the colour block when it has none or cannot be loaded. */
export function RecipePicture({ id, has }: { id: string; has: boolean }) {
  const [failed, setFailed] = useState(false);
  const cls = 'rc-thumb';
  if (has && !failed) return <img className={cls} src={imageUrl(id)} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <span className={`${cls} rc-blank`} style={{ ['--rc-hue' as string]: String(hueOf(id)) }} aria-hidden="true" />;
}

/** The heart in a list row: small, one tap, labelled for screen readers. */
export function Heart({ on, title, onToggle }: { on: boolean; title: string; onToggle: () => void }) {
  return <button type="button" className="link rc-heart" aria-pressed={on} aria-label={on ? `${title} aus den Favoriten nehmen` : `${title} zu den Favoriten`} onClick={onToggle}>{on ? '♥' : '♡'}</button>;
}

/** The heart on the recipe page: the round button in the head card. */
export function RecipeHeart({ on, title, onToggle }: { on: boolean; title: string; onToggle: () => void }) {
  return <RoundButton icon="favorit" pressed={on} name={on ? `${title} aus den Favoriten nehmen` : `${title} zu den Favoriten`} onClick={onToggle} />;
}

/** The one most useful fact besides the time: protein-rich, then quick, then meal-prep, else the first label (as the vocabulary writes it). */
const MAIN_FACTS = ['Proteinreich', 'Schnell', 'Meal-Prep'];
const minutesLine = (r: RecipeSummary): string => {
  const fact = MAIN_FACTS.find((f) => r.tags.includes(f)) ?? r.tags[0];
  return [`${r.minutes} Min`, ...(fact ? [fact.replace(' und ', ' & ')] : [])].join(' · ');
};

const season = (ms: number): string => { const m = new Date(ms).getMonth() + 1; return m >= 3 && m <= 5 ? 'fruehling' : m >= 6 && m <= 8 ? 'sommer' : m >= 9 && m <= 11 ? 'herbst' : 'winter'; };
const OTHER_CHIPS = [['schnell', 'schnell'], ['proteinreich', 'proteinreich'], ['saison', 'Saison']] as const;
const PAGE = 20;

/** "Rezepte": search and chips on top, the list below, 20 at a time. A recipe opens as a page over it; the list keeps its search, filters and entries. */
export function RecipesPage({ ctx, onBack, onAddLink }: { ctx: RecipeCtx; onBack: () => void; onAddLink?: () => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [chips, setChips] = useState<ReadonlySet<string>>(new Set());
  const [items, setItems] = useState<RecipeSummary[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [viewId, setViewId] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
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
    else next.add(id);
    return next;
  });
  // What the person just un-hearted leaves the Favoriten list at once; the server learns it with the next sync.
  const shown = (chips.has('fav') ? items.filter((i) => ctx.favs.has(i.id)) : items).filter((i) => !gone.has(i.id));
  const searchId = useId();
  return (
    <>
    <EssenPage hidden={viewId !== null} title="Rezepte" back={{ label: 'Essen', onClick: onBack }}>
      <div className="tk-screen">
      {onAddLink && <div><PillButton icon="plus" label="Rezept per Link" onClick={onAddLink} /></div>}
      <label className="tk-field" htmlFor={searchId}><span className="tk-sr">Rezept suchen</span>
        <input id={searchId} type="search" aria-label="Rezept suchen" placeholder="Rezept oder Zutat suchen" maxLength={80} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="tk-chips" role="group" aria-label="Filter">
        {[['fav', 'Favoriten'], ['own', 'Von mir'], ...OTHER_CHIPS].map(([id, label]) => (
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
                <RecipePicture id={r.id} has={r.image} />
                <span className="rc-text"><span className="rc-title">{r.title}</span><small className="muted">{minutesLine(r)}{r.own ? ' · von dir' : ''}</small></span>
              </button>
              <Heart on={ctx.favs.has(r.id)} title={r.title} onToggle={() => ctx.toggleFav(r.id, !ctx.favs.has(r.id))} />
            </li>
          ))}
        </ul>
      )}
      {more && state === 'ok' && <button type="button" className="secondary" onClick={() => void load(items.length)}>Mehr anzeigen</button>}
      </div>
    </EssenPage>
    {viewId && <RecipePage ctx={ctx} id={viewId} backLabel="Rezepte" onBack={() => setViewId(null)} onDeleted={() => { setGone((g) => new Set(g).add(viewId)); setViewId(null); }} />}
    </>
  );
}

/** One recipe as a page: head card with picture, sentence and heart; ingredients with portions; steps; "In den Plan"; the original and delete. */
export function RecipePage({ ctx, id, backLabel, onBack, onDeleted }: { ctx: RecipeCtx; id: string; backLabel: 'Rezepte' | 'Mahlzeit'; onBack: () => void; onDeleted?: () => void }) {
  const [d, setD] = useState<RecipeDetail | null | 'error'>(null);
  const [portions, setPortions] = useState(2);
  useEffect(() => {
    let live = true;
    void getJson(ctx.fetchFn, `/coach/recipes/${encodeURIComponent(id)}`).then((x) => { if (live) setD(readDetail(x) ?? 'error'); });
    return () => { live = false; };
  }, [ctx.fetchFn, id]);
  const fav = ctx.favs.has(id);
  const back = { label: backLabel, onClick: onBack };
  if (!d || d === 'error') {
    return <EssenPage back={back}><div className="tk-screen"><Card><p className="muted" role="status">{d === null ? 'Einen Moment …' : 'Dieses Rezept ist gerade nicht zu öffnen.'}</p></Card></div></EssenPage>;
  }
  const placed = placedSentence(ctx.weeks, d.id, ctx.now());
  const deletable = d.own && ctx.deleteOwn;
  return (
    <EssenPage back={back}>
      <div className="tk-screen">
        <HeadCard picture={<MealImage recipeId={d.id} has={d.image} slot="abend" size="big" />} kicker={d.own ? 'Von dir gesammelt' : 'Aus der Sammlung'} title={d.title} text={recipeSentence(d)}>
          <div className="rc-headfoot">
            {d.tags.length > 0 ? <ul className="rc-tags" aria-label="Schlagwörter">{d.tags.map((t) => <li key={t}>{t.replace(' und ', ' & ')}</li>)}</ul> : <span />}
            <RecipeHeart on={fav} title={d.title} onToggle={() => ctx.toggleFav(d.id, !fav)} />
          </div>
          {placed && <p className="tk-note">{placed}</p>}
        </HeadCard>
        <IngredientsCard portions={portions} onPortions={setPortions} ingredients={d.ingredients} />
        <StepsCard steps={d.steps} />
        <PlaceCard ctx={ctx} recipe={d} />
        {(d.sourceUrl || deletable) && (
          <Card soft label="Mehr zu diesem Rezept">
            <Kicker>Mehr</Kicker>
            {d.sourceUrl && <a className="secondary" href={d.sourceUrl} target="_blank" rel="noopener noreferrer">Originalrezept öffnen</a>}
            {deletable && <p><ConfirmLink label="Rezept löschen" onConfirm={() => { ctx.deleteOwn!(d.id); (onDeleted ?? onBack)(); }} /></p>}
          </Card>
        )}
      </div>
    </EssenPage>
  );
}

/** "In den Plan": a day and a meal of this or next week; the dish there is replaced, checked by the coach like a swap. */
function PlaceCard({ ctx, recipe }: { ctx: RecipeCtx; recipe: RecipeSummary }) {
  const t = ctx.now();
  const current = weekOf(t);
  const today = dayIndex(t);
  const start = useMemo(() => {
    const d = placeDefault(ctx.weeks, t);
    if (d) return d;
    const w = ctx.weeks.find((x) => x.plan.week === current) ?? ctx.weeks[0];
    return w ? { week: w.plan.week, day: w.plan.week === current ? today : 0, slot: 'abend' as Slot } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [weekKey, setWeekKey] = useState<string | null>(start?.week ?? null);
  const [day, setDay] = useState(start?.day ?? 0);
  const [slot, setSlot] = useState<Slot>(start?.slot ?? 'abend');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const week = ctx.weeks.find((w) => w.plan.week === weekKey);
  const key = mealKey(day, slot);
  const meal: Meal | undefined = week?.plan.meals.find((m) => m.day === day && m.slot === slot);
  const names = week ? (meal ? eaterNames(week, meal) : week.plan.people.map((p) => p.name)) : [];
  const answer = sentAt === null ? null : ctx.placements.find((p) => p.atMs >= sentAt && p.recipeId === recipe.id && p.week === weekKey && p.meal === key);
  const past = (d: number) => week?.plan.week === current && d < today;
  const send = () => { if (!week) return; setSentAt(ctx.now() - 1000); void ctx.place(week.plan.week, key, recipe.id); };
  return (
    <Card label="In den Plan">
      <Kicker>In den Plan</Kicker>
      {!week ? <p>Es gibt noch keinen Essensplan, in den das Rezept passt.</p> : (
        <>
          <p>Wähle einen Tag und eine Mahlzeit. {eatersLine(names)}.</p>
          {ctx.weeks.length > 1 && (
            <div className="tk-textseg" role="group" aria-label="Woche">
              {ctx.weeks.map((w) => <button key={w.plan.week} type="button" className="link" aria-pressed={w.plan.week === weekKey} onClick={() => { setWeekKey(w.plan.week); setDay(w.plan.week === current ? Math.max(day, today) : day); setSentAt(null); }}>{w.plan.week === current ? 'Diese Woche' : 'Nächste Woche'}</button>)}
            </div>
          )}
          <div className="tk-chips" role="group" aria-label="Tag">
            {DAY_SHORT.map((d, i) => (
              <button key={d} type="button" aria-pressed={i === day} disabled={past(i)} onClick={() => { setDay(i); setSentAt(null); }}>{d} {dayDate(week.plan.week, i).split('.')[0]}</button>
            ))}
          </div>
          <div className="tk-chips" role="group" aria-label="Mahlzeit">
            {SLOTS.map((s) => <button key={s} type="button" aria-pressed={s === slot} onClick={() => { setSlot(s); setSentAt(null); }}>{SLOT_LABEL[s]}</button>)}
          </div>
          <p className="muted">{meal ? (meal.dish.recipeId === recipe.id ? 'Schon eingetragen.' : `Tauscht ${meal.dish.title} aus.`) : 'Noch frei.'}</p>
          <button type="button" className="primary" disabled={past(day) || (sentAt !== null && !answer?.result)} onClick={send}>{placeButton(day, slot, week.plan.week === current && day === today)}</button>
          {sentAt !== null && <p className={answer?.result ? 'pm-reply' : 'pm-reply pending'} role="status">{placeAnswer(answer?.result ?? null)}</p>}
        </>
      )}
    </Card>
  );
}

/** The placements of a person, newest first. */
export const placements = (records: { id: string; deleted: boolean; body: unknown }[] | null): PlaceRequest[] =>
  (records ?? []).flatMap((r) => { const q = !r.deleted ? readPlaceRequest(r.id, r.body) : null; return q ? [q] : []; }).sort((a, b) => b.atMs - a.atMs);

