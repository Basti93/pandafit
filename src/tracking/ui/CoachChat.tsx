import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chatThread, proposalAnswer, waitingMessage, MAX_CHAT_TEXT, type ChatMessage } from '../../shared/chat';
import { mondayOf, type WeekProposal } from '../../shared/week-plan';
import { dayHeading, dayMonthOfKey, localDayKey } from '../../shared/dates';
import type { TrackingPort } from '../ports';
import { weekUndoRefusal } from '../week-take';
import { UNDO } from '../../shared/wording';
import { NextChangeCard } from './NextChangeCard';
import { RuleCard } from './RuleCard';
import { ProposalCard, ProposalsSheet } from './ProposalCard';
import { useOpenProposals, useProposalActions, type WeekEntry } from './proposals';
import { ChatBubble, ChatNote } from './ChatBubble';
import { storedWeek, weekAnswer } from './chat-open';
import { useCatalog, usePortRecords } from './hooks';
import { Icon, RowCard, Sheet } from './kit';
import { BO, BO_LINES } from './bo';
import { PandaPortrait } from './PandaPortrait';
import { dateLabel } from './labels';
import { newestNotes } from '../../shared/change-notes';
import { readStats, STATS_ID } from '../../shared/stats';

/** The chat shows this many of the newest messages, and this many more each time. */
const CHAT_PAGE = 30;
/** Waiting longer than this for an answer: say so calmly. */
const SLOW_MS = 3 * 60_000;
/** The coach no longer answers messages this old. */
const STALE_MS = 2 * 86_400_000;

const when = (p: WeekProposal) => `ab ${dayMonthOfKey(p.weekStart)}`;

/** A week plan in the history: one line, with Rückgängig while it can be undone. The open one stands in its bubble as a ProposalCard. */
function ProposalLine({ m, answer, undoWhy, past, loading, onUndo }: { m: WeekEntry; answer: 'taken' | 'declined' | 'undone' | null; undoWhy: string | null; past: boolean; loading: boolean; onUndo: () => void }) {
  const p = m.proposal;
  if (answer === null) return past ? <p className="muted">Diese Woche ist vorbei.</p> : null;
  if (answer === 'undone') return <p className="muted">Du hast den Wochenplan {when(p)} rückgängig gemacht.</p>;
  if (answer === 'declined') return <p className="muted">Du hast den Wochenplan {when(p)} abgelehnt.</p>;
  return (
    <div className="tk-histline">
      <span className="muted">Du hast den Wochenplan {when(p)} übernommen.</span>
      {!loading && undoWhy === null && <button type="button" className="link" onClick={onUndo}>{UNDO}</button>}
      {!loading && undoWhy && <span className="muted">{undoWhy}</span>}
    </div>
  );
}

/**
 * The chat with Bo, a page over the tab bar: messages oldest to newest, scrolled to the newest on open, the input fixed at the bottom.
 * The first open proposal stands in its bubble with Übernehmen and Nein danke; the others wait behind one strip above the input.
 * Answered ones are one line in the history. Proposals change nothing until the rider takes them.
 */
