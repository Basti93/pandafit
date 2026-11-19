import { useState } from 'react';
import { ownWeekOf, tickWrites, windowShoppingList, type WindowList } from '../../shared/meal-list';
import {
  changeOwn, isOwnKey, newOwnKey, OWN_AMOUNT_MAX, OWN_NAME_MAX, withItem, withOwn,
  type ItemState, type MealState, type ShopItem,
} from '../../shared/meals';
import { Card, ConfirmLink } from '../../tracking/ui/kit';
import type { MealData } from '../MealsScreen';
import { EssenPage } from './EssenPage';
import { shoppingSentence, type Week } from './meals-view';

const NEXT: Record<ItemState, ItemState> = { offen: 'gekauft', gekauft: 'offen', da: 'offen' };

/** The stored section stays "Vorrat" (server data); the list says what the shelf is. */
const SECTION_LABEL: Record<string, string> = { Sonstiges: 'Weiteres', Vorrat: 'Trockenware' };

/** One list of calm cards. Tick to buy; "Haben wir" sits at the right of each open row, an own item has a confirmed "Entfernen". Items already at home have no box. Bought items sink to the end of their group. */
function Shopping({ list, onSet, onOwn, onAdd }: { list: WindowList; onSet: (item: string, state: ItemState) => void; onOwn: (week: string | undefined, f: (s: MealState, at: number) => MealState) => void; onAdd: (f: (s: MealState, at: number) => MealState) => void }) {
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
              onClick={() => (own ? onOwn(i.week, (s, at) => changeOwn(s, i.key, { state: bought ? 'offen' : 'gekauft' }, at)) : onSet(i.key, NEXT[i.state]))}>{bought ? '✓' : ''}</button>
          )}
          <span className="pm-name">{i.name}{i.amount && <small className="muted">{i.amount}</small>}</span>
          {own
            ? <ConfirmLink label="Entfernen" question="Wirklich entfernen?" onConfirm={() => onOwn(i.week, (s, at) => changeOwn(s, i.key, { removed: true }, at))} />
            : !bought && <button type="button" className="link pm-have" onClick={() => onSet(i.key, home ? 'offen' : 'da')}>{home ? 'Doch kaufen' : 'Haben wir'}</button>}
        </div>
      </li>
    );
  };
  const group = (title: string, items: ShopItem[], cls = '') => {
    // Bought items go to the end of their group.
    const sorted = [...items.filter((i) => i.state !== 'gekauft'), ...items.filter((i) => i.state === 'gekauft')];
    return items.length === 0 ? null : (
      <Card soft label={title} key={title}>
        <h2 className="tk-section">{title}</h2>
        <ul className={`pm-list ${cls}`}>{sorted.map(row)}</ul>
      </Card>
    );
  };
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const key = newOwnKey();
    setName(''); setAmount('');
    onAdd((s, at) => withOwn(s, key, n, amount, at));
  };
  return (
    <>
      <Card>
        <form className="pm-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="pm-addline">
            <input aria-label="Etwas dazuschreiben" placeholder="Etwas dazuschreiben …" maxLength={OWN_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
            <input aria-label="Menge (optional)" placeholder="Menge (optional)" maxLength={OWN_AMOUNT_MAX} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <button type="submit" className="secondary" disabled={!name.trim()}>Hinzufügen</button>
        </form>
      </Card>
      {list.total === 0 && list.own.length === 0 && <p className="muted">Für die nächsten Tage gibt es nichts einzukaufen.</p>}
      {list.sections.map((s) => group(SECTION_LABEL[s.section] ?? s.section, s.items))}
      {group('Kleine Mengen, schau kurz nach', list.pantry)}
      {group('Eigenes', list.own)}
      {group('Schon da', list.have, 'pm-have-list')}
    </>
  );
}

/** Einkauf as a page of Essen: one list for the next seven days over both week records. A tick is written into every week it covers. */
export function ShoppingPage({ weeks, nowMs, change, onBack }: { weeks: Week[]; nowMs: number; change: MealData['change']; onBack: () => void }) {
  const list = windowShoppingList(weeks, nowMs);
  const sentence = shoppingSentence(list, nowMs);
  const set = (key: string, state: ItemState) => { for (const w of tickWrites(weeks, nowMs, key, state)) void change(w.week, (s, at) => withItem(s, key, state, at, w.cover)); };
  const own = (week: string | undefined, f: (s: MealState, at: number) => MealState) => { if (week) void change(week, f); };
  const add = (f: (s: MealState, at: number) => MealState) => { const week = ownWeekOf(weeks, nowMs); if (week) void change(week, f); };
  return (
    <EssenPage title="Einkauf" back={{ label: 'Essen', onClick: onBack }}>
      <div className="tk-screen pm">
        {weeks.length > 0 ? (
          <>
            {sentence && <p className="muted pm-meta">{sentence}</p>}
            <Shopping list={list} onSet={set} onOwn={own} onAdd={add} />
          </>
        ) : <p className="muted">Es gibt noch keinen Plan, also auch keine Liste.</p>}
      </div>
    </EssenPage>
  );
}
