import { zoneOf } from './hr-zones';
import { ruleValues } from './training-policy';

/**
 * How many seconds of one endurance session were moderate and vigorous, and how many of those were peak (heart rate zone 5
 * or over 105 % FTP; peak seconds are vigorous too). Easy seconds are not counted. The rules: `intensity.*` in the policy.
 */
export type IntensityClass = { moderateS: number; vigorousS: number; peakS: number };

const NONE: IntensityClass = { moderateS: 0, vigorousS: 0, peakS: 0 };
const classes = () => ruleValues('intensity.classes');

/** Without power and heart rate the whole duration counts as moderate, never as vigorous. */
export const noData = (durationS: number): IntensityClass => ({ moderateS: Math.max(0, durationS), vigorousS: 0, peakS: 0 });

/** A ride from its per-second values: watts against the FTP; where a second has no power, its heart rate zone. */
export function classifyRide(samples: readonly { powerW: number | null; hrBpm: number | null }[], ftpW: number, hrMaxBpm: number | null): IntensityClass {
  const c = classes(), hard = ruleValues('intensity.hard-session');
  const out = { ...NONE };
  let known = 0;
  for (const s of samples) {
    let level: 0 | 1 | 2, peak: boolean;
    if (s.powerW !== null && ftpW > 0) {
      const f = s.powerW / ftpW;
      level = f > c.ftpVigorous! ? 2 : f >= c.ftpModerate! ? 1 : 0;
      peak = f > hard.peakFtp!;
    } else if (s.hrBpm !== null && hrMaxBpm) {
      const z = zoneOf(s.hrBpm, hrMaxBpm);
      level = z >= c.hrVigorousZone! ? 2 : z >= c.hrModerateZone! ? 1 : 0;
      peak = z >= hard.peakZone!;
    } else continue;
    known += 1;
    if (level === 2) out.vigorousS += 1; else if (level === 1) out.moderateS += 1;
    if (peak) out.peakS += 1;
  }
  return known === 0 ? noData(samples.length) : out;
}

/** Time in each of the five heart rate zones (seconds, zone 1 first). */
export function classifyByZoneSeconds(zoneS: readonly number[]): IntensityClass {
  const c = classes(), hard = ruleValues('intensity.hard-session');
  const at = (z: number) => Math.max(0, zoneS[z - 1] ?? 0);
  const out = { ...NONE };
  for (let z = 1; z <= 5; z++) {
    if (z >= c.hrVigorousZone!) out.vigorousS += at(z); else if (z >= c.hrModerateZone!) out.moderateS += at(z);
    if (z >= hard.peakZone!) out.peakS += at(z);
  }
  return out;
}

/** Only an average heart rate: the whole duration gets the class of the zone of that average. */
export function classifyByAvgHr(durationS: number, avgHr: number | null, hrMaxBpm: number | null): IntensityClass {
  if (!avgHr || !hrMaxBpm) return noData(durationS);
  const c = classes(), hard = ruleValues('intensity.hard-session');
  const z = zoneOf(avgHr, hrMaxBpm), d = Math.max(0, durationS);
  return { moderateS: z >= c.hrModerateZone! && z < c.hrVigorousZone! ? d : 0, vigorousS: z >= c.hrVigorousZone! ? d : 0, peakS: z >= hard.peakZone! ? d : 0 };
}

/** The intensity minutes the watch counted for one activity. */
export const classifyByIntensityMinutes = (moderateMin: number, vigorousMin: number): IntensityClass =>
  ({ moderateS: Math.max(0, moderateMin) * 60, vigorousS: Math.max(0, vigorousMin) * 60, peakS: 0 });

export const sumClasses = (xs: readonly IntensityClass[]): IntensityClass =>
  xs.reduce((a, x) => ({ moderateS: a.moderateS + x.moderateS, vigorousS: a.vigorousS + x.vigorousS, peakS: a.peakS + x.peakS }), { ...NONE });

/** Moderate-equivalent minutes: moderate plus the vigorous ones counted twice (WHO). */
export const equivalentMinutes = (c: IntensityClass): number => (c.moderateS + ruleValues('week.endurance-minutes').vigorousFactor! * c.vigorousS) / 60;

/** A hard session: at least 20 vigorous minutes, or at least 5 minutes in zone 5 or above 105 % FTP. */
export function isHardSession(c: IntensityClass): boolean {
  const h = ruleValues('intensity.hard-session');
  return c.vigorousS >= h.vigorousMin! * 60 || c.peakS >= h.peakMin! * 60;
}

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
/** Reads a stored class; anything unusable gives undefined. */
export const readIntensity = (x: unknown): IntensityClass | undefined => {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as Record<string, unknown>;
  return num(o.moderateS) && num(o.vigorousS) && num(o.peakS) ? { moderateS: o.moderateS, vigorousS: o.vigorousS, peakS: o.peakS } : undefined;
};
