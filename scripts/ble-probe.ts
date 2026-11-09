/* Throwaway check program for the device test (Plan Task 2). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import noble from '@stoprocent/noble';
import { encodeRequestControl, encodeSimulation, encodeTargetPower, parseIndoorBikeData } from '../src/service/ble/ftms-codec';
import { parseHeartRate } from '../src/service/ble/hr-codec';

const n = noble as any;
let control: any;
let grade = 0;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

const setup = async (p: any) => {
  const name = p.advertisement.localName ?? p.id;
  const uuids: string[] = p.advertisement.serviceUuids ?? [];
  log('gefunden', name, uuids.join(','));
  await p.connectAsync();
  const { services, characteristics } = await p.discoverAllServicesAndCharacteristicsAsync();
  log(name, 'Dienste', services.map((s: any) => s.uuid).join(','));
  for (const c of characteristics) {
    if (c.uuid === '2ad2') { c.on('data', (b: Buffer) => log('Trainer', parseIndoorBikeData(b))); await c.subscribeAsync(); }
    else if (c.uuid === '2a37') { c.on('data', (b: Buffer) => log('Puls', parseHeartRate(b))); await c.subscribeAsync(); }
    else if (c.uuid === '2ad9') {
      control = c;
      await c.subscribeAsync().catch(() => {});
      await c.writeAsync(encodeRequestControl(), false);
      log('Trainer unter Kontrolle');
    } else if (/zwift|click/i.test(name) && c.properties.includes('notify')) {
      c.on('data', (b: Buffer) => log('Clicker roh', c.uuid, b.toString('hex')));
      await c.subscribeAsync().catch((e: Error) => log('kein Abo', c.uuid, e.message));
    }
  }
};

n.on('discover', (p: any) => {
  const name = p.advertisement.localName ?? '';
  const uuids: string[] = p.advertisement.serviceUuids ?? [];
  if (uuids.includes('1826') || uuids.includes('180d') || /click/i.test(name)) void setup(p).catch((e) => log('Fehler', name, e.message));
});
await n.waitForPoweredOnAsync(15000);
await n.startScanningAsync([], false);
log('Tasten: e = 150 W, g/h = Steigung ±0,5 %, q = Ende');
process.stdin.setRawMode?.(true);
process.stdin.on('data', async (raw) => {
  const k = String(raw);
  if (k === 'q' || k === '\u0003') process.exit(0);
  if (!control) { log('Trainer noch nicht verbunden'); return; }
  if (k === 'e') await control.writeAsync(encodeTargetPower(150), false);
  if (k === 'g') { grade += 0.5; await control.writeAsync(encodeSimulation(grade), false); log('Steigung', grade); }
  if (k === 'h') { grade -= 0.5; await control.writeAsync(encodeSimulation(grade), false); log('Steigung', grade); }
});
