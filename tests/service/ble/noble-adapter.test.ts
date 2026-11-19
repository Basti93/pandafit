import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NobleBlePort } from '../../../src/service/ble/noble-adapter';

const peripheral = (service: string) => {
  const p: any = new EventEmitter();
  p.id = service; p.advertisement = { serviceUuids: [service] };
  p.connectAsync = async () => {};
  p.discoverSomeServicesAndCharacteristicsAsync = async () => ({ characteristics: [
    Object.assign(new EventEmitter(), { uuid: service === '1826' ? '2ad2' : '2a37', subscribeAsync: async () => {} }),
    Object.assign(new EventEmitter(), { uuid: '2ad9', subscribeAsync: async () => {} }),
  ] });
  return p;
};
const fakeNoble = () => {
  const n: any = new EventEmitter();
  n.scans = 0; n.maxConcurrent = 0;
  n.waitForPoweredOnAsync = async () => {};
  n.startScanningAsync = async ([s]: string[]) => {
    n.scans++; n.maxConcurrent = Math.max(n.maxConcurrent, n.scans);
    setTimeout(() => n.emit('discover', peripheral(s)), 5);
  };
  n.stopScanningAsync = async () => { n.scans--; };
  return n;
};
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'noble-'));

test('scans never overlap, so trainer and strap both connect', async () => {
  const n = fakeNoble();
  const port = new NobleBlePort(dir(), n);
  await Promise.all([port.connect('trainer'), port.connect('hr')]);
  expect(n.maxConcurrent).toBe(1);
});
test('a failed connect does not block the next one', async () => {
  const n = fakeNoble();
  const port = new NobleBlePort(dir(), n);
  const orig = n.startScanningAsync;
  n.startScanningAsync = async () => { n.startScanningAsync = orig; throw new Error('bt aus'); };
  await expect(port.connect('trainer')).rejects.toThrow();
  await expect(port.connect('hr')).resolves.toBeUndefined();
});
test('drop during discovery fails the connect so it is retried, and frees the scan', async () => {
  const n = fakeNoble();
  const port = new NobleBlePort(dir(), n);
  const lost: string[] = [];
  port.onDisconnect((k) => lost.push(k));
  n.removeAllListeners('discover');
  n.startScanningAsync = async ([s]: string[]) => {
    n.scans++;
    const p = peripheral(s);
    p.discoverSomeServicesAndCharacteristicsAsync = async () => { p.emit('disconnect'); throw new Error('weg'); };
    setTimeout(() => n.emit('discover', p), 5);
  };
  await expect(port.connect('trainer')).rejects.toThrow();
  expect(lost).toEqual([]);
  expect(n.scans).toBe(0);
});

test('a hanging connect times out, disconnects and frees the queue', async () => {
  const n = fakeNoble();
  const port = new NobleBlePort(dir(), n, { connectTimeoutMs: 20 });
  const disconnect = vi.fn(async () => {});
  n.startScanningAsync = async () => {
    const p = peripheral('1826');
    p.connectAsync = () => new Promise(() => {});
    p.disconnectAsync = disconnect;
    setTimeout(() => n.emit('discover', p), 1);
  };
  await expect(port.connect('trainer')).rejects.toThrow();
  expect(disconnect).toHaveBeenCalled();
});
test('control responses and machine status reach the control callback', async () => {
  const n = fakeNoble();
  const port = new NobleBlePort(dir(), n);
  const got: number[][] = [];
  port.onControl((b) => got.push([...b]));
  const writer: any = Object.assign(new EventEmitter(), { uuid: '2ad9', subscribeAsync: async () => {} });
  const status: any = Object.assign(new EventEmitter(), { uuid: '2ada', subscribeAsync: async () => {} });
  const data: any = Object.assign(new EventEmitter(), { uuid: '2ad2', subscribeAsync: async () => {} });
  n.startScanningAsync = async () => {
    const p = peripheral('1826');
    p.discoverSomeServicesAndCharacteristicsAsync = async () => ({ characteristics: [data, writer, status] });
    setTimeout(() => n.emit('discover', p), 1);
  };
  await port.connect('trainer');
  writer.emit('data', Buffer.from([0x80, 0x05, 0x05]));
  status.emit('data', Buffer.from([0xff]));
  expect(got).toEqual([[0x80, 0x05, 0x05], [0xff]]);
});

