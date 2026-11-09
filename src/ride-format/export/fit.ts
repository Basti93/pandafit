import { Encoder, Profile } from '@garmin/fitsdk';
import type { RideMeta } from '../../service/recorder';
import type { RideEvent, Sample } from '../../shared/sample';

const NUM = Profile.MesgNum;
const present = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export const exportFit = (ride: { meta: RideMeta; samples: Sample[]; events: RideEvent[] }): Buffer => {
  const { meta, samples, events } = ride;
  const start = new Date(meta.startedAtMs);
  const end = new Date(samples.at(-1)?.wallClockMs ?? meta.startedAtMs);
  const elapsedS = Math.round((end.getTime() - start.getTime()) / 1000);
  const timerS = samples.at(-1)?.rideElapsedS ?? 0;
  const summary = present({
    timestamp: end, startTime: start, totalElapsedTime: elapsedS, totalTimerTime: timerS,
    avgPower: avg(samples.map((s) => s.powerW)), avgHeartRate: avg(samples.map((s) => s.hrBpm)),
    avgCadence: avg(samples.map((s) => s.cadenceRpm)),
    totalDistance: samples.reduce((d, s) => d + (s.speedKph ?? 0) / 3.6, 0),
  });
  const e = new Encoder();
  e.onMesg(NUM.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: start, serialNumber: 1 });
  const timer = (at: Date, eventType: 'start' | 'stopAll') => e.onMesg(NUM.EVENT, { timestamp: at, event: 'timer', eventType });
  timer(start, 'start');
  for (const ev of events) {
    if (ev.type === 'pause') timer(new Date(ev.wallClockMs), 'stopAll');
    if (ev.type === 'resume') timer(new Date(ev.wallClockMs), 'start');
  }
  for (const s of samples) {
    e.onMesg(NUM.RECORD, present({
      timestamp: new Date(s.wallClockMs), power: s.powerW, heartRate: s.hrBpm,
      cadence: s.cadenceRpm === null ? null : Math.round(s.cadenceRpm), speed: s.speedKph === null ? null : s.speedKph / 3.6,
    }));
  }
  timer(end, 'stopAll');
  e.onMesg(NUM.LAP, { ...summary, messageIndex: 0 });
  e.onMesg(NUM.SESSION, { ...summary, sport: 'cycling', subSport: 'indoorCycling', firstLapIndex: 0, numLaps: 1, messageIndex: 0 });
  e.onMesg(NUM.ACTIVITY, { timestamp: end, totalTimerTime: timerS, numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop' });
  return Buffer.from(e.close());
};
