import { parseSession, stepFtpFraction, type Session, type Step } from '../shared/session';
import { loadModel, type RideSummary } from './metrics';

export type CoachContext = { ftpW: number; summaries: RideSummary[]; nowMs: number; careful?: boolean; complaint?: boolean };
export const RAMP_ID = 'ramp-test';

export const LIMITS = {
  minTotalS: 10 * 60, maxTotalS: 120 * 60, minWarmupS: 5 * 60, maxWarmupFraction: 0.6, maxWarmupGrade: 3,
  maxFraction: 1.3, maxFractionFrom5Min: 1.05, maxFractionFrom20Min: 0.95, hardFraction: 0.9, maxHardS: 30 * 60,
  minGrade: -5, maxGrade: 12, minScale: 0.5, maxScale: 1.2,
  hardRideIf: 0.85, easyFraction: 0.75, breakDays: 14, gentleMaxS: 45 * 60,
  maxTss: 120, tssGrowth: 1.5, minTssCap: 50,
  hardGapMs: 48 * 3_600_000, weekMinTss: 300, weekMaxTss: 700, weekGrowth: 1.3, weekFloorTss: 25,
} as const;

const DAY_MS = 86_400_000;
export const estimateTss = (session: Session): number =>
  session.steps.reduce((sum, s) => sum + (s.durationS / 3600) * stepFtpFraction(s) ** 2 * 100, 0);

/** Gentle program: after a hard ride, a long break or with no history at all. */
export const mustBeEasy = (ctx: CoachContext): boolean => {
  const hardRecently = ctx.summaries.some((r) => ctx.nowMs - r.startedAtMs < LIMITS.hardGapMs && (r.intensityFactor ?? 0) >= LIMITS.hardRideIf);
  return hardRecently || !!ctx.complaint || mustBeGentle(ctx);
};
export const mustBeGentle = (ctx: CoachContext): boolean => {
  const { daysSinceLastRide } = loadModel(ctx.summaries, ctx.nowMs);
  return daysSinceLastRide === null || daysSinceLastRide >= LIMITS.breakDays;
};
export const tssCap = (ctx: CoachContext): number => {
  const recent = ctx.summaries.filter((r) => ctx.nowMs - r.startedAtMs < 28 * DAY_MS).map((r) => r.tss);
  const strongest = recent.length ? Math.max(...recent) : 0;
  const single = Math.min(LIMITS.maxTss, Math.max(LIMITS.minTssCap, strongest * LIMITS.tssGrowth));
  return Math.min(single, Math.max(LIMITS.weekFloorTss, weekBudget(ctx)));
};
/** What is still available in the last 7 days. The limit grows with the average of the three weeks before. */
const weekBudget = (ctx: CoachContext): number => {
  const age = (r: RideSummary) => ctx.nowMs - r.startedAtMs;
  const sum = (rs: RideSummary[]) => rs.reduce((a, r) => a + r.tss, 0);
  const week = sum(ctx.summaries.filter((r) => age(r) < 7 * DAY_MS));
  const before = sum(ctx.summaries.filter((r) => age(r) >= 7 * DAY_MS && age(r) < 28 * DAY_MS)) / 3;
  return Math.min(LIMITS.weekMaxTss, Math.max(LIMITS.weekMinTss, before * LIMITS.weekGrowth)) - week;
};

const violation = (session: Session, ctx: CoachContext): string | null => {
  if (session.id === RAMP_ID) return 'Die Kennung des Rampentests ist reserviert.';
  const total = session.steps.reduce((a, s) => a + s.durationS, 0);
  if (total < LIMITS.minTotalS || total > LIMITS.maxTotalS) return 'Dauer außerhalb von 10 bis 120 Minuten.';
  const first = session.steps[0];
  if (first.durationS < LIMITS.minWarmupS) return 'Warmup kürzer als 5 Minuten.';
  if (first.kind === 'erg' ? first.ftpFraction > LIMITS.maxWarmupFraction : first.gradePct * first.scale > LIMITS.maxWarmupGrade) return 'Warmup zu hart.';
  let hardS = 0;
  for (const s of session.steps) {
    if (s.kind === 'grade') {
      if (s.gradePct < LIMITS.minGrade || s.gradePct > LIMITS.maxGrade) return 'Steigung außerhalb von -5 bis 12 %.';
      if (s.scale < LIMITS.minScale || s.scale > LIMITS.maxScale) return 'Skalierung außerhalb von 0,5 bis 1,2.';
    }
    // For climbs this is an estimate of the effort, the same limits apply anyway.
    const f = stepFtpFraction(s);
    if (f > LIMITS.maxFraction) return 'Abschnitt über 130 % FTP.';
    if (s.durationS >= 5 * 60 && f > LIMITS.maxFractionFrom5Min) return 'Ab 5 Minuten höchstens 105 % FTP.';
    if (s.durationS >= 20 * 60 && f > LIMITS.maxFractionFrom20Min) return 'Ab 20 Minuten höchstens 95 % FTP.';
    if (f > LIMITS.hardFraction) hardS += s.durationS;
    if (mustBeEasy(ctx) && f > LIMITS.easyFraction) return 'Heute sind nur lockere Abschnitte erlaubt.';
  }
  if (hardS > LIMITS.maxHardS) return 'Mehr als 30 Minuten über 90 % FTP.';
  if (mustBeGentle(ctx) && total > LIMITS.gentleMaxS) return 'Zum Einstieg höchstens 45 Minuten.';
  if (estimateTss(session) > tssCap(ctx)) return 'Belastung steigt zu stark gegenüber den letzten Wochen.';
  return null;
};

export const checkSession = (session: unknown, ctx: CoachContext): { ok: true; session: Session } | { ok: false; reason: string } => {
  let parsed: Session;
  try {
    parsed = parseSession(session);
  } catch {
    return { ok: false, reason: 'Die Einheit hat kein gültiges Format.' };
  }
  const reason = violation(parsed, ctx);
  return reason ? { ok: false, reason } : { ok: true, session: parsed };
};
