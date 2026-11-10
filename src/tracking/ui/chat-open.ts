import { chatThread, proposalAnswer, type ChatEntry } from '../../shared/chat';
import { changesOf } from '../../shared/changes';
import { rulesOf } from '../../shared/personal';
import type { TrackedRecord } from '../../shared/records';
import { weekTaken } from '../week-take';

export type Thread = ReturnType<typeof chatThread>;

export const storedWeek = (plans: TrackedRecord[], weekStart: string): TrackedRecord | undefined => plans.find((x) => x.kind === 'weekplan' && x.id === weekStart);

/** What the stored data says wins over what the chat remembers: a plan written by this proposal is taken, even if the chat note was lost. */
export const weekAnswer = (chat: 'taken' | 'declined' | 'undone' | null, undone: boolean, stored: TrackedRecord | undefined, id: string): 'taken' | 'declined' | 'undone' | null =>
  weekTaken(stored, id) ? 'taken' : undone ? 'undone' : chat;

/** The messages with a proposal that still waits for an answer: a week plan (not for a week that is over), a next change, a rule, the push question. They are pinned above the input. */
export function openProposals(thread: Thread, plans: TrackedRecord[], changeRecs: TrackedRecord[], ruleRecs: TrackedRecord[], monday: string): ChatEntry[] {
  const changes = changesOf(changeRecs);
  const rules = rulesOf(ruleRecs);
  return thread.filter((m) => {
    if (m.takes || m.declines || m.undoes) return false;
    if (m.proposal) return m.proposal.weekStart >= monday && weekAnswer(proposalAnswer(thread, m.id), thread.some((x) => x.undoes === m.id), storedWeek(plans, m.proposal.weekStart), m.id) === null;
    if (m.nextChange) return changes.find((c) => c.id === m.nextChange)?.state === 'proposed';
    if (m.rule) return rules.find((r) => r.id === m.rule)?.state === 'proposed';
    if (m.askPush) return proposalAnswer(thread, m.id) === null;
    return false;
  });
}
