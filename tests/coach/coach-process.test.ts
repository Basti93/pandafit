import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { rampTest } from '../../src/shared/ramp';
import { TOKEN, connect, hardKill, rideId, send, session, sleep, startService, waitForSamples, type Svc } from '../chaos/helpers';
import { readRide } from '../../src/ride-format/read';

type Coach = { child: ChildProcess; port: number };
let port = 7700;
let coaches: Coach[] = [];
let services: Svc[] = [];
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
const good = { id: 'ki', name: 'KI', steps: [
  { kind: 'erg', durationS: 300, ftpFraction: 0.5, label: 'Warmup' },
  { kind: 'erg', durationS: 1200, ftpFraction: 0.65, label: 'Locker' },
] };
const answer = { phase: { name: 'Aufbau', weeksLeft: 3, goal: 'x' }, ftpForecast: [], session: good, reason: 'Von KI', change: 'neu' };
const fakeClaude = (body = `echo '${JSON.stringify({ structured_output: answer })}'`) => {
  const bin = path.join(temp(), 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return bin;
};
const seed = (root: string) => {
  const rides = path.join(root, 'rides');
  fs.mkdirSync(path.join(rides, 'ride-1000'), { recursive: true });
  fs.writeFileSync(path.join(rides, 'profiles.json'), JSON.stringify([{ id: 'pa', name: 'A', ftpW: 200 }]));
  const s = rampTest(200);
  fs.writeFileSync(path.join(rides, 'ride-1000', 'meta.json'), JSON.stringify({ rideId: 'ride-1000', profileId: 'pa', sessionId: s.id, startedAtMs: Date.now() - 3600_000, status: 'finished' }));
  fs.writeFileSync(path.join(rides, 'ride-1000', 'session.json'), JSON.stringify({ session: s, ftpW: 200 }));
  fs.writeFileSync(path.join(rides, 'ride-1000', 'samples.jsonl'), Array.from({ length: 600 }, (_, i) => JSON.stringify({ seq: i, wallClockMs: i, rideElapsedS: i + 1, powerW: 260, cadenceRpm: 90, speedKph: 30, hrBpm: 150, targetW: 260, gradePct: null, gear: null })).join('\n') + '\n');
  return rides;
};
const startCoach = async (root: string, bin: string, extra: Record<string, string> = {}): Promise<Coach> => {
  const p = port++;
  const child = spawn('npx', ['tsx', 'src/coach/main.ts'], {
    env: { ...process.env, BIKE_DATA_DIR: path.join(root, 'rides'), BIKE_COACH_DIR: path.join(root, 'coach'), BIKE_CLAUDE_BIN: bin, BIKE_COACH_PORT: String(p), PANDAFIT_LOCAL_TOKEN: TOKEN, BIKE_COACH_SCAN_MS: '50', ...extra },
    stdio: ['ignore', 'pipe', 'inherit'], detached: true,
  });
  await new Promise<void>((r) => child.stdout!.once('data', () => r()));
  const c = { child, port: p };
  coaches.push(c);
  return c;
};
const subscribe = (p: number) => new Promise<{ ws: WebSocket; last: () => any }>((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${p}/?t=${TOKEN}`);
  let last: any = null;
  // Other pushes (records-changed) come between: the helper keeps the last coach state.
  ws.on('message', (m) => { const x = JSON.parse(String(m)); if (x?.type !== 'records-changed') last = x; });
  ws.once('open', () => { ws.send(JSON.stringify({ type: 'subscribe', profileId: 'pa' })); resolve({ ws, last: () => last }); });
  ws.once('error', reject);
});
const until = async (fn: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(20); }
  throw new Error('Zeitlimit');
};
afterEach(async () => {
  for (const c of coaches) { try { process.kill(-c.child.pid!, 'SIGKILL'); } catch { /* already ended */ } }
  for (const s of services) await hardKill(s).catch(() => {});
  coaches = []; services = [];
});

test('finished ride with feedback leads to a new next session', async () => {
  const root = temp(); seed(root);
  const c = await startCoach(root, fakeClaude());
  const sub = await subscribe(c.port);
  await until(() => sub.last()?.state?.awaitingFeedback === 'ride-1000');
  sub.ws.send(JSON.stringify({ type: 'feedback', profileId: 'pa', rideId: 'ride-1000', rating: 'right' }));
  await until(() => sub.last()?.state?.next?.source === 'claude');
  expect(sub.last().state.next.reason).toBe('Von KI');
  sub.ws.close();
}, 20000);
test('without feedback the plan still updates after the waiting time', async () => {
  const root = temp(); seed(root);
  const c = await startCoach(root, fakeClaude(), { BIKE_COACH_WAIT_MS: '100' });
  const sub = await subscribe(c.port);
  await until(() => sub.last()?.state?.next?.source === 'claude');
  sub.ws.close();
}, 20000);
test('hanging claude does not block state requests', async () => {
  const root = temp(); seed(root);
  const c = await startCoach(root, fakeClaude('sleep 30'), { BIKE_COACH_WAIT_MS: '0' });
  const sub = await subscribe(c.port);
  await until(() => sub.last()?.thinking === true);
  const second = await subscribe(c.port);
  await until(() => second.last()?.state?.profileId === 'pa');
  expect(second.last().state.next.session.id).toMatch(/^regel-/);
  sub.ws.close(); second.ws.close();
}, 20000);
test('missing claude still answers with a rule session and lastError missing', async () => {
  const root = temp(); seed(root);
  const c = await startCoach(root, '/nicht/da/claude', { BIKE_COACH_WAIT_MS: '0' });
  const sub = await subscribe(c.port);
  await until(() => sub.last()?.state?.lastError === 'missing');
  expect(sub.last().state.next.session.id).toMatch(/^regel-/);
  sub.ws.close();
}, 20000);
test('no call while a ride is open', async () => {
  const root = temp(); const rides = seed(root);
  fs.mkdirSync(path.join(rides, 'ride-2000'));
  fs.writeFileSync(path.join(rides, 'ride-2000', 'meta.json'), JSON.stringify({ rideId: 'ride-2000', profileId: 'pa', sessionId: 's', startedAtMs: Date.now(), status: 'open' }));
  const marker = path.join(root, 'called');
  const c = await startCoach(root, fakeClaude(`touch ${marker}; echo '{}'`), { BIKE_COACH_WAIT_MS: '0' });
  await sleep(500);
  expect(fs.existsSync(marker)).toBe(false);
  void c;
}, 20000);
test('foreign origin is rejected', async () => {
  const root = temp(); seed(root);
  const c = await startCoach(root, fakeClaude());
  const opened = await new Promise((r) => {
    const ws = new WebSocket(`ws://127.0.0.1:${c.port}/?t=${TOKEN}`, { origin: 'https://evil.example' });
    ws.once('open', () => r(true)); ws.once('error', () => r(false));
  });
  expect(opened).toBe(false);
}, 20000);
test('invalid message does not crash the coach', async () => {
  const root = temp(); seed(root);
  const c = await startCoach(root, fakeClaude());
  const sub = await subscribe(c.port);
  sub.ws.send('kein json');
  sub.ws.send(JSON.stringify({ type: 'feedback', profileId: 'gibt-es-nicht', rideId: 'x', rating: 'right' }));
  await sleep(100);
  await until(() => sub.last()?.state?.profileId === 'pa');
  sub.ws.close();
}, 20000);
test('coach crash leaves the ride service recording', async () => {
  const root = temp();
  const dir = path.join(root, 'rides');
  fs.mkdirSync(dir, { recursive: true });
  const svc = await startService(dir); services.push(svc);
  await send(svc.port, { type: 'start', profileId: 'pa', session: session(1000), ftpW: 200 });
  const c = await startCoach(root, fakeClaude());
  await waitForSamples(dir, 5);
  process.kill(-c.child.pid!, 'SIGKILL');
  const n = readRide(dir, rideId(dir)).samples.length;
  await waitForSamples(dir, n + 10);
  void connect;
}, 20000);
