import { Decoder, Stream } from '@garmin/fitsdk';
import { exportFit } from '../../src/ride-format/export/fit';
import type { RideMeta } from '../../src/ride-format/read';
import type { Sample } from '../../src/shared/sample';

const T0 = Date.UTC(2026, 9, 31, 12);
const meta: RideMeta = { rideId: 'r', profileId: 'p', sessionId: 's', startedAtMs: T0, status: 'finished' };
const sample = (i: number, over: Partial<Sample> = {}): Sample => ({ seq: i, wallClockMs: T0 + i * 1000, rideElapsedS: i + 1, powerW: 200 + i, cadenceRpm: 90, speedKph: 30, hrBpm: 140, targetW: 200, gradePct: null, gear: null, ...over });
const decode = (b: Buffer) => {
  const d = new Decoder(Stream.fromBuffer(b));
  expect(d.isFIT()).toBe(true);
  expect(d.checkIntegrity()).toBe(true);
  return d.read();
};
test('round trip keeps record count, power and heart rate', () => {
  const { messages, errors } = decode(exportFit({ meta, samples: [sample(0), sample(1)], events: [] }));
  expect(errors).toEqual([]);
  expect(messages.recordMesgs.map((m: any) => m.power)).toEqual([200, 201]);
  expect(messages.recordMesgs.map((m: any) => m.heartRate)).toEqual([140, 140]);
});
test('null readings are omitted, not zero', () => {
  const { messages } = decode(exportFit({ meta, samples: [sample(0, { powerW: null, hrBpm: null })], events: [] }));
  expect(messages.recordMesgs[0].power).toBeUndefined();
  expect(messages.recordMesgs[0].heartRate).toBeUndefined();
});
test('aborted ride exports too', () => {
  const { messages } = decode(exportFit({ meta: { ...meta, status: 'aborted' }, samples: [sample(0)], events: [] }));
  expect(messages.activityMesgs).toHaveLength(1);
});
test('sport is cycling, sub sport indoor cycling', () => {
  const { messages } = decode(exportFit({ meta, samples: [sample(0)], events: [] }));
  expect(messages.sessionMesgs[0].sport).toBe('cycling');
  expect(messages.sessionMesgs[0].subSport).toBe('indoorCycling');
});
test('timer time ignores gaps', () => {
  const samples = [sample(0), sample(1, { wallClockMs: T0 + 301000 })];
  const { messages } = decode(exportFit({ meta, samples, events: [] }));
  expect(messages.sessionMesgs[0].totalTimerTime).toBe(2);
  expect(messages.sessionMesgs[0].totalElapsedTime).toBe(301);
});
test('ride without samples still exports', () => {
  expect(() => decode(exportFit({ meta, samples: [], events: [] }))).not.toThrow();
});

test('timer events, average cadence and distance are written, pauses stop the timer', () => {
  const events = [{ wallClockMs: T0 + 500, type: 'pause' as const }, { wallClockMs: T0 + 900, type: 'resume' as const }];
  const { messages, errors } = decode(exportFit({ meta, samples: [sample(0, { cadenceRpm: 80, speedKph: 36 }), sample(1, { cadenceRpm: 90, speedKph: 36 })], events }));
  expect(errors).toEqual([]);
  const ev = messages.eventMesgs.filter((m: any) => m.event === 'timer').map((m: any) => m.eventType);
  expect(ev).toEqual(['start', 'stopAll', 'start', 'stopAll']);
  expect(messages.sessionMesgs[0].avgCadence).toBe(85);
  expect(messages.sessionMesgs[0].totalDistance).toBeCloseTo(20, 0);
});
