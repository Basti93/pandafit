/** Two records are the same session if they share at least this part of the shorter one. */
const SAME_SHARE = 0.5;
export type Span = { startMs: number; durationS: number };
/** Two records are the same session if they share at least half of the shorter one. */
export const overlapsByHalf = (a: Span, b: Span): boolean => {
  const shorter = Math.min(a.durationS, b.durationS) * 1000;
  const shared = Math.min(a.startMs + a.durationS * 1000, b.startMs + b.durationS * 1000) - Math.max(a.startMs, b.startMs);
  return shorter > 0 && shared >= shorter * SAME_SHARE;
};
