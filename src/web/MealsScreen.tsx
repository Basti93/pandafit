import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { nextUpdatedMs } from '../tracking/ui/run-view';
import type { TrackedRecord } from '../shared/records';
import {
  favouriteIds, favRecordId, newPlaceId, CHAT_MAX_CHARS, isLinkRecordId, LINK_URL_MAX, linkAnswer, newLinkId, readLinkRequest, safeLink, isChatRecordId, newChatId, readMealChat, DAY_SHORT, mealKey, readMealState,
  SLOT_LABEL, SLOTS, stateRecordId,
  type LinkRequest, type Meal, type MealChat, type MealState,
} from '../shared/meals';
import type { WebPort } from './webPort';
import { usePortRecords } from '../tracking/ui/hooks';
import { RowCard, Sheet } from '../tracking/ui/kit';
import { mealDayOf, mealWeeks, shoppingWeek, type MealAt, type Week } from './essen/meals-view';
import { EssenStart } from './essen/EssenStart';
import { MealPage } from './essen/MealPage';
import { ShoppingPage } from './essen/ShoppingPage';
import { placements, RecipesSheet, type RecipeCtx } from './RecipesScreen';

export type { Week };
export type MealData = ReturnType<typeof useMealData>;
type Page = { name: 'start' } | { name: 'einkauf' } | { name: 'meal'; at: MealAt; from: 'essen' | 'heute' };
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

/** "Plan ändern": written as a record, answered by the Mac at its next sync with no ride open. */
function ChatSheet({ chat, onSend, onClose }: { chat: MealChat[]; onSend: (text: string) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const formId = useId();
  const [last, ...before] = [...chat].reverse();
  const submit = () => { const t = text.trim(); if (!t) return; setText(''); setSent(true); void onSend(t); };
  return (
    <Sheet title="Plan ändern" onClose={onClose} actions={<button type="submit" className="primary" form={formId} disabled={!text.trim()}>Senden</button>}>
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

/** Essen: the start page, and its sub pages (a meal, the shopping list) in local state. Ticks and who eats go back to the Mac. */
export function MealsScreen({ port, now, fetchFn, account, entry, onEntryDone, onHeute }: { port: WebPort; now: () => number; fetchFn: typeof fetch; account?: string; /** Heute asked for a meal: the page opens on it, once. */ entry?: MealAt | null; onEntryDone?: () => void; onHeute?: () => void }) {
  const data = useMealData(port, now, fetchFn);
  const { records, weeks, change: changeWeek, recipeCtx } = data;
  const [page, setPage] = useState<Page>(() => (entry ? { name: 'meal', at: entry, from: 'heute' } : { name: 'start' }));
  useEffect(() => { if (entry) onEntryDone?.(); }, [entry, onEntryDone]);
  const t = now();
  const first = shoppingWeek(weeks, t); // the week Einkauf shows first, also the one "Plan ändern" writes for
  const [chatOpen, setChatOpen] = useState(false);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const chat = useMemo(() => mealChats(records), [records]);
  const requests = useMemo(() => linkRequests(records), [records]);
  if (page.name === 'meal') {
    const from = page.from;
    return <MealPage data={data} at={page.at} me={account} backLabel={from === 'heute' ? 'Heute' : 'Essen'} onBack={() => { if (from === 'heute') onHeute?.(); else setPage({ name: 'start' }); }} />;
  }
  if (page.name === 'einkauf') return <ShoppingPage weeks={weeks} nowMs={t} change={changeWeek} onBack={() => setPage({ name: 'start' })} />;

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
  /** A new record of its own: only the Mac writes it again, with the reply. The week is the one Einkauf shows first. */
  const say = async (text: string) => {
    const at = now();
    await port.put({ kind: 'mealplan', id: newChatId(at), updatedMs: at, deleted: false, body: { week: first?.plan.week, text, atMs: at, reply: null, answeredMs: null, changed: [] } }).catch(() => { /* the field stays empty; nothing else is lost */ });
  };
  return (
    <>
      <EssenStart data={data} nowMs={t} me={account} onMeal={(at) => setPage({ name: 'meal', at, from: 'essen' })} onShopping={() => setPage({ name: 'einkauf' })} onRecipes={() => setRecipesOpen(true)} onChat={() => setChatOpen(true)} />
      {chatOpen && <ChatSheet chat={chat} onSend={say} onClose={() => setChatOpen(false)} />}
      {recipesOpen && <RecipesSheet ctx={{ ...recipeCtx, deleteOwn: (id) => void deleteRecipe(id) }} onAddLink={() => setAddOpen(true)} onClose={() => setRecipesOpen(false)} />}
      {addOpen && <AddRecipeSheet requests={requests} onAdd={addLink} onClose={() => setAddOpen(false)} />}
    </>
  );
}
