import type { Session, Step } from '../shared/session';
import { checkSession, mustBeEasy, mustBeGentle, tssCap, type CoachContext } from './session-limits';
import { estimateTss, RAMP_ID } from '../shared/session';
import { rampTest } from '../shared/ramp';

import { loadModel, type RideSummary } from './metrics';

const min = (n: number) => n * 60;
const erg = (minutes: number, ftpFraction: number, label: string): Step => ({ kind: 'erg', durationS: min(minutes), ftpFraction, label });

const steady = (id: string, name: string, mainMinutes: number, fraction: number): Session => ({
  id, name, steps: [erg(5, 0.45, 'Warmup'), erg(mainMinutes, fraction, 'Locker'), erg(3, 0.4, 'Ausrollen')],
});
const intervals = (count: number): Session => ({
  id: 'regel-intervalle', name: `${count} × 4 Minuten`,
  steps: [erg(10, 0.5, 'Warmup'), ...Array.from({ length: count }, () => [erg(4, 0.95, 'Hart'), erg(3, 0.5, 'Erholung')]).flat(), erg(5, 0.45, 'Ausrollen')],
});

/** Shortens the main part until the load limit fits. */
const fitToCap = (session: Session, ctx: CoachContext): Session => {
  let s = session;
  const mainIndex = s.steps.findIndex((x, i) => i > 0 && x.durationS > min(5));
  while (estimateTss(s) > tssCap(ctx) && mainIndex > 0 && s.steps[mainIndex].durationS > min(5)) {
    s = { ...s, steps: s.steps.map((x, i) => (i === mainIndex ? { ...x, durationS: x.durationS - 60 } : x)) };
  }
  return s;
};

const MIN_RIDES_FOR_INTERVALS = 3;

export const ruleBasedSession = (ctx: CoachContext): { session: Session; reason: string } => {
  const model = loadModel(ctx.summaries, ctx.nowMs);
  if (mustBeGentle(ctx)) {
    return { session: fitToCap(steady('regel-einstieg', 'Sanfter Einstieg', 22, 0.6), ctx), reason: 'Ein ruhiger Einstieg gibt deinem Körper Zeit, wieder in den Rhythmus zu kommen.' };
  }
  if (ctx.careful || mustBeEasy(ctx) || model.form < -15) {
    return { session: fitToCap(steady('regel-erholung', 'Lockere Erholung', 25, 0.55), ctx), reason: 'Du hast zuletzt viel geleistet, heute darf es locker sein, damit die Form ankommt.' };
  }
  const hardInLastDays = ctx.summaries.some((r: RideSummary) => ctx.nowMs - r.startedAtMs < 2 * 86_400_000 && (r.intensityFactor ?? 0) >= 0.8);
  const ridesLastMonth = ctx.summaries.filter((r: RideSummary) => ctx.nowMs - r.startedAtMs < 28 * 86_400_000).length;
  if (!hardInLastDays && model.form > -10 && ridesLastMonth >= MIN_RIDES_FOR_INTERVALS) {
    const candidate = intervals(4);
    if (checkSession(candidate, ctx).ok) return { session: candidate, reason: 'Du bist gut erholt, heute passen ein paar kräftige Intervalle.' };
    const shorter = intervals(2);
    if (checkSession(shorter, ctx).ok) return { session: shorter, reason: 'Du bist gut erholt, zwei kräftige Intervalle bringen heute einen guten Reiz.' };
  }
  return { session: fitToCap(steady('regel-grundlage', 'Grundlage', 40, 0.65), ctx), reason: 'Eine gleichmäßige Fahrt baut Ausdauer auf, ohne dich zu überfordern.' };
};

export const ftpFromRamp = (summary: RideSummary): { ftpW: number | null; hitCeiling: boolean } => ({
  ftpW: summary.bestMinutePowerW === null ? null : Math.round(summary.bestMinutePowerW * 0.75),
  hitCeiling: summary.bestMinutePowerW !== null && summary.completedFraction >= 1,
});

const FRACTION_STEP = 0.05;
const scaleWork = (s: Session, direction: 1 | -1): Session => ({
  ...s,
  steps: s.steps.map((x, i) => {
    if (i === 0) return x;
    if (x.kind === 'grade') return { ...x, scale: Math.round((x.scale + direction * 0.05) * 100) / 100 };
    return { ...x, ftpFraction: Math.max(0.3, Math.round((x.ftpFraction + direction * FRACTION_STEP) * 100) / 100) };
  }),
});
const shorten = (s: Session): Session => {
  const total = s.steps.reduce((a, x) => a + x.durationS, 0);
  const cut = Math.round(total * 0.25);
  let left = cut;
  const steps = [...s.steps];
  // Shorten from the end, without the warmup and with at least one main section.
  for (let i = steps.length - 1; i > 0 && left > 0; i--) {
    const reducible = i === 1 ? Math.max(0, steps[i].durationS - 60) : steps[i].durationS;
    const take = Math.min(left, reducible);
    left -= take;
    if (take === steps[i].durationS) steps.splice(i, 1);
    else steps[i] = { ...steps[i], durationS: steps[i].durationS - take };
  }
  return { ...s, steps };
};

/** Sticks with the existing session on an invalid change. */
export const adjustSession = (session: Session, how: 'easier' | 'harder' | 'shorter', ctx: CoachContext): Session => {
  if (session.id === RAMP_ID) return session;
  const next = how === 'shorter' ? shorten(session) : scaleWork(session, how === 'harder' ? 1 : -1);
  return checkSession(next, ctx).ok ? next : session;
};

