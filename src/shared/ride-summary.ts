import type { IntensityClass } from './intensity';

export type RideSummary = {
  rideId: string; startedAtMs: number; status: 'finished' | 'aborted'; sessionId: string; ftpW: number; durationS: number;
  avgPowerW: number | null; normalizedPowerW: number | null; intensityFactor: number | null; tss: number;
  avgHrBpm: number | null; maxHrBpm: number | null; bestMinutePowerW: number | null; completedFraction: number;
  sessionName?: string; suspectData?: boolean; intervalsPlanned?: number; intervalsDone?: number;
  hrZoneMinutes?: number[]; hrTargetPct?: number; hrDriftPct?: number; hrRecoveryBpm?: number;
  /** Mean cadence over the pedalling seconds. Absent without cadence data. */
  avgCadenceRpm?: number;
  /** Best mean power per duration in seconds. */
  powerCurve?: Record<string, number>;
  /** Share of the ridden seconds within 10 % of the target. */
  onTargetPct?: number;
  /** Moderate, vigorous and peak seconds (watts against the FTP, else heart rate zone). Absent in old rides until the backfill. */
  intensity?: IntensityClass;
};
