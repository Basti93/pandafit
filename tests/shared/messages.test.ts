import { parseClientMessage } from '../../src/shared/ride-messages';
import { parseCoachClientMessage } from '../../src/shared/coach-messages';

const ride = (m: unknown) => parseClientMessage(JSON.stringify(m));

test('ride messages: valid ones pass, wrong types, NaN-like and unknown types are rejected', () => {
  expect(ride({ type: 'adjust', deltaPct: 5 })).toEqual({ type: 'adjust', deltaPct: 5 });
  expect(ride({ type: 'mark' })).toEqual({ type: 'mark' });
  expect(ride({ type: 'stop' })).toEqual({ type: 'stop' });
  expect(ride({ type: 'device-connect', kind: 'trainer' })).not.toBeNull();
  expect(ride({ type: 'adjust', deltaPct: 'x' })).toBeNull();
  expect(ride({ type: 'adjust', deltaPct: null })).toBeNull();
  expect(ride({ type: 'adjust', deltaPct: 1e9 })).toBeNull();
  expect(parseClientMessage('{"type":"adjust","deltaPct":1e999}')).toBeNull();
  expect(ride({ type: 'adjust' })).toBeNull();
  expect(ride({ type: 'device-connect', kind: 'toaster' })).toBeNull();
  expect(ride({ type: 'format-disk' })).toBeNull();
  expect(ride({ type: 'start', profileId: 'p', ftpW: 'x', session: {} })).toBeNull();
  expect(ride([])).toBeNull();
  expect(parseClientMessage('not json')).toBeNull();
});
test('ride start keeps the optional heart rate fields', () => {
  const session = { id: 's', name: 'S', steps: [{ kind: 'erg', ftpFraction: 0.6, durationS: 60, label: 'x' }] };
  expect(ride({ type: 'start', profileId: 'p', session, ftpW: 200, maxHrBpm: 180 })).toMatchObject({ type: 'start', ftpW: 200, maxHrBpm: 180 });
  expect(ride({ type: 'start', profileId: 'p', session, ftpW: Infinity })).toBeNull();
});

test('coach messages: valid ones pass, wrong types and unknown types are rejected', () => {
  expect(parseCoachClientMessage({ type: 'set-ftp', profileId: 'p', ftpW: 210 })).not.toBeNull();
  expect(parseCoachClientMessage({ type: 'set-ftp', profileId: 'p', ftpW: 'x' })).toBeNull();
  expect(parseCoachClientMessage({ type: 'set-ftp', profileId: 'p', ftpW: NaN })).toBeNull();
  expect(parseCoachClientMessage({ type: 'feedback', profileId: 'p', rideId: 'r', rating: 'fine' })).toBeNull();
  expect(parseCoachClientMessage({ type: 'feedback', profileId: 'p', rideId: 'r', rating: 'easy' })).not.toBeNull();
  expect(parseCoachClientMessage({ type: 'nope', profileId: 'p' })).toBeNull();
  expect(parseCoachClientMessage('x')).toBeNull();
  expect(parseCoachClientMessage({ type: 'subscribe' })).toBeNull();
  expect(parseCoachClientMessage({ type: 'meals-swap', profileId: 'p', week: 'w', meal: 'm', ai: true })).not.toBeNull();
  expect(parseCoachClientMessage({ type: 'queued', qid: 'q', atMs: 1, message: { type: 'note', profileId: 'p', text: 't' } })).not.toBeNull();
  expect(parseCoachClientMessage({ type: 'queued', qid: 'q', atMs: 1, message: { type: 'note', profileId: 'p', text: 5 } })).toBeNull();
});
test('live messages are passed on for their own parsers', () => {
  expect(parseCoachClientMessage({ type: 'live-end', profileId: 'p', rideId: 'r' })).not.toBeNull();
});
