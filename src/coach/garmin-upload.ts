import { uploadSettings } from '../shared/garmin-upload';
import type { CoachState } from './state';

/** Only known rides that are not up or on their way. */
export const canUpload = (s: CoachState, rideId: string): boolean => {
  if (!s.summaries.some((r) => r.rideId === rideId)) return false;
  const status = uploadSettings(s).rides[rideId]?.status;
  return status !== 'uploaded' && status !== 'uploading';
};
