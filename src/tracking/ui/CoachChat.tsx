import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chatThread, proposalAnswer, waitingMessage, MAX_CHAT_TEXT, type ChatEntry, type ChatMessage } from '../../shared/chat';
import { mondayOf, type WeekProposal } from '../../shared/week-plan';
import { dayHeading, dayMonthOfKey, localDayKey, shortDateOfKey } from '../../shared/dates';
import type { TrackingPort } from '../ports';
import { takeWeekPlan, undoWeekPlan, weekUndoRefusal } from '../week-take';
import { DECLINE, DECLINED, TAKE, UNDO } from '../../shared/wording';
import { NextChangeCard } from './NextChangeCard';
import { RuleCard } from './RuleCard';
import { ChatBubble, ChatNote } from './ChatBubble';
import { Week } from './WeekList';
import { planRows } from './done-days';
import { openProposals, storedWeek, weekAnswer } from './chat-open';
import { useCatalog, usePortRecords } from './hooks';
import { Sheet } from './kit';

/** The chat shows this many of the newest messages, and this many more each time. */
const CHAT_PAGE = 30;
/** Waiting longer than this for an answer: say so calmly. */
const SLOW_MS = 3 * 60_000;
/** The coach no longer answers messages this old. */
const STALE_MS = 2 * 86_400_000;

type WeekEntry = ChatEntry & { proposal: WeekProposal };

const when = (p: WeekProposal) => `ab ${dayMonthOfKey(p.weekStart)}`;

/** A week plan in the history: one line, with Rückgängig while it can be undone. Open ones are pinned and never get here. */
function ProposalLine({ m, answer, undoWhy, past, loading, onUndo }: { m: WeekEntry; answer: 'taken' | 'declined' | 'undone' | null; undoWhy: string | null; past: boolean; loading: boolean; onUndo: () => void }) {
  const p = m.proposal;
  if (answer === null) return past ? <p className="muted">Diese Woche ist vorbei.</p> : null;
  if (answer === 'undone') return <p className="muted">Wochenplan rückgängig gemacht ({when(p)})</p>;
  if (answer === 'declined') return <p className="muted">{DECLINED} ({when(p)})</p>;
  return (
    <div className="tk-histline">
      <span className="muted">Übernommen: Wochenplan ({when(p)})</span>
      {!loading && undoWhy === null && <button type="button" className="link" onClick={onUndo}>{UNDO}</button>}
      {!loading && undoWhy && <span className="muted">{undoWhy}</span>}
    </div>
  );
}

/** A week plan that waits for an answer: the seven days and Übernehmen / Nein danke. */
function PinnedWeek({ m, warnings, loading, onTake, onDecline }: { m: WeekEntry; warnings?: string[]; loading: boolean; onTake: () => void; onDecline: () => void }) {
  const p = m.proposal;
  return (
    <div className="tk-pin" role="group" aria-label={`Vorschlag Wochenplan ${when(p)}`}>
      <b>Vorschlag: Woche {when(p)}</b>
      <Week rows={planRows(p.days)} label={`Vorschlag für die Woche ab ${shortDateOfKey(p.weekStart)}`} />
      {warnings && warnings.length > 0 && <p className="tk-note">Mehr als unsere Regeln für Erholung empfehlen: {warnings.join(' ')}</p>}
      <div className="tk-row">
        <button type="button" disabled={loading} onClick={onTake}>{TAKE}</button>
        <button type="button" className="link" onClick={onDecline}>{DECLINE}</button>
      </div>
    </div>
  );
}

/**
 * The chat with the coach, full screen: messages oldest to newest, scrolled to the newest on open, the input fixed at the bottom.
 * Proposals that wait for an answer sit behind one slim strip above the input ("2 Vorschläge ›"); once answered they are one line in the history.
 * Proposals change nothing until the rider takes them.
 */
