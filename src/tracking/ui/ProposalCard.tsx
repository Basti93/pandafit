import { dayMonthOfKey, shortDateOfKey } from '../../shared/dates';
import type { ChatEntry } from '../../shared/chat';
import type { TrackingPort } from '../ports';
import { DECLINE, TAKE } from '../../shared/wording';
import { NextChangeCard } from './NextChangeCard';
import { RuleCard } from './RuleCard';
import { BlockCard } from './BlockCard';
import { DriftCard } from './DriftCard';
import { PushCard } from './PushCard';
import { Week } from './WeekList';
import { planRows } from './done-days';
import { useCatalog, usePortRecords } from './hooks';
import { useProposalActions, type WeekEntry } from './proposals';
import { Sheet } from './kit';
import { BO_LINES } from './bo';

type Env = { port: TrackingPort; now: () => number; newId: () => string };

/** A proposal that waits for an answer: a week plan (seven days, Übernehmen, Nein danke), a swap for the next workout, a rule or the push question. It reads its own records. */
export function ProposalCard({ port, now, newId, m }: Env & { m: ChatEntry }) {
  const plans = usePortRecords(port, 'weekplan').all;
  const changeRecs = usePortRecords(port, 'change').all;
  const ruleRecs = usePortRecords(port, 'rule').all;
  const catalog = useCatalog(port);
  const { take, decline, error } = useProposalActions(port, now, newId);
  if (m.nextChange) return <NextChangeCard port={port} changeId={m.nextChange} records={changeRecs} now={now} />;
  if (m.rule) return <RuleCard port={port} ruleId={m.rule} records={ruleRecs} catalog={catalog} now={now} />;
  if (m.block) return <BlockCard port={port} blockId={m.block} msgId={m.id} now={now} />;
  if (m.drift) return <DriftCard port={port} now={now} newId={newId} m={m} />;
  if (m.askPush) return <PushCard port={port} now={now} newId={newId} m={m} />;
  if (!m.proposal) return null;
  const p = m.proposal;
  return (
    <div className="tk-proposal" role="group" aria-label={`Vorschlag Wochenplan ab ${dayMonthOfKey(p.weekStart)}`}>
      <p><b>{BO_LINES.proposalWeek(dayMonthOfKey(p.weekStart))}</b></p>
      <Week brief rows={planRows(p.days)} label={`Vorschlag für die Woche ab ${shortDateOfKey(p.weekStart)}`} />
      {m.warnings && m.warnings.length > 0 && <p className="tk-note">Das ist mehr, als unsere Regeln für Erholung empfehlen: {m.warnings.join(' ')}</p>}
      {error && <p role="alert" className="tk-note">{error}</p>}
      <div className="tk-mainactions">
        <button type="button" className="primary" disabled={plans === null} onClick={() => void take(m as WeekEntry)}>{TAKE}</button>
        <button type="button" className="secondary" onClick={() => decline(m)}>{DECLINE}</button>
      </div>
    </div>
  );
}

/** The other waiting proposals in a small sheet. It closes when the last one is answered. */
export function ProposalsSheet({ port, now, newId, entries, onClose }: Env & { entries: ChatEntry[]; onClose: () => void }) {
  if (entries.length === 0) return null;
  return (
    <Sheet size="small" title={entries.length === 1 ? 'Vorschlag' : 'Vorschläge'} onClose={onClose}>
      <div className="tk-pins">
        {entries.map((m) => <div key={m.id} className="tk-pin"><ProposalCard port={port} now={now} newId={newId} m={m} /></div>)}
      </div>
    </Sheet>
  );
}
