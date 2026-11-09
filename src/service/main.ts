import { requireLocalToken, servicePort } from '../shared/node/local-token';
import { FakeBlePort } from './ble/fake-device';
import { NobleBlePort } from './ble/noble-adapter';
import { SimBlePort } from './ble/sim-device';
import type { BlePort, DeviceKind } from './ble/device-port';
import { Diagnostics, withDiagnostics } from './diagnostics';
import { LiveLog } from './live-log';
import { RideService } from './ride-service';
import { startWsServer } from './ws-server';

const dir = process.env.BIKE_DATA_DIR;
if (!dir) throw new Error('BIKE_DATA_DIR fehlt');
const scale = Number(process.env.BIKE_TIME_SCALE ?? 1);
const started = Date.now();
const nowMs = () => started + (Date.now() - started) * scale;
const fake = process.env.BIKE_FAKE_BLE === '1' ? new FakeBlePort() : null;
const sim = process.env.BIKE_SIM === '1' ? new SimBlePort() : null;
const diagnostics = new Diagnostics(dir, nowMs);
const ble: BlePort = withDiagnostics(fake ?? sim ?? new NobleBlePort(dir), diagnostics, nowMs);
if (sim) setInterval(() => sim.step(1), 1000 / scale);

const parent = (process as unknown as { parentPort?: { postMessage(m: unknown): void } }).parentPort;
const live = new LiveLog(dir);
const service = new RideService({
  dir, ble, nowMs, diagnostics,
  retryMs: fake ? 20 : undefined,
  onLive: (l) => { live.write(l); diagnostics.write('ride', l); },
  onRideStart: () => live.reset(),
  onRideChange: (riding) => parent?.postMessage({ riding }),
});
const wss = startWsServer(service, {
  port: servicePort(7410),
  token: requireLocalToken(),
  devOrigin: process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : undefined,
});
setInterval(() => {
  try { service.tick(); } catch (e) { console.error('Fahrtakt-Fehler', e); }
}, 1000 / scale);

if (fake) {
  setInterval(() => {
    fake.emit('trainer', Buffer.from([0x41, 0x00, 0xC8, 0x00]));
    fake.emit('hr', Buffer.from([0x00, 140]));
  }, 200 / scale);
  // For tests only: "drop trainer" and "back trainer" over stdin.
  process.stdin.on('data', (raw) => {
    const [cmd, kind] = String(raw).trim().split(' ');
    if (cmd === 'drop') fake.drop(kind as DeviceKind);
    if (cmd === 'back') fake.online[kind as DeviceKind] = true;
  });
}
wss.once('listening', () => process.stdout.write('ready\n'));
