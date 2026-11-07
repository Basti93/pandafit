export type Sample = {
  seq: number; wallClockMs: number; rideElapsedS: number;
  powerW: number | null; cadenceRpm: number | null; speedKph: number | null; hrBpm: number | null;
  targetW: number | null; gradePct: number | null; gear: number | null;
};
export type RideEvent = {
  wallClockMs: number;
  type: 'gap-start' | 'gap-end' | 'device-lost' | 'device-back' | 'marker' | 'target-adjust' | 'storage-error' | 'resumed' | 'pause' | 'resume' | 'skip';
  detail?: string;
};
