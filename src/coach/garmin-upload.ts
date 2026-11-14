import { uploadSettings } from '../shared/garmin-upload';
import type { CoachState } from './state';

/** Only known rides that are not up or on their way. */
export const canUpload = (s: CoachState, rideId: string): boolean => {
  if (!s.summaries.some((r) => r.rideId === rideId)) return false;
  const status = uploadSettings(s).rides[rideId]?.status;
  return status !== 'uploaded' && status !== 'uploading';
};

/** Only finished, own, not deleted workouts that are not up or on their way. */
export const canUploadWorkout = (s: CoachState, workout: { id: string; source: string; endMs: number | null; deleted?: boolean } | undefined): boolean => {
  if (!workout || workout.source !== 'pandafit' || workout.endMs === null || workout.deleted) return false;
  const status = uploadSettings(s).workouts?.[workout.id]?.status;
  return status !== 'uploaded' && status !== 'uploading';
};
