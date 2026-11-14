import { Encoder, Profile } from '@garmin/fitsdk';

const NUM = Profile.MesgNum;

/** FIT-Datei für ein Krafttraining: nur Start und Dauer, keine Records. */
export const exportStrengthFit = (w: { startMs: number; endMs: number }): Buffer => {
  const start = new Date(w.startMs);
  const end = new Date(w.endMs);
  const durationS = Math.round((w.endMs - w.startMs) / 1000);
  const summary = { timestamp: end, startTime: start, totalElapsedTime: durationS, totalTimerTime: durationS };
  const e = new Encoder();
  e.onMesg(NUM.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: start, serialNumber: 1 });
  e.onMesg(NUM.EVENT, { timestamp: start, event: 'timer', eventType: 'start' });
  e.onMesg(NUM.EVENT, { timestamp: end, event: 'timer', eventType: 'stopAll' });
  e.onMesg(NUM.LAP, { ...summary, messageIndex: 0, sport: 'training', subSport: 'strengthTraining' });
  e.onMesg(NUM.SESSION, { ...summary, sport: 'training', subSport: 'strengthTraining', firstLapIndex: 0, numLaps: 1, messageIndex: 0 });
  e.onMesg(NUM.ACTIVITY, { timestamp: end, totalTimerTime: durationS, numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop' });
  return Buffer.from(e.close());
};
