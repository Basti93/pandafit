import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { nextUpdatedMs } from '../tracking/ui/run-view';
import type { TrackedRecord } from '../shared/records';
import {
  changeOwn, favouriteIds, favRecordId, newPlaceId, CHAT_MAX_CHARS, isLinkRecordId, isOwnKey, LINK_URL_MAX, linkAnswer, newLinkId, readLinkRequest, safeLink, newOwnKey, OWN_AMOUNT_MAX, OWN_NAME_MAX, withOwn, isChatRecordId, newChatId, readMealChat, DAY_LONG, DAY_SHORT, dayDate, dayIndex, eatersOf, mealKey, readMealState,
  shoppingList, sideText, SLOT_LABEL, SLOTS, stateRecordId, weekOf, withItem,
  type ItemState, type LinkRequest, type Meal, type MealChat, type MealState, type ShopItem,
} from '../shared/meals';
import { weekRangeOfKey } from '../shared/dates';
import type { WebPort } from './webPort';
import { usePortRecords } from '../tracking/ui/hooks';
import { ConfirmLink, PageHead, Row, RowCard, RowList, Segments, Sheet } from '../tracking/ui/kit';
import { listAnd, mealDayOf, mealWeeks, type MealAt, type Week } from './essen/meals-view';
import { MealPage } from './essen/MealPage';
import { placements, RecipesSheet, type RecipeCtx } from './RecipesScreen';

export type { Week };
export type MealData = ReturnType<typeof useMealData>;
type Page = { name: 'start' } | { name: 'meal'; at: MealAt; from: 'essen' | 'heute' };
export { mealDayOf, mealWeeks };

/** This person's messages to the coach about the plan, oldest first. */
export const mealChats = (records: TrackedRecord[] | null): MealChat[] =>
  (records ?? []).flatMap((r) => { const c = !r.deleted && isChatRecordId(r.id) ? readMealChat(r.id, r.body) : null; return c ? [c] : []; }).sort((a, b) => a.atMs - b.atMs);

/** This person's requests to add a recipe by link, newest first. */
export const linkRequests = (records: TrackedRecord[] | null): LinkRequest[] =>
  (records ?? []).flatMap((r) => { const q = !r.deleted && isLinkRecordId(r.id) ? readLinkRequest(r.id, r.body) : null; return q ? [q] : []; }).sort((a, b) => b.atMs - a.atMs);