export function CoachChat({ port, now, newId, onClose }: { port: TrackingPort; now: () => number; newId: () => string; onClose: () => void }) {
  const chat = usePortRecords(port, 'chat').all;
  const plans = usePortRecords(port, 'weekplan').all;
  const changeRecs = usePortRecords(port, 'change').all;
  const ruleRecs = usePortRecords(port, 'rule').all;
  const catalog = useCatalog(port);
  const statsRecords = usePortRecords(port, 'stats').all;
  const statsRec = (statsRecords ?? []).find((x) => x.id === STATS_ID && !x.deleted);
  const notes = newestNotes((statsRec && readStats(statsRec.body)?.changes) || [], 5);
  const noteText = (n: { text: string; reason?: string }) => `${n.text}${n.reason ? `, ${n.reason}` : ''}`;
  const [notesOpen, setNotesOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(CHAT_PAGE);
  const [moreOpen, setMoreOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const grew = useRef<{ top: number; height: number } | null>(null);
  const thread = chatThread(chat ?? []);
  const waiting = waitingMessage(thread);
  const visible = thread.filter((m) => !(m.takes || m.declines || m.undoes));
  const monday = mondayOf(localDayKey(now()));
  // The week plan is the biggest decision: it comes first (useOpenProposals sorts it so).
  const open = useOpenProposals(port, now());
  const window = visible.slice(-shown);
  // The first open proposal stands in its bubble; if that message is older than the shown ones, it waits behind the strip with the others.
  const first = open[0] && window.some((m) => m.id === open[0]!.id) ? open[0] : undefined;
  const rest = open.filter((m) => m.id !== first?.id);
  const { undo, error: undoError } = useProposalActions(port, now, newId);
  // The sheet never opens by itself: once the last waiting proposal is answered, forget that it was open.
  if (moreOpen && rest.length === 0) setMoreOpen(false);
  const showMore = moreOpen && rest.length > 0;
  const scroller = () => endRef.current?.closest('.tk-sheet-body') as HTMLElement | null;

  // Opening and a new message scroll to the end; loading older ones keeps what the person was looking at where it was.
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [thread.length, open.length]);
  useLayoutEffect(() => {
    const g = grew.current;
    grew.current = null;
    const el = scroller();
    if (!g || !el) return;
    el.scrollTop = g.top + (el.scrollHeight - g.height);
  }, [shown]);
  const older = () => { const el = scroller(); if (el) grew.current = { top: el.scrollTop, height: el.scrollHeight }; setShown((n) => n + CHAT_PAGE); };

  const send = async () => {
    const t = text.trim().slice(0, MAX_CHAT_TEXT);
    if (!t) return;
    setError(null);
    const m: ChatMessage = { role: 'rider', text: t, atMs: now() };
    try { await port.put({ kind: 'chat', id: newId(), updatedMs: now(), deleted: false, body: m }); setText(''); } catch { setError('Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.'); }
  };

  const strip = rest.length > 0 && !typing && (
    <button type="button" className="tk-strip" aria-haspopup="dialog" onClick={() => setMoreOpen(true)}>
      <span>{rest.length === 1 ? 'Bo hat noch einen weiteren Vorschlag.' : `Bo hat noch ${rest.length} weitere Vorschläge.`}</span><span aria-hidden="true">›</span>
    </button>
  );
  const pins = (
    <>
      {strip}
      {(error ?? undoError) && <p role="alert" className="tk-note">{error ?? undoError}</p>}
      {text === '' && (
        <div className="tk-chips" aria-label="Das kannst du Bo sagen">
          {BO_LINES.suggestions.map((s) => <button key={s} type="button" onClick={() => setText(s)}>{s}</button>)}
        </div>
      )}
      <form className="tk-chat-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea aria-label="Nachricht an Bo" rows={1} value={text} maxLength={MAX_CHAT_TEXT} onChange={(e) => setText(e.target.value)} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} placeholder="Schreib Bo, was ansteht" />
        <button type="submit" className="tk-send primary" aria-label="Senden" disabled={!text.trim()}><Icon name="senden" size={22} /></button>
      </form>
    </>
  );

  return (
    <Sheet page title={BO.title} display subtitle={BO_LINES.subtitle} onClose={onClose} actions={pins} lead={<PandaPortrait className="tk-pandahead-mini" pose="listen" />}>
      {notes.length > 0 && <RowCard icon="aenderung" kicker="Zuletzt geändert" title={noteText(notes[0]!)} onClick={() => setNotesOpen(true)} />}
      <section className="tk-chat" aria-label="Unterhaltung mit Bo">
        {visible.length > shown && <button type="button" className="link" onClick={older}>Frühere Nachrichten zeigen</button>}
        {window.map((m, i, list) => (
          <Fragment key={m.id}>
            {(i === 0 || localDayKey(list[i - 1]!.atMs) !== localDayKey(m.atMs)) && <p className="tk-daypill" role="separator">{dayHeading(m.atMs, now())}</p>}
            <ChatBubble m={m}>
              {m.id === first?.id ? <ProposalCard port={port} now={now} newId={newId} m={m} /> : (
                <>
                  {m.nextChange && <NextChangeCard history port={port} changeId={m.nextChange} records={changeRecs} now={now} />}
                  {m.rule && <RuleCard history port={port} ruleId={m.rule} records={ruleRecs} catalog={catalog} now={now} />}
                  {m.proposal && <ProposalLine m={m as WeekEntry} answer={weekAnswer(proposalAnswer(thread, m.id), thread.some((x) => x.undoes === m.id), storedWeek(plans ?? [], m.proposal.weekStart), m.id)} undoWhy={weekUndoRefusal(storedWeek(plans ?? [], m.proposal.weekStart), m.proposal, m.id)} onUndo={() => void undo(m as WeekEntry)} past={m.proposal.weekStart < monday} loading={plans === null} />}
                </>
              )}
            </ChatBubble>
          </Fragment>
        ))}
        {waiting && <ChatNote>{now() - waiting.atMs > STALE_MS ? BO_LINES.stale : now() - waiting.atMs > SLOW_MS ? BO_LINES.slow : BO_LINES.sent}</ChatNote>}
        <div ref={endRef} />
      </section>
      {showMore && <ProposalsSheet port={port} now={now} newId={newId} entries={rest} onClose={() => setMoreOpen(false)} />}
      {notesOpen && (
        <Sheet size="small" title="Zuletzt geändert" onClose={() => setNotesOpen(false)}>
          <ul className="tk-changes" aria-label="Zuletzt geändert">
            {notes.map((n, i) => <li key={`${n.atMs}-${i}`}>{dateLabel(n.atMs)} · {noteText(n)}</li>)}
          </ul>
        </Sheet>
      )}
    </Sheet>
  );
}
