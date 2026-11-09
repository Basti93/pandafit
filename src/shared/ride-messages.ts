import { z } from 'zod';
import { profileSchema } from './profiles';
import { sessionSchema } from './session';

/** The biggest change of a target that one message may ask for, in percent. The engine clamps on top of it. */
export const MAX_ADJUST_PCT = 100;

const id = z.string().min(1).max(200);
const kind = z.enum(['trainer', 'hr', 'clicker']);
const finite = z.number().finite();

/** Every message the UI or a script may send to the ride service. The TS type is derived from it. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), profileId: id, session: sessionSchema, ftpW: finite.positive(), maxHrBpm: finite.optional(), hrMaxBpm: finite.optional() }),
  z.object({ type: z.literal('device-connect'), kind }),
  z.object({ type: z.literal('device-disconnect'), kind }),
  z.object({ type: z.literal('adjust'), deltaPct: finite.min(-MAX_ADJUST_PCT).max(MAX_ADJUST_PCT) }),
  z.object({ type: z.literal('mark'), note: z.string().optional() }),
  z.object({ type: z.literal('skip') }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('discard') }),
  z.object({ type: z.literal('resume'), rideId: id }),
  z.object({ type: z.literal('discard-resume'), rideId: id }),
  z.object({ type: z.literal('export-fit'), rideId: id }),
  z.object({ type: z.literal('save-profile'), profile: profileSchema }),
  z.object({ type: z.literal('delete-profile'), profileId: id }),
  z.object({ type: z.literal('problem-report'), note: z.string() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** The message in a raw WebSocket frame, or null if it is not a valid one. Never throws. */
export const parseClientMessage = (raw: string): ClientMessage | null => {
  try {
    const out = clientMessageSchema.safeParse(JSON.parse(raw));
    return out.success ? out.data : null;
  } catch { return null; }
};
