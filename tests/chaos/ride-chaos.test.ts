import { readRide } from '../../src/service/recorder';
import { connect, hardKill, rideId, send, session, sleep, startService, tempDir, waitForSamples, waitForStatus, type Svc } from './helpers';

let running: Svc | null = null;
afterEach(async () => { if (running) { await hardKill(running).catch(() => {}); running = null; } });
const begin = async (dir: string, durationS = 100) => {
  running = await startService(dir);
  await send(running.port, { type: 'start', profileId: 'A', session: session(durationS), ftpW: 200 });
};

test('SIGKILL at 80% loses at most 2 s and resumes in place', async () => {
  const dir = tempDir();
  await begin(dir);
  await waitForSamples(dir, 80);
  await hardKill(running!);
  const before = readRide(dir, rideId(dir)).samples.length;
  running = await startService(dir);
  await waitForStatus(dir, 'finished');
  const r = readRide(dir, rideId(dir));
  expect(r.samples.map((s) => s.seq)).toEqual(r.samples.map((_, i) => i));
  expect(r.samples.at(-1)!.rideElapsedS).toBe(100);
  expect(before).toBeGreaterThanOrEqual(78);
  expect(r.events.some((e) => e.type === 'resumed')).toBe(true);
}, 40000);

test('trainer drop for 30 s keeps ride running and marks gap', async () => {
  const dir = tempDir();
  await begin(dir);
  await waitForSamples(dir, 10);
  running!.child.stdin!.write('drop trainer\n');
  await waitForSamples(dir, 40);
  running!.child.stdin!.write('back trainer\n');
  await waitForStatus(dir, 'finished');
  const r = readRide(dir, rideId(dir));
  expect(r.samples).toHaveLength(100);
  expect(r.samples.some((s) => s.powerW === null)).toBe(true);
  expect(r.samples.at(-1)!.powerW).toBe(200);
  expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['device-lost', 'device-back']));
}, 40000);

test('UI client reconnects 20 times during ride without losing samples', async () => {
  const dir = tempDir();
  await begin(dir);
  for (let i = 0; i < 20; i++) {
    const ws = await connect(running!.port);
    await sleep(30);
    ws.terminate();
  }
  await waitForStatus(dir, 'finished');
  expect(readRide(dir, rideId(dir)).samples).toHaveLength(100);
}, 40000);

test('kill during write leaves readable ride', async () => {
  const dir = tempDir();
  await begin(dir, 1000);
  await waitForSamples(dir, 1); // the ride exists on disk before the first kill (under load the start can take longer than the send)
  for (let i = 0; i < 6; i++) {
    await sleep(100 + Math.random() * 200);
    await hardKill(running!);
    const r = readRide(dir, rideId(dir));
    expect(r.samples.map((s) => s.seq)).toEqual(r.samples.map((_, k) => k));
    running = await startService(dir);
  }
  expect(readRide(dir, rideId(dir)).meta.status).toBe('open');
}, 60000);
