import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { readRide } from '../../src/ride-format/read';
import type { Session } from '../../src/shared/session';

export const SCALE = 20;
let nextPort = 7500;
export const TOKEN = 'c'.repeat(64);
export const session = (durationS = 100): Session => ({ id: 's', name: 'Chaos', steps: [{ kind: 'erg', durationS, ftpFraction: 0.5, label: 'A' }] });
export const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-'));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Svc = { child: ChildProcess; port: number };
export const startService = async (dir: string): Promise<Svc> => {
  const port = nextPort++;
  const child = spawn('npx', ['tsx', 'src/service/main.ts'], {
    env: { ...process.env, BIKE_FAKE_BLE: '1', BIKE_DATA_DIR: dir, BIKE_TIME_SCALE: String(SCALE), BIKE_PORT: String(port), PANDAFIT_LOCAL_TOKEN: TOKEN },
    stdio: ['pipe', 'pipe', 'inherit'], detached: true,
  });
  await new Promise<void>((resolve) => child.stdout!.once('data', () => resolve()));
  return { child, port };
};
/** SIGKILL on the whole process group, like a hard crash. */
export const hardKill = async (svc: Svc) => {
  process.kill(-svc.child.pid!, 'SIGKILL');
  await sleep(50);
};
export const connect = (port: number): Promise<WebSocket> => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${TOKEN}`);
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
});
export const send = async (port: number, msg: object) => {
  const ws = await connect(port);
  ws.send(JSON.stringify(msg));
  await sleep(20);
  ws.close();
};
export const rideId = (dir: string) => fs.readdirSync(dir).find((n) => n.startsWith('ride-'))!;
/** The service creates the ride folder just before its meta.json, so a poll can land between the two. */
const readRideIfStarted = (dir: string) => {
  const id = rideId(dir);
  if (!id || !fs.existsSync(path.join(dir, id, 'meta.json'))) return null;
  return readRide(dir, id);
};
export const waitForSamples = async (dir: string, n: number, timeoutMs = 15000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((readRideIfStarted(dir)?.samples.length ?? 0) >= n) return;
    await sleep(10);
  }
  throw new Error(`nur ${readRideIfStarted(dir)?.samples.length ?? 0} statt ${n} Samples`);
};
export const waitForStatus = async (dir: string, status: string, timeoutMs = 15000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (readRideIfStarted(dir)?.meta.status === status) return;
    await sleep(20);
  }
  throw new Error(`Status nicht ${status}`);
};
