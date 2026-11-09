import { RAMP_ID } from '../shared/session';
import type { RideSummary } from './metrics';
import type { CoachState } from './state';

export type UploadMode = 'off' | 'ask';
export type RideUpload = { status: 'uploading' | 'uploaded' | 'failed'; atMs: number; reason?: string };
export type GarminUploadSettings = { mode: UploadMode; rides: Record<string, RideUpload> };

/** Off until the rider switches it on. Nothing ever goes up by itself: every upload is confirmed in a preview. */
export const uploadSettings = (s: Pick<CoachState, 'garminUpload'>): GarminUploadSettings => {
  const u = s.garminUpload;
  if (!u) return { mode: 'off', rides: {} };
  return { mode: u.mode === 'off' ? 'off' : 'ask', rides: u.rides };
};

export const withUploadMode = (s: Pick<CoachState, 'garminUpload'>, mode: UploadMode): GarminUploadSettings => ({ ...uploadSettings(s), mode });

export const REPO_DESCRIPTION = 'Gefahren mit Pandafit 🚴 https://github.com/Basti93/pandafit #vibeIt';

/** Simple on purpose and from the data, so that no fanciful session name ends up in Garmin. */
export const activityName = (ride: RideSummary): string => {
  const base = 'Indoor Cycling';
  if (ride.sessionId === RAMP_ID) return `${base} Rampentest`;
  if (ride.intervalsPlanned) return `${base} Intervalle`;
  const f = ride.intensityFactor;
  if (f === null) return base;
  if (f < 0.56) return `${base} Locker`;
  if (f < 0.76) return `${base} Grundlage`;
  return `${base} ${f < 0.91 ? 'Tempo' : 'Hart'}`;
};

/** Only known rides that are not up or on their way. */
export const canUpload = (s: CoachState, rideId: string): boolean => {
  if (!s.summaries.some((r) => r.rideId === rideId)) return false;
  const status = uploadSettings(s).rides[rideId]?.status;
  return status !== 'uploaded' && status !== 'uploading';
};