export function CoachChat({ port, now, newId, onClose }: { port: TrackingPort; now: () => number; newId: () => string; onClose: () => void }) {
  const chat = usePortRecords(port, 'chat').all;
  const plans = usePortRecords(port, 'weekplan').all;
  const changeRecs = usePortRecords(port, 'change').all;
  const ruleRecs = usePortRecords(port, 'rule').all;
  const catalog = useCatalog(port);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(CHAT_PAGE);
  const [proposalsOpen, setProposalsOpen] = useState(false);
  const grew = useRef<{ top: number; height: number } | null>(null);
  const thread = chatThread(chat ?? []);
  const waiting = waitingMessage(thread);
  const visible = thread.filter((m) => !(m.takes || m.declines || m.undoes));
  const monday = mondayOf(localDayKey(now()));
  const pinned = openProposals(thread, plans ?? [], changeRecs ?? [], ruleRecs ?? [], monday);
  useEffect(() => { if (pinned.length === 0) setProposalsOpen(false); }, [pinned.length]);
  const scroller = () => endRef.current?.closest('.tk-sheet-body') as HTMLElement | null;

  // Opening and a new message scroll to the end; loading older ones keeps what the person was looking at where it was.
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [thread.length, pinned.length]);
  useLayoutEffect(() => {
    const g = grew.current;
    grew.current = null;
    const el = scroller();
    if (!g || !el) return;
    el.scrollTop = g.top + (el.scrollHeight - g.height);
  }, [shown]);
  const older = () => { const el = scroller(); if (el) grew.current = { top: el.scrollTop, height: el.scrollHeight }; setShown((n) => n + CHAT_PAGE); };

  const write = async (m: ChatMessage) => {
    setError(null);
    try { await port.put({ kind: 'chat', id: newId(), updatedMs: now(), deleted: false, body: m }); return true; } catch { setError('Konnte nicht gespeichert werden. Versuch es gleich nochmal.'); return false; }
  };
  const send = async () => {
    const t = text.trim().slice(0, MAX_CHAT_TEXT);
    if (!t) return;
    if (await write({ role: 'rider', text: t, atMs: now() })) setText('');
  };
  const take = async (m: WeekEntry) => {
    setError(null);
    try {
      const res = await takeWeekPlan(port, { proposal: m.proposal, changeId: m.id, shownMs: m.atMs, now: now() });
      if (!res.ok) { setError(res.reason); return; }
      await write({ role: 'rider', text: 'Übernommen.', atMs: now(), takes: m.id });
    } catch { setError('Der Plan konnte nicht gespeichert werden. Versuch es gleich nochmal.'); }
  };
  const undo = async (m: WeekEntry) => {
    setError(null);
    try {
      const res = await undoWeekPlan(port, { proposal: m.proposal, changeId: m.id, now: now() });
      if (res.ok) await write({ role: 'rider', text: 'Wochenplan rückgängig gemacht.', atMs: now(), undoes: m.id }); else setError(res.reason);
    } catch { setError('Der Plan konnte nicht gespeichert werden. Versuch es gleich nochmal.'); }
  };
  const decline = (m: ChatEntry) => void write({ role: 'rider', text: 'Nein danke.', atMs: now(), declines: m.id });

  // Open proposals are not stacked above the input: one slim strip opens them in a small sheet, with the same take and decline buttons.
  const strip = pinned.length > 0 && (
    <button type="button" className="tk-strip" aria-haspopup="dialog" onClick={() => setProposalsOpen(true)}>
      <span>{pinned.length === 1 ? '1 Vorschlag' : `${pinned.length} Vorschläge`}</span><span aria-hidden="true">›</span>
    </button>
  );
  const pins = (
    <>
      {strip}
      {error && <p role="alert" className="tk-note">{error}</p>}
      <form className="tk-chat-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea aria-label="Nachricht an den Coach" rows={1} value={text} maxLength={MAX_CHAT_TEXT} onChange={(e) => setText(e.target.value)} placeholder="Nachricht an den Coach" />
        <button type="submit" className="tk-send" aria-label="Senden" disabled={!text.trim()}>↑</button>
      </form>
    </>
  );

  return (
    <Sheet title="Coach" onClose={onClose} actions={pins}>
      <section className="tk-chat" aria-label="Unterhaltung mit dem Coach">
        {thread.length === 0 && <p className="muted">Zum Beispiel: „4 Tage diese Woche, Freitag bin ich sicher im Studio“ oder „Schlag mir eine Woche vor“.</p>}
        {visible.length > shown && <button type="button" className="link" onClick={older}>Ältere anzeigen</button>}
        {visible.slice(-shown).map((m, i, list) => (
          <Fragment key={m.id}>
            {(i === 0 || localDayKey(list[i - 1]!.atMs) !== localDayKey(m.atMs)) && <p className="muted tk-day" role="separator">{dayHeading(m.atMs, now())}</p>}
            <ChatBubble m={m}>
              {m.nextChange && <NextChangeCard history port={port} changeId={m.nextChange} records={changeRecs} now={now} />}
              {m.rule && <RuleCard history port={port} ruleId={m.rule} records={ruleRecs} catalog={catalog} now={now} />}
              {m.proposal && <ProposalLine m={m as WeekEntry} answer={weekAnswer(proposalAnswer(thread, m.id), thread.some((x) => x.undoes === m.id), storedWeek(plans ?? [], m.proposal.weekStart), m.id)} undoWhy={weekUndoRefusal(storedWeek(plans ?? [], m.proposal.weekStart), m.proposal, m.id)} onUndo={() => void undo(m as WeekEntry)} past={m.proposal.weekStart < monday} loading={plans === null} />}
            </ChatBubble>
          </Fragment>
        ))}
        {waiting && <ChatNote>{now() - waiting.atMs > STALE_MS ? 'Darauf kam keine Antwort mehr. Schreib gern nochmal.' : now() - waiting.atMs > SLOW_MS ? 'Der Coach antwortet, sobald er wieder erreichbar ist.' : 'Der Coach denkt nach …'}</ChatNote>}
        <div ref={endRef} />
      </section>
      {proposalsOpen && pinned.length > 0 && (
        <Sheet size="small" title={pinned.length === 1 ? 'Vorschlag' : 'Vorschläge'} onClose={() => setProposalsOpen(false)}>
          <div className="tk-pins">
            {pinned.map((m) => (
              <Fragment key={m.id}>
                {m.proposal && <PinnedWeek m={m as WeekEntry} warnings={m.warnings} loading={plans === null} onTake={() => void take(m as WeekEntry)} onDecline={() => decline(m)} />}
                {m.nextChange && <div className="tk-pin"><NextChangeCard port={port} changeId={m.nextChange} records={changeRecs} now={now} /></div>}
                {m.rule && <div className="tk-pin"><RuleCard port={port} ruleId={m.rule} records={ruleRecs} catalog={catalog} now={now} /></div>}
              </Fragment>
            ))}
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}
