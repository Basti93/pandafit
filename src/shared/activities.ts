/**
 * What the coach publishes for the web: one `activities` record with every recent activity from all sources
 * (strength, rides, Garmin, runs entered by hand). Read-only for the web.
 */
export const ACTIVITIES_ID = 'activities';
export const MAX_ACTIVITIES = 60;
const MAX_ACTIVITIES_BODY = 64 * 1024;

export type ActivityKind = 'kraft' | 'rad' | 'lauf' | 'andere';
export const ACTIVITY_KINDS: readonly ActivityKind[] = ['kraft', 'rad', 'lauf', 'andere'];
export type ActivityItem = {
  /** Like TrainingSession.key: 'kraft-<id>', 'rad-<rideId>', 'garmin-<id>', 'lauf-<id>'. */
  key: string;
  kind: ActivityKind;
  title: string | null;
  sport: string | null;
  startMs: number;
  minutes: number;
  distanceM: number | null;
  avgHr: number | null;
  /** Record id of the workout or ride; null for the rest. */
  ref: string | null;
};
export type ActivitiesBody = { type: 'activities'; atMs: number; items: ActivityItem[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 200;
const strOrNull = (x: unknown): boolean => x === null || str(x);
const numOrNull = (x: unknown): boolean => x === null || fin(x);

/** The activities body, or null when it is not whole or has too many entries. A broken entry is dropped. */
export function readActivities(body: unknown): ActivitiesBody | null {
  if (!isObj(body) || body.type !== 'activities' || !fin(body.atMs) || !Array.isArray(body.items)) return null;
  if (body.items.length > MAX_ACTIVITIES || JSON.stringify(body).length > MAX_ACTIVITIES_BODY) return null;
  const items = body.items.flatMap((i): ActivityItem[] =>
    isObj(i) && str(i.key) && ACTIVITY_KINDS.includes(i.kind as ActivityKind) && strOrNull(i.title) && strOrNull(i.sport) && fin(i.startMs) && fin(i.minutes)
      && numOrNull(i.distanceM) && numOrNull(i.avgHr) && strOrNull(i.ref)
      ? [{ key: i.key, kind: i.kind as ActivityKind, title: i.title as string | null, sport: i.sport as string | null, startMs: i.startMs, minutes: i.minutes,
        distanceM: i.distanceM as number | null, avgHr: i.avgHr as number | null, ref: i.ref as string | null }] : []);
  return { type: 'activities', atMs: body.atMs, items };
}