const clickPeripheral = (mfr = Buffer.from([0x4a, 0x09, 0x09])) => {
  const p: any = new EventEmitter();
  p.id = 'click'; p.advertisement = { manufacturerData: mfr };
  p.connectAsync = async () => {};
  const async = Object.assign(new EventEmitter(), { uuid: '0000000219ca465186e5fa29dcdd09d1', subscribeAsync: vi.fn(async () => {}) });
  const rx = Object.assign(new EventEmitter(), { uuid: '0000000319ca465186e5fa29dcdd09d1', writeAsync: vi.fn(async () => {}) });
  const tx = Object.assign(new EventEmitter(), { uuid: '0000000419ca465186e5fa29dcdd09d1', subscribeAsync: vi.fn(async () => {}) });
  p.discoverAllServicesAndCharacteristicsAsync = async () => ({ characteristics: [async, rx, tx] });
  return { p, async, rx, tx };
};
test('the click gets the RideOn handshake and its buttons arrive', async () => {
  const n = fakeNoble(); const c = clickPeripheral();
  n.startScanningAsync = async () => { setTimeout(() => n.emit('discover', c.p), 1); };
  const port = new NobleBlePort(dir(), n);
  const got: number[][] = [];
  port.subscribe('clicker', (b) => got.push([...b]));
  await port.connect('clicker');
  expect(c.rx.writeAsync).toHaveBeenCalledWith(Buffer.from('RideOn'), true);
  expect(c.tx.subscribeAsync).toHaveBeenCalled();
  c.async.emit('data', Buffer.from([0x37, 0x08, 0x00, 0x10, 0x01]));
  expect(got).toEqual([[0x37, 0x08, 0x00, 0x10, 0x01]]);
});
test('other Zwift controllers are not taken for the click', async () => {
  const n = fakeNoble(); const other = clickPeripheral(Buffer.from([0x4a, 0x09, 0x0a]));
  n.startScanningAsync = async () => { setTimeout(() => n.emit('discover', other.p), 1); };
  const port = new NobleBlePort(dir(), n, { clickerScanMs: 20 });
  await expect(port.connect('clicker')).rejects.toThrow();
});
test('the trainer goes ahead of a waiting clicker and strap', async () => {
  const n = fakeNoble();
  const order: string[] = [];
  const orig = n.startScanningAsync;
  n.startScanningAsync = async (a: string[]) => { order.push(a[0] ?? 'clicker'); return orig(a.length ? a : ['x']); };
  const port = new NobleBlePort(dir(), n, { clickerScanMs: 20 });
  const a = port.connect('hr').catch(() => {});
  const b = port.connect('clicker').catch(() => {});
  const c = port.connect('trainer').catch(() => {});
  await Promise.all([a, b, c]);
  expect(order).toEqual(['180d', '1826', 'clicker']);
});

const click = () => {
  const uuid = (n: number) => `0000000${n}19ca465186e5fa29dcdd09d1`;
  const p: any = new EventEmitter();
  p.id = 'click'; p.advertisement = { localName: 'Zwift Click', manufacturerData: Buffer.from([0x4a, 0x09, 0x09]) };
  p.connectAsync = async () => {};
  // Like noble: if a requested service is missing, the discovery fails.
  p.discoverSomeServicesAndCharacteristicsAsync = async (services: string[]) => {
    if (services.length > 1) throw 'Could not find all requested services';
    return { characteristics: [] };
  };
  p.discoverAllServicesAndCharacteristicsAsync = async () => ({ characteristics: [2, 3, 4].map((n) =>
    Object.assign(new EventEmitter(), { uuid: uuid(n), subscribeAsync: async () => {}, writeAsync: async () => {} })) });
  return p;
};
test('a click that offers only one of its possible services still connects and reports its name', async () => {
  const n = fakeNoble();
  n.startScanningAsync = async () => { n.scans++; setTimeout(() => n.emit('discover', click()), 5); };
  const port = new NobleBlePort(dir(), n);
  await port.connect('clicker');
  expect(port.deviceName('clicker')).toBe('Zwift Click');
});

