import type { Step } from './session';

// Foundations and limits: docs/hr-zones.md.
const YEAR_MS = 365.25 * 86_400_000;
export const ZONES = [1, 2, 3, 4, 5] as const;

/** Heart rate hold: at most this much above the planned power, and never above this share of the FTP. Own settings, see docs/hr-zones.md. */
export const HOLD_MAX_UP_PCT = 15;
export const HOLD_CEILING_FRACTION = 0.8;
/** The highest share of the FTP a hold can lift a section with this planned share to. */
export const holdTopFraction = (ftpFraction: number): number => Math.max(ftpFraction, Math.min(ftpFraction * (1 + HOLD_MAX_UP_PCT / 100), HOLD_CEILING_FRACTION));

export type HrMax = { bpm: number; estimated: boolean };

/** Your own value applies. Otherwise Tanaka (208 − 0.7 × age), error around ±10 beats, hence marked as an estimate. */
export const hrMaxFor = (p: { hrMaxBpm?: number; birthDate?: string }, nowMs: number): HrMax | null => {
  if (p.hrMaxBpm) return { bpm: p.hrMaxBpm, estimated: false };
  const birth = p.birthDate ? Date.parse(p.birthDate) : NaN;
  if (Number.isNaN(birth)) return null;
  return { bpm: Math.round(208 - 0.7 * Math.floor((nowMs - birth) / YEAR_MS)), estimated: true };
};

/** Zone 1 starts at 50 % of maximum heart rate, each zone spans 10 percentage points. */
export const zoneBounds = (zone: number, hrMaxBpm: number): { fromBpm: number; toBpm: number } => ({
  fromBpm: Math.round(((40 + zone * 10) / 100) * hrMaxBpm),
  toBpm: Math.round(((50 + zone * 10) / 100) * hrMaxBpm),
});

/** 0 means below zone 1. Above 100 % counts as zone 5. */
export const zoneOf = (hrBpm: number, hrMaxBpm: number): number => {
  const pct = (hrBpm / hrMaxBpm) * 100;
  return pct < 50 ? 0 : Math.min(5, Math.floor((pct - 40) / 10));
};

/** Set by the coach or roughly derived from the watts (our own choice). */
export const stepTargetZone = (s: Step): number => {
  if (s.hrZone) return s.hrZone;
  const f = s.kind === 'erg' ? s.ftpFraction : Math.max(0.5, 0.55 + (s.gradePct * s.scale) / 20);
  if (f <= 0.55) return 2;
  if (f <= 0.75) return 3;
  if (f <= 0.9) return 4;
  return 5;
};
