import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDataDir, coachPort, ensureLocalToken, readLocalToken, requireLocalToken, servicePort, tokenMatches } from '../../src/shared/node/local-token';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tok-'));

test('creates a 64-hex token once, mode 0600, and keeps it', () => {
  const d = tmp();
  expect(readLocalToken(d)).toBeNull();
  const t = ensureLocalToken(d);
  expect(t).toMatch(/^[0-9a-f]{64}$/);
  expect(ensureLocalToken(d)).toBe(t);
  expect(readLocalToken(d)).toBe(t);
  expect(fs.statSync(path.join(d, 'local-token')).mode & 0o777).toBe(0o600);
});
test('a broken token file is replaced', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'local-token'), 'x');
  expect(readLocalToken(d)).toBeNull();
  expect(ensureLocalToken(d)).toMatch(/^[0-9a-f]{64}$/);
});
test('tokenMatches', () => {
  expect(tokenMatches('abc', 'abc')).toBe(true);
  expect(tokenMatches('abc', 'abd')).toBe(false);
  expect(tokenMatches('abc', 'abcd')).toBe(false);
  expect(tokenMatches('abc', null)).toBe(false);
  expect(tokenMatches('abc', '')).toBe(false);
});
test('requireLocalToken: variable, then file next to rides/, else throws', () => {
  const d = tmp();
  const rides = path.join(d, 'rides');
  expect(appDataDir({ BIKE_DATA_DIR: rides })).toBe(d);
  expect(() => requireLocalToken({ BIKE_DATA_DIR: rides })).toThrow();
  const t = ensureLocalToken(d);
  expect(requireLocalToken({ BIKE_DATA_DIR: rides })).toBe(t);
  expect(requireLocalToken({ BIKE_DATA_DIR: rides, PANDAFIT_LOCAL_TOKEN: 'envtoken' })).toBe('envtoken');
});
test('port variables: new name wins, old names stay readable', () => {
  expect(servicePort(7410, {})).toBe(7410);
  expect(servicePort(7410, { BIKE_PORT: '1' })).toBe(1);
  expect(servicePort(7410, { BIKE_SERVICE_PORT: '2', BIKE_PORT: '1' })).toBe(2);
  expect(servicePort(7410, { PANDAFIT_SERVICE_PORT: '3', BIKE_PORT: '1' })).toBe(3);
  expect(coachPort(7411, { BIKE_COACH_PORT: '4' })).toBe(4);
  expect(coachPort(7411, { PANDAFIT_COACH_PORT: '5', BIKE_COACH_PORT: '4' })).toBe(5);
});
