import type { RideSummary } from './ride-summary';

export type RideProgress = { comparedRideId: string; comparedAtMs: number; sameSession: boolean } & (
  | { kind: 'lower-hr' | 'higher-hr'; bpm: number }
  | { kind: 'more-power'; watts: number }
  | { kind: 'same' }
);

// Our own choice, see docs/progress.md.
const MAX_DURATION_OFF = 0.2;
const MAX_POWER_OFF = 0.05;
const MAX_POWER_GAIN = 0.2;
const MAX_VARIABILITY_OFF = 0.05;
const HR_NOTICEABLE_BPM = 2;

const usable = (r: RideSummary): r is RideSummary & { avgPowerW: number; normalizedPowerW: number; avgHrBpm: number } =>
  r.status === 'finished' && !r.suspectData && !!r.avgPowerW && !!r.normalizedPowerW && !!r.avgHrBpm;

/** Only against yourself and only with a ride of the same character: same length, same evenness, about the same watts. */
export const rideProgress = (ride: RideSummary, summaries: RideSummary[]): RideProgress | null => {
  if (!usable(ride)) return null;
  const earlier = summaries.filter((r) => r.rideId !== ride.rideId && r.startedAtMs < ride.startedAtMs).sort((a, b) => b.startedAtMs - a.startedAtMs);
  for (const old of earlier) {
    if (!usable(old)) continue;
    const similar = Math.abs(ride.durationS - old.durationS) <= old.durationS * MAX_DURATION_OFF
      && Math.abs(ride.normalizedPowerW / ride.avgPowerW - old.normalizedPowerW / old.avgPowerW) <= MAX_VARIABILITY_OFF;
    if (!similar) continue;
    const base = { comparedRideId: old.rideId, comparedAtMs: old.startedAtMs, sameSession: !!ride.sessionName && ride.sessionName === old.sessionName };
    const gain = (ride.avgPowerW - old.avgPowerW) / old.avgPowerW;
    const bpm = ride.avgHrBpm - old.avgHrBpm;
    if (Math.abs(gain) <= MAX_POWER_OFF) {
      if (Math.abs(bpm) < HR_NOTICEABLE_BPM) return { ...base, kind: 'same' };
      return { ...base, kind: bpm < 0 ? 'lower-hr' : 'higher-hr', bpm: Math.abs(bpm) };
    }
    if (gain > 0 && gain <= MAX_POWER_GAIN && Math.abs(bpm) <= HR_NOTICEABLE_BPM) return { ...base, kind: 'more-power', watts: ride.avgPowerW - old.avgPowerW };
  }
  return null;
};

const dayOf = (ms: number) => new Date(ms).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });

export const progressText = (p: RideProgress): string => {
  const intro = `${p.sameSession ? 'Gleiche Einheit' : 'Ähnliche Fahrt'} wie am ${dayOf(p.comparedAtMs)}`;
  switch (p.kind) {
    case 'lower-hr': return `${intro}: gleiche Watt, ${p.bpm} bpm weniger Puls.`;
    case 'more-power': return `${intro}: ${p.watts} W mehr bei gleichem Puls.`;
    case 'same': return `${intro}: gleiche Watt, gleicher Puls.`;
    case 'higher-hr': return `${intro}: gleiche Watt, heute ${p.bpm} bpm mehr Puls. Schlaf, Wärme und Tagesform wirken da mit.`;
  }
};
