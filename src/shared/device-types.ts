/** Device and engine state shapes that travel over the ride protocol. */
export type DeviceKind = 'trainer' | 'hr' | 'clicker';
export type Reading = { powerW?: number; cadenceRpm?: number; speedKph?: number; hrBpm?: number };
export type DeviceStatus = Record<DeviceKind, 'connected' | 'searching' | 'off'>;
export type EngineState = {
  stepIndex: number; stepRemainingS: number; rideElapsedS: number;
  targetW: number | null; gradePct: number | null; gear: number | null;
  label: string; nextLabel: string | null; secondsToNext: number; autoReducedPct: number; paused: boolean;
};
