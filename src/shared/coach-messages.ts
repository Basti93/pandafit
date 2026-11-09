import { z } from 'zod';
import type { LiveMessage } from './live';
import { LIVE_TYPES } from './live';
import { profileSchema } from './profiles';
import { RECORD_KINDS, type RecordKind, type TrackedRecord } from './records';
import type { ItemState } from './meals';

const id = z.string().min(1).max(200);
const str = z.string();
const finite = z.number().finite();
const how = z.enum(['easier', 'harder', 'shorter']);
const p = { profileId: id };
const trackedRecord = z.custom<TrackedRecord>((x) => typeof x === 'object' && x !== null && !Array.isArray(x));
const recordKind = z.custom<RecordKind>((x) => (RECORD_KINDS as readonly unknown[]).includes(x));
const itemState = z.custom<ItemState>((x) => x === 'offen' || x === 'gekauft' || x === 'da');

const plain = [
  z.object({ type: z.literal('account-link'), ...p, url: str, name: str, password: str }),
  z.object({ type: z.literal('account-unlink'), ...p }),
  z.object({ type: z.literal('hevy-connect'), ...p, key: str }),
  z.object({ type: z.literal('hevy-disconnect'), ...p }),
  z.object({ type: z.literal('garmin-login'), ...p, email: str, password: str }),
  z.object({ type: z.literal('garmin-mfa'), ...p, code: str }),
  z.object({ type: z.literal('garmin-disconnect'), ...p }),
  z.object({ type: z.literal('set-ftp'), ...p, ftpW: finite }),
  z.object({ type: z.literal('subscribe'), ...p }),
  z.object({ type: z.literal('feedback'), ...p, rideId: id, rating: z.enum(['easy', 'right', 'hard']) }),
  z.object({ type: z.literal('skip-feedback'), ...p }),
  z.object({ type: z.literal('skip-ramp'), ...p }),
  z.object({ type: z.literal('note'), ...p, text: str }),
  z.object({ type: z.literal('complaint-update'), ...p, id, status: z.enum(['active', 'healing', 'over']) }),
  z.object({ type: z.literal('answer-question'), ...p, questionId: id, text: str }),
  z.object({ type: z.literal('skip-question'), ...p }),
  z.object({ type: z.literal('debrief-seen'), ...p }),
  z.object({ type: z.literal('garmin-upload-settings'), ...p, mode: z.enum(['off', 'ask']) }),
  z.object({ type: z.literal('garmin-upload'), ...p, rideId: id, repoLink: z.boolean().optional() }),
  z.object({ type: z.literal('debrief-answer'), ...p, rideId: id, question: str, text: str }),
  z.object({ type: z.literal('debrief-skip-question'), ...p, rideId: id, question: str }),
  z.object({ type: z.literal('remove-motive'), ...p, atMs: finite }),
  z.object({ type: z.literal('ride-detail'), ...p, rideId: id }),
  z.object({ type: z.literal('word-result'), ...p, nl: str, knew: z.boolean() }),
  z.object({ type: z.literal('adjust'), ...p, how }),
  z.object({ type: z.literal('pass-select'), ...p, passId: id }),
  z.object({ type: z.literal('pass-progress'), ...p, passId: id, distanceM: finite }),
  z.object({ type: z.literal('pass-summit'), ...p, passId: id }),
  z.object({ type: z.literal('gym-adjust'), ...p, how }),
  z.object({ type: z.literal('gym-note'), ...p, text: str }),
  z.object({ type: z.literal('gym-answer'), ...p, question: str, text: str }),
  z.object({ type: z.literal('gym-skip-question'), ...p, question: str }),
  z.object({ type: z.literal('gym-start'), ...p }),
  z.object({ type: z.literal('gym-forget'), ...p }),
  z.object({ type: z.literal('gym-preview'), ...p }),
  z.object({ type: z.literal('gym-confirm'), ...p, name: str }),
  z.object({ type: z.literal('mobility-done'), ...p, sessionId: id }),
  z.object({ type: z.literal('mobility-feel'), ...p, text: str }),
  z.object({ type: z.literal('meals-settings'), ...p, settings: z.unknown() }),
  z.object({ type: z.literal('meals-replan'), ...p, week: str }),
  z.object({ type: z.literal('meals-swap'), ...p, week: str, meal: str, ai: z.boolean() }),
  z.object({ type: z.literal('meals-chat'), ...p, week: str, text: str }),
  z.object({ type: z.literal('meals-eater'), ...p, week: str, meal: str, person: str, on: z.boolean() }),
  z.object({ type: z.literal('meals-item'), ...p, week: str, item: str, state: itemState }),
  z.object({ type: z.literal('records-put'), requestId: id, ...p, record: trackedRecord, seenMs: finite.optional() }),
  z.object({ type: z.literal('records-list'), requestId: id, ...p, kind: recordKind }),
  /** The profile's values as changed on a client. */
  z.object({ type: z.literal('profile-update'), ...p, profile: profileSchema }),
] as const;

type Plain = z.infer<(typeof plain)[number]>;
/**
 * A change made while the server was unreachable or a ride was open, with the time it was made. Only QUEUEABLE messages count.
 * qid is the client's id for the entry: the server answers every queued message with a queued-ack carrying it.
 */
export type QueuedMessage = { type: 'queued'; qid: string; atMs: number; message: CoachClientMessage };
/** Everything a client may send to a coach. Live messages are only checked for their type here; src/shared/live.ts parses their content. */
export type CoachClientMessage = Plain | QueuedMessage | LiveMessage;

const queued: z.ZodType<QueuedMessage> = z.object({
  type: z.literal('queued'), qid: z.string().min(1).max(200), atMs: finite,
  message: z.lazy(() => coachClientMessageSchema),
});
const live = z.custom<LiveMessage>((x) => typeof x === 'object' && x !== null && LIVE_TYPES.has((x as { type?: unknown }).type as string));
export const coachClientMessageSchema: z.ZodType<CoachClientMessage> = z.union([z.discriminatedUnion('type', plain), queued, live]);

/** The message in a parsed WebSocket frame, or null if it is not a valid one. Never throws. */
export const parseCoachClientMessage = (raw: unknown): CoachClientMessage | null => {
  try {
    const out = coachClientMessageSchema.safeParse(raw);
    return out.success ? out.data : null;
  } catch { return null; }
};
