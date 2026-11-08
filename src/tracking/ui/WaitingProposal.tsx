import { chatThread } from '../../shared/chat';
import { localDayKey } from '../../shared/dates';
import { mondayOf } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import { openProposals } from './chat-open';
import { usePortRecords } from './hooks';

/** True while the coach has a proposal (week, next change, rule) that waits for an answer. */
export function useWaitingProposal(port: TrackingPort, nowMs: number): boolean {
  const chat = usePortRecords(port, 'chat').all;
  const plans = usePortRecords(port, 'weekplan').all;
  const changes = usePortRecords(port, 'change').all;
  const rules = usePortRecords(port, 'rule').all;
  return openProposals(chatThread(chat ?? []), plans ?? [], changes ?? [], rules ?? [], mondayOf(localDayKey(nowMs))).length > 0;
}

/** The one open decision, said where it cannot be missed: a card with the way to it. */
export function WaitingProposal({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="card tk-waiting-card" aria-label="Ein Vorschlag wartet auf dich">
      <p><b>Ein Vorschlag wartet auf dich</b></p>
      <button type="button" className="secondary" onClick={onOpen}>Ansehen</button>
    </section>
  );
}
