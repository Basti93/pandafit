import { chatThread, type ChatEntry } from '../../shared/chat';
import { localDayKey } from '../../shared/dates';
import { mondayOf } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import { openProposals } from './chat-open';
import { usePortRecords } from './hooks';

/** The proposals that wait for an answer (week plan, next change, rule): the week plan first, then the others in the order of the chat. */
export function useOpenProposals(port: TrackingPort, nowMs: number): ChatEntry[] {
  const chat = usePortRecords(port, 'chat').all;
  const plans = usePortRecords(port, 'weekplan').all;
  const changes = usePortRecords(port, 'change').all;
  const rules = usePortRecords(port, 'rule').all;
  const open = openProposals(chatThread(chat ?? []), plans ?? [], changes ?? [], rules ?? [], mondayOf(localDayKey(nowMs)));
  return [...open].sort((a, b) => Number(!!b.proposal) - Number(!!a.proposal));
}