/** "Rezept hinzufügen": a link, written as a record and answered by the coach, like a message. */
function AddRecipeSheet({ requests, onAdd, onClose }: { requests: LinkRequest[]; onAdd: (url: string) => Promise<void>; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const formId = useId();
  const clean = url.trim();
  const ok = safeLink(clean) !== null;
  // The answer to what was just sent; on opening, the answer to a link sent in the last ten minutes.
  const recent = requests[0] && Date.now() - requests[0].atMs < 600_000 ? requests[0] : undefined;
  const last = sentAt === null ? recent : requests.find((q) => q.atMs >= sentAt);
  const submit = () => { if (!ok) return; setSentAt(Date.now() - 1000); setUrl(''); void onAdd(clean); };
  return (
    <Sheet title="Rezept hinzufügen" onClose={onClose} actions={<button type="submit" form={formId} disabled={!ok}>Hinzufügen</button>}>
      <form id={formId} className="tk-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="tk-field"><span>Link zum Rezept</span>
          <input autoFocus type="url" inputMode="url" aria-label="Link zum Rezept" maxLength={LINK_URL_MAX} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <p className="muted pm-meta">Das Rezept erscheint unter „Von mir“. Es gehen nur vegetarische Rezepte und nur Links mit https.</p>
      </form>
      {(sentAt !== null || last) && <p className={last?.result ? 'pm-reply' : 'pm-reply pending'} role="status">{linkAnswer(last?.result ?? null)}</p>}
    </Sheet>
  );
}

const chatDate = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const ChatRow = ({ c }: { c: MealChat }) => (
  <li>
    <p className="pm-said">{c.text}<small>{chatDate(c.atMs)}</small></p>
    <p className={c.reply ? 'pm-reply' : 'pm-reply pending'}>{c.reply ?? 'Bo antwortet gleich. Ist der Mac aus, dauert es, bis er wieder an ist.'}</p>
  </li>
);

/** "Änderung wünschen": written as a record, answered by the Mac at its next sync with no ride open. */
function ChatSheet({ chat, onSend, onClose }: { chat: MealChat[]; onSend: (text: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const formId = useId();
  const [last, ...before] = [...chat].reverse();
  const submit = () => { const t = text.trim(); if (!t) return; setText(''); setSent(true); void onSend(t); };
  return (
    <Sheet title="Änderung wünschen" onClose={onClose} actions={<button type="submit" form={formId} disabled={!text.trim()}>Senden</button>}>
      <form id={formId} className="tk-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="tk-field"><span>Sag Bo, was du ändern willst. Bo schlägt eine Änderung vor. Du bestätigst sie.</span>
          <input autoFocus aria-label="Nachricht an Bo" maxLength={CHAT_MAX_CHARS} placeholder="z. B. Mittwoch lieber Nudeln" value={text} onChange={(e) => { setText(e.target.value); setSent(false); }} />
        </label>
      </form>
      {sent && <p className="muted" role="status">Wunsch gesendet</p>}
      {last && <ul className="pm-chat-list"><ChatRow c={last} /></ul>}
      {before.length > 0 && (
        <details className="pm-chat-before">
          <summary>Bisheriges Gespräch ({before.length})</summary>
          <ul className="pm-chat-list">{before.map((c) => <ChatRow key={c.id} c={c} />)}</ul>
        </details>
      )}
    </Sheet>
  );
}

export const short = (k: string) => { const [d, s] = k.split('-'); return `${DAY_SHORT[Number(d)]}${s === 'mittag' ? '' : ` ${SLOT_LABEL[s as keyof typeof SLOT_LABEL]}`}`; };
const NEXT: Record<ItemState, ItemState> = { offen: 'gekauft', gekauft: 'offen', da: 'offen' };

/** One meal as a row; a tap opens its page. A deviation from the plan shows under the title. */
function MealRow({ week, meal, onOpen }: { week: Week; meal: Meal; onOpen: () => void }) {
  const eaters = eatersOf(week.plan, week.state, mealKey(meal.day, meal.slot));
  const away = week.plan.people.filter((p) => !eaters.includes(p.id));
  const note = eaters.length === 0 ? 'Niemand isst mit' : away.length > 0 ? `${listAnd(away.map((p) => p.name))} ${away.length > 1 ? 'essen' : 'isst'} nicht mit` : null;
  return (
    <Row
      title={<span><span className="pm-rowtitle"><b>{SLOT_LABEL[meal.slot]}</b> · {meal.dish.title}</span>{meal.dish.side && <small className="pm-sidehint">dazu: {sideText(meal.dish.side)}</small>}{note && <small className="pm-dev">{note}</small>}</span>}
      value={meal.reuseOf ? 'Rest' : `${meal.dish.minutes} Min`} onClick={onOpen} />
  );
}

/** The stored section stays "Vorrat" (server data); the list says what the shelf is. */
const SECTION_LABEL: Record<string, string> = { Sonstiges: 'Weiteres', Vorrat: 'Trockenware' };

/** One flat list with small headings. Tick to buy; "Haben wir" sits at the right of each open row, an own item has a confirmed "Entfernen". Items already at home have no box. Bought items sink to the end of their group. */
function Shopping({ week, onSet, onOwn }: { week: Week; onSet: (item: string, state: ItemState) => void; onOwn: (f: (s: MealState, at: number) => MealState) => void }) {
  const list = shoppingList(week.plan, week.state);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const row = (i: ShopItem) => {
    const own = isOwnKey(i.key);
    const bought = i.state === 'gekauft';
    const home = i.state === 'da';
    return (
      <li key={i.key} className={`pm-item ${i.state}`}>
        <div className={`pm-itemline${home ? ' nobox' : ''}`}>
          {!home && (
            <button type="button" className="pm-check" role="checkbox" aria-checked={bought} aria-label={`${i.name} gekauft`}
              onClick={() => (own ? onOwn((s, at) => changeOwn(s, i.key, { state: bought ? 'offen' : 'gekauft' }, at)) : onSet(i.key, NEXT[i.state]))}>{bought ? '✓' : ''}</button>
          )}
          <span className="pm-name">{i.name}{i.amount && <small className="muted">{i.amount}</small>}</span>
          {own
            ? <ConfirmLink label="Entfernen" question="Wirklich entfernen?" onConfirm={() => onOwn((s, at) => changeOwn(s, i.key, { removed: true }, at))} />
            : !bought && <button type="button" className="link pm-have" onClick={() => onSet(i.key, home ? 'offen' : 'da')}>{home ? 'Doch kaufen' : 'Haben wir'}</button>}
        </div>
      </li>
    );
  };
  const group = (title: string, items: ShopItem[], cls = '') => {
    // Bought items go to the end of their group.
    const sorted = [...items.filter((i) => i.state !== 'gekauft'), ...items.filter((i) => i.state === 'gekauft')];
    return items.length === 0 ? null : <section key={title} className={`pm-group ${cls}`}><h3 className="tk-section">{title}</h3><ul>{sorted.map(row)}</ul></section>;
  };
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const key = newOwnKey();
    setName(''); setAmount('');
    onOwn((s, at) => withOwn(s, key, n, amount, at));
  };
  const people = week.plan.people.length;
  return (
    <>
      <p className="muted pm-meta">für Mo–So, {people} {people === 1 ? 'Person' : 'Personen'}</p>
      <form className="pm-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="pm-addline">
          <input aria-label="Etwas dazuschreiben" placeholder="Etwas dazuschreiben …" maxLength={OWN_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Menge (optional)" placeholder="Menge (optional)" maxLength={OWN_AMOUNT_MAX} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button type="submit" className="secondary" disabled={!name.trim()}>Hinzufügen</button>
      </form>
      {list.total === 0 && list.own.length === 0 && <p className="muted">Diese Woche gibt es nichts einzukaufen.</p>}
      {list.sections.map((s) => group(SECTION_LABEL[s.section] ?? s.section, s.items))}
      {group('Kleine Mengen, schau kurz nach', list.pantry)}
      {group('Eigenes', list.own)}
      {group('Schon da', list.have, 'pm-have-list')}
    </>
  );
}

/** The account's meal records and everything written back to them (state, recipes, hearts, places), shared by Essen and Heute. */
export function useMealData(port: WebPort, now: () => number, fetchFn: typeof fetch) {
  const records = usePortRecords(port, 'mealplan').records;
  const t = now();
  const weeks = useMemo(() => mealWeeks(records, t), [records, t]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const favs = useMemo(() => favouriteIds(records), [records]);
  const placed = useMemo(() => placements(records), [records]);
  /** One at a time, each on the freshest stored state, so quick taps never undo each other. The newer entry wins on the Mac. */
  const change = (weekKey: string, f: (s: MealState, at: number) => MealState) => {
    const id = stateRecordId(weekKey);
    queue.current = queue.current.then(async () => {
      const at = now();
      const have = (await port.list('mealplan')).find((r) => r.id === id);
      await port.put({ kind: 'mealplan', id, updatedMs: nextUpdatedMs(at, have), deleted: false, body: f(readMealState(have?.deleted ? undefined : have?.body), at) });
    }).catch(() => { /* shown as before; nothing lost */ });
    return queue.current;
  };
  /** A heart: a record of its own per recipe, a tombstone when it is taken back. It syncs like any record, also when made offline. */
  const toggleFav = (id: string, on: boolean) => {
    void (async () => {
      const rid = favRecordId(id);
      const have = (await port.list('mealplan')).find((r) => r.id === rid);
      const at = now();
      await port.put({ kind: 'mealplan', id: rid, updatedMs: nextUpdatedMs(at, have), deleted: !on, body: { atMs: at } }).catch(() => { /* the heart stays as it was */ });
    })();
  };
  /** "In den Plan": a record the coach answers, like a link. */
  const place = async (w: string, meal: string, recipeId: string) => {
    const at = now();
    await port.put({ kind: 'mealplan', id: newPlaceId(at), updatedMs: at, deleted: false, body: { week: w, meal, recipeId, atMs: at, result: null, answeredMs: null } }).catch(() => { /* nothing was sent; try again */ });
  };
  const recipeCtx: RecipeCtx = { fetchFn, now, favs, toggleFav, weeks, place, placements: placed };
  return { records, weeks, change, favs, recipeCtx };
}

/** The meals of today on Heute, calm: a row card per slot, a quiet line for what is cooked today for later. A tap opens the meal page in Essen. Reads only; writes go through useMealData. */
export function DayMeals({ port, now, onOpen }: { port: WebPort; now: () => number; onOpen: (at: MealAt) => void }) {
  const records = usePortRecords(port, 'mealplan').records;
  const found = useMemo(() => mealDayOf(records, now()), [records, now]);
  const heading = 'Essen heute';
  const week = found?.week;
  const today = found?.day ?? 0;
  const meals = week ? SLOTS.flatMap((slot) => week.plan.meals.filter((m) => m.day === today && m.slot === slot)) : [];
  if (!week || meals.length === 0) return null;
  const label = (m: Meal) => {
    if (!m.reuseOf) return undefined; // the time it takes belongs in the plan, not on Heute
    const from = Number(m.reuseOf.split('-')[0]);
    return from === today ? 'vorgekocht' : from === today - 1 ? 'Rest von gestern' : `Rest von ${DAY_SHORT[from]}`;
  };
  // Cooked today, eaten again later (a later day, or the evening for a midday dish): "Heute vorkochen".
  const ahead = meals.filter((m) => !m.reuseOf && week.plan.meals.some((r) => r.reuseOf === mealKey(m.day, m.slot) && (r.day > m.day || SLOTS.indexOf(r.slot) > SLOTS.indexOf(m.slot))));
  return (
    <section aria-label={heading}>
      <h2 className="tk-section">{heading}</h2>
      <div className="tk-rowcards" role="list" aria-label={heading}>
        {meals.map((m) => (
          <div role="listitem" key={m.slot}>
            <RowCard icon="essen" kicker={SLOT_LABEL[m.slot]} title={m.dish.side ? `${m.dish.title} + ${m.dish.side.name}` : m.dish.title} sub={label(m)} onClick={() => onOpen({ week: week.plan.week, meal: mealKey(m.day, m.slot) })} />
          </div>
        ))}
      </div>
      {ahead.length > 0 && <p className="muted">Heute vorkochen: {ahead.map((m) => m.dish.title).join(', ')}</p>}
    </section>
  );
}

/** The meal plan on the phone: one day at a time with a day picker, and the shopping list. Ticks and who eats go back to the Mac. */
export function MealsScreen({ port, now, fetchFn, account, entry, onEntryDone, onHeute }: { port: WebPort; now: () => number; fetchFn: typeof fetch; account?: string; /** Heute asked for a meal: the page opens on it, once. */ entry?: MealAt | null; onEntryDone?: () => void; onHeute?: () => void }) {
  const data = useMealData(port, now, fetchFn);
  const { records, weeks, change: changeWeek, recipeCtx } = data;
  const [page, setPage] = useState<Page>(() => (entry ? { name: 'meal', at: entry, from: 'heute' } : { name: 'start' }));
  useEffect(() => { if (entry) { setPage({ name: 'meal', at: entry, from: 'heute' }); onEntryDone?.(); } }, [entry, onEntryDone]);
  const t = now();
  const current = weekOf(t);
  const today = dayIndex(t);
  const first = (today >= 5 && weeks.find((w) => w.plan.week !== current)) || weeks.find((w) => w.plan.week === current) || weeks[0];
  // Records arrive after the first render: nothing chosen yet means the default, decided once they are there.
  const [weekKey, setWeekKey] = useState<string | null>(null);
  const week = weeks.find((w) => w.plan.week === weekKey) ?? first;
  const isCurrent = week?.plan.week === current;
  const [dayPick, setDay] = useState<number | null>(null);
  const day = dayPick ?? (isCurrent ? today : 0);
  const [tab, setTab] = useState<'tage' | 'einkauf'>('tage');
  const [chatOpen, setChatOpen] = useState(false);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const chat = useMemo(() => mealChats(records), [records]);
  const requests = useMemo(() => linkRequests(records), [records]);
  if (page.name === 'meal') {
    const from = page.from;
    return <MealPage data={data} at={page.at} me={account} backLabel={from === 'heute' ? 'Heute' : 'Essen'} onBack={() => { if (from === 'heute') onHeute?.(); else setPage({ name: 'start' }); }} />;
  }
  if (!week) return <div className="tk-screen"><PageHead title="Essen" /><p className="muted">Noch kein Essensplan. Er kommt am Samstagmorgen für die nächste Woche.</p></div>;

  const change = (f: (s: MealState, at: number) => MealState) => changeWeek(week.plan.week, f);
  /** A link to add: a record of its own, answered by the coach on the server. */
  const addLink = async (url: string) => {
    const at = now();
    await port.put({ kind: 'mealplan', id: newLinkId(at), updatedMs: at, deleted: false, body: { url, atMs: at, result: null, answeredMs: null } }).catch(() => { /* the field is empty again; nothing else is lost */ });
  };
  /** Deleting the record deletes the recipe: the coach sees the tombstone. */
  const deleteRecipe = async (recipeId: string) => {
    const id = `recipe-${recipeId}`;
    const have = (await port.list('mealplan')).find((r) => r.id === id);
    if (!have) return;
    await port.put({ ...have, updatedMs: nextUpdatedMs(now(), have), deleted: true }).catch(() => { /* still there; try again */ });
  };
  /** A new record of its own: only the Mac writes it again, with the reply. */
  const say = async (text: string) => {
    const at = now();
    await port.put({ kind: 'mealplan', id: newChatId(at), updatedMs: at, deleted: false, body: { week: week.plan.week, text, atMs: at, reply: null, answeredMs: null, changed: [] } }).catch(() => { /* the field stays empty; nothing else is lost */ });
  };
  const list = shoppingList(week.plan, week.state);
  const openCount = list.open + list.own.filter((o) => o.state === 'offen').length;
  const pick = (w: Week) => { setWeekKey(w.plan.week); setDay(w.plan.week === current ? today : 0); };
  return (
    <div className="tk-screen pm">
      <PageHead title="Essen" subtitle={`${isCurrent ? 'Diese Woche' : 'Nächste Woche'}, ${weekRangeOfKey(week.plan.week)}`} />
      {weeks.length > 1 && (
        <div className="tk-textseg" role="group" aria-label="Woche">
          {weeks.map((w) => <button key={w.plan.week} type="button" className="link" aria-pressed={w === week} onClick={() => pick(w)}>{w.plan.week === current ? 'Diese Woche' : 'Nächste Woche'}</button>)}
        </div>
      )}
      <Segments label="Ansicht" value={tab} onChange={setTab} options={[{ value: 'tage', label: 'Tage' }, { value: 'einkauf', label: `Einkauf${openCount > 0 ? ` · ${openCount} offen` : ''}` }]} />
      {tab === 'tage' ? (
        <>
          <div className="pm-days" role="tablist" aria-label="Tag">
            {DAY_SHORT.map((d, i) => (
              <button key={d} type="button" role="tab" aria-selected={i === day} className={`${isCurrent && i === today ? 'today' : ''}${isCurrent && i < today ? ' past' : ''}`} onClick={() => { setDay(i); }}>
                <b>{d}</b><span>{dayDate(week.plan.week, i).split('.')[0]}</span>
              </button>
            ))}
          </div>
          <h2 className="pm-dayname">{isCurrent && day === today ? 'Heute' : DAY_LONG[day]}{week.plan.trainingDays.includes(day) && <small> · Trainingstag</small>}</h2>
          <RowList label="Mahlzeiten">
            {SLOTS.map((slot) => {
              const m = week.plan.meals.find((x) => x.day === day && x.slot === slot);
              if (!m) return <Row key={slot} title={SLOT_LABEL[slot]} value="Frei" />;
              const k = mealKey(m.day, m.slot);
              return <MealRow key={slot} week={week} meal={m} onOpen={() => setPage({ name: 'meal', at: { week: week.plan.week, meal: k }, from: 'essen' })} />;
            })}
          </RowList>
          {chatOpen && <ChatSheet chat={chat} onSend={say} onClose={() => setChatOpen(false)} />}
          <RowList label="Rezepte">
            <Row title="Rezepte" value={recipeCtx.favs.size > 0 ? `${recipeCtx.favs.size} Favoriten` : undefined} onClick={() => setRecipesOpen(true)} />
            <Row title="Änderung wünschen" onClick={() => setChatOpen(true)} />
          </RowList>
          {recipesOpen && <RecipesSheet ctx={{ ...recipeCtx, deleteOwn: (id) => void deleteRecipe(id) }} onAddLink={() => setAddOpen(true)} onClose={() => setRecipesOpen(false)} />}
          {addOpen && <AddRecipeSheet requests={requests} onAdd={addLink} onClose={() => setAddOpen(false)} />}
        </>
      ) : <Shopping key={week.plan.week} week={week} onSet={(item, state) => void change((s, at) => withItem(s, item, state, at))} onOwn={(f) => void change(f)} />}
    </div>
  );
}
