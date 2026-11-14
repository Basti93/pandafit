import type { RideSummary } from './ride-summary';
import { RAMP_ID } from './session';

export type UploadMode = 'off' | 'ask';
export type RideUpload = { status: 'uploading' | 'uploaded' | 'failed'; atMs: number; reason?: string };
/** Optional: states written before strength uploads have none. */
export type GarminUploadSettings = { mode: UploadMode; rides: Record<string, RideUpload>; workouts?: Record<string, RideUpload> };

/** Plain on purpose: no exercises, sets, weights or heart rate go to Garmin. */
export const STRENGTH_ACTIVITY_NAME = 'Krafttraining';

/** Off until the rider switches it on. Nothing ever goes up by itself: every upload is confirmed in a preview. */
export const uploadSettings = (s: { garminUpload?: GarminUploadSettings }): GarminUploadSettings => {
  const u = s.garminUpload;
  if (!u) return { mode: 'off', rides: {}, workouts: {} };
  return { mode: u.mode === 'off' ? 'off' : 'ask', rides: u.rides, workouts: u.workouts ?? {} };
};

export const withUploadMode = (s: { garminUpload?: GarminUploadSettings }, mode: UploadMode): GarminUploadSettings => ({ ...uploadSettings(s), mode });

export const REPO_DESCRIPTION = 'Gefahren mit Pandafit 🚴 https://github.com/Basti93/pandafit #vibeIt';

/** Simple on purpose and from the data, so that no fanciful session name ends up in Garmin. */
export const activityName = (ride: Pick<RideSummary, 'sessionId' | 'intervalsPlanned' | 'intensityFactor'>): string => {
  const base = 'Indoor Cycling';
  if (ride.sessionId === RAMP_ID) return `${base} Rampentest`;
  if (ride.intervalsPlanned) return `${base} Intervalle`;
  const f = ride.intensityFactor;
  if (f === null) return base;
  if (f < 0.56) return `${base} Locker`;
  if (f < 0.76) return `${base} Grundlage`;
  return `${base} ${f < 0.91 ? 'Tempo' : 'Hart'}`;
};
