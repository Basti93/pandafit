import { useState } from 'react';
import { chatThread, type ChatEntry, type ChatMessage } from '../../shared/chat';
import { localDayKey } from '../../shared/dates';
import { mondayOf, type WeekProposal } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import { takeWeekPlan, undoWeekPlan } from '../week-take';
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

/** A chat entry that carries a week plan proposal. */
export type WeekEntry = ChatEntry & { proposal: WeekProposal };

/** Take, undo and decline a proposal. Each writes the same records as before the chat was rebuilt; `error` holds the last refusal or failure. */
export function useProposalActions(port: TrackingPort, now: () => number, newId: () => string): { take: (m: WeekEntry) => Promise<void>; undo: (m: WeekEntry) => Promise<void>; decline: (m: ChatEntry) => void; error: string | null } {
  const [error, setError] = useState<string | null>(null);
  const write = async (m: ChatMessage) => {
    setError(null);
    try { await port.put({ kind: 'chat', id: newId(), updatedMs: now(), deleted: false, body: m }); return true; } catch { setError('Das konnte gerade nicht gespeichert werden. Versuch es gleich nochmal.'); return false; }
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
  return { take, undo, decline, error };
}