test('a hanging disconnectAsync and stopScanningAsync do not block the next connect', async () => {
  const n = fakeNoble();
  const port = new NobleBlePort(dir(), n, { connectTimeoutMs: 20, cleanupTimeoutMs: 20 });
  const orig = n.startScanningAsync;
  n.startScanningAsync = async () => {
    const p = peripheral('1826');
    p.connectAsync = () => new Promise(() => {});
    p.disconnectAsync = () => new Promise(() => {});
    setTimeout(() => n.emit('discover', p), 1);
  };
  n.stopScanningAsync = () => new Promise(() => {});
  await expect(port.connect('trainer')).rejects.toThrow();
  n.startScanningAsync = orig;
  n.stopScanningAsync = async () => { n.scans--; };
  await expect(port.connect('hr')).resolves.toBeUndefined();
});
test('an attempt that never returns is cut off and frees the queue', async () => {
  const n = fakeNoble();
  const port = new NobleBlePort(dir(), n, { attemptTimeoutMs: 30 });
  n.waitForPoweredOnAsync = () => new Promise(() => {});
  await expect(port.connect('hr')).rejects.toThrow(/Zeitüberschreitung/);
  n.waitForPoweredOnAsync = async () => {};
  await expect(port.connect('hr')).resolves.toBeUndefined();
});


const named = (service: string, id: string, localName: string, extra: any = {}) => {
  const p = peripheral(service);
  p.id = id; p.advertisement = { serviceUuids: [service], localName, ...extra };
  return p;
};
const scanFinds = (n: any, list: any[]) => { n.startScanningAsync = async () => { list.forEach((p, i) => setTimeout(() => n.emit('discover', p), 1 + i)); }; };
test('a strap with a new peripheral id is found by its name and the new id is saved', async () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'devices.json'), JSON.stringify({ hr: { id: 'old', name: 'Polar H10 1234' } }));
  const n = fakeNoble();
  scanFinds(n, [named('180d', 'other', 'Polar H10 9999'), named('180d', 'new', 'Polar H10 1234')]);
  const port = new NobleBlePort(d, n, { scanTimeoutMs: 200 });
  await port.connect('hr');
  expect(port.deviceName('hr')).toBe('Polar H10 1234');
  expect(JSON.parse(fs.readFileSync(path.join(d, 'devices.json'), 'utf8')).hr).toEqual({ id: 'new', name: 'Polar H10 1234' });
});
test('a different name with a different id is still ignored, and old plain id files still read', async () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'devices.json'), JSON.stringify({ hr: 'old' }));
  const n = fakeNoble();
  scanFinds(n, [named('180d', 'other', 'Polar H10 9999')]);
  const port = new NobleBlePort(d, n, { scanTimeoutMs: 40 });
  await expect(port.connect('hr')).rejects.toThrow(/nicht gefunden/);
  scanFinds(n, [named('180d', 'old', 'Polar H10 1234')]);
  await port.connect('hr');
  expect(JSON.parse(fs.readFileSync(path.join(d, 'devices.json'), 'utf8')).hr).toEqual({ id: 'old', name: 'Polar H10 1234' });
});
test('the known id wins over a name match, and the clicker rules still apply', async () => {
  const d = dir();
  fs.writeFileSync(path.join(d, 'devices.json'), JSON.stringify({ hr: { id: 'old', name: 'A' }, clicker: { id: 'c-old', name: 'Zwift Click' } }));
  const n = fakeNoble();
  scanFinds(n, [named('180d', 'twin', 'A'), named('180d', 'old', 'A')]);
  const port = new NobleBlePort(d, n, { scanTimeoutMs: 200 });
  await port.connect('hr');
  expect(JSON.parse(fs.readFileSync(path.join(d, 'devices.json'), 'utf8')).hr.id).toBe('old');
  // Same name but not a Click v1: ignored.
  scanFinds(n, [named('x', 'c-new', 'Zwift Click', { manufacturerData: Buffer.from([0x4a, 0x09, 0x0a]) })]);
  await expect(new NobleBlePort(d, n, { clickerScanMs: 40 }).connect('clicker')).rejects.toThrow();
});
