import { vi } from 'vitest';
import { DeviceManager } from '../../../src/service/ble/device-manager';
import { FakeBlePort } from '../../../src/service/ble/fake-device';

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('start never rejects when trainer is off and keeps searching', async () => {
  const port = new FakeBlePort();
  port.online.trainer = false;
  const m = new DeviceManager(port, { retryMs: 100 });
  const statuses: string[] = [];
  m.onStatus((s) => statuses.push(s.trainer));
  m.start();
  await vi.advanceTimersByTimeAsync(350);
  port.online.trainer = true;
  await vi.advanceTimersByTimeAsync(150);
  expect(statuses[0]).toBe('searching');
  expect(statuses.at(-1)).toBe('connected');
  m.stop();
});
test('reconnect re-requests control and resends last target', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 100 });
  m.start();
  await settle();
  m.setTargetPower(200);
  await settle();
  port.drop('trainer');
  port.writes = [];
  port.online.trainer = true;
  await vi.advanceTimersByTimeAsync(150);
  expect(port.writes.map((w) => w.bytes[0])).toEqual([0x00, 0x05]);
  expect(port.writes[1].bytes).toEqual([0x05, 0xC8, 0x00]);
  m.stop();
});
test('commands while disconnected are kept, latest wins', async () => {
  const port = new FakeBlePort();
  port.online.trainer = false;
  const m = new DeviceManager(port, { retryMs: 100 });
  m.start();
  await settle();
  m.setTargetPower(100);
  m.setTargetPower(200);
  port.online.trainer = true;
  await vi.advanceTimersByTimeAsync(150);
  const powers = port.writes.filter((w) => w.bytes[0] === 0x05);
  expect(powers.map((w) => w.bytes[1])).toEqual([0xC8]);
  m.stop();
});
test('missing hr does not affect trainer readings', async () => {
  const port = new FakeBlePort();
  port.online.hr = false;
  const m = new DeviceManager(port, { retryMs: 100 });
  const seen: number[] = [];
  m.onReading((r) => { if (r.powerW !== undefined) seen.push(r.powerW); });
  m.start();
  await settle();
  port.emit('trainer', Buffer.from([0x41, 0x00, 0x64, 0x00]));
  expect(seen).toEqual([100]);
  m.stop();
});
test('write failure on trainer does not throw', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 100 });
  port.write = async () => { throw new Error('gatt'); };
  m.start();
  await settle();
  expect(() => m.setTargetPower(100)).not.toThrow();
  await settle();
  m.stop();
});
test('failed trainer write is retried until it succeeds', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 100, writeRetryMs: 50 });
  m.start();
  await settle();
  const real = port.write.bind(port); let fails = 2;
  port.write = async (k, b) => { if (b[0] === 0x05 && fails-- > 0) throw new Error('gatt'); return real(k, b); };
  m.setTargetPower(200);
  await vi.advanceTimersByTimeAsync(200);
  expect(port.writes.filter((w) => w.bytes[0] === 0x05).map((w) => w.bytes[1])).toEqual([0xC8]);
  m.stop();
});
test('a newer target replaces one still being retried', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 100, writeRetryMs: 50 });
  m.start();
  await settle();
  const real = port.write.bind(port); let block = true;
  port.write = async (k, b) => { if (block) throw new Error('gatt'); return real(k, b); };
  m.setTargetPower(100);
  await vi.advanceTimersByTimeAsync(20);
  m.setTargetPower(200);
  block = false;
  await vi.advanceTimersByTimeAsync(200);
  expect(port.writes.filter((w) => w.bytes[0] === 0x05).map((w) => w.bytes[1])).toEqual([0xC8]);
  m.stop();
});
test('trainer writes never overlap', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 100 });
  m.start();
  await settle();
  const real = port.write.bind(port); let inFlight = 0; let max = 0;
  port.write = async (k, b) => { inFlight++; max = Math.max(max, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight--; return real(k, b); };
  m.setTargetPower(100); m.setGrade(3); m.setTargetPower(200);
  await vi.advanceTimersByTimeAsync(100);
  expect(max).toBe(1);
  expect(port.writes.at(-1)!.bytes).toEqual([0x05, 0xC8, 0x00]);
  m.stop();
});

describe('trainer takes control away', () => {
  const reqControl = [0x00];
  const start = async () => {
    const port = new FakeBlePort();
    const m = new DeviceManager(port, { retryMs: 100 });
    m.start();
    await vi.advanceTimersByTimeAsync(10);
    m.setTargetPower(200);
    await settle();
    port.writes.length = 0;
    return { port, m };
  };
  test('control not permitted requests control and resends the target', async () => {
    const { port, m } = await start();
    port.emitControl(Buffer.from([0x80, 0x05, 0x05]));
    await settle();
    expect(port.writes.map((w) => w.bytes[0])).toEqual([reqControl[0], 0x05]);
    m.stop();
  });
  test('machine status control lost does the same', async () => {
    const { port, m } = await start();
    port.emitControl(Buffer.from([0xff]));
    await settle();
    expect(port.writes[0].bytes).toEqual(reqControl);
    m.stop();
  });
  test('success responses change nothing and repeats are limited', async () => {
    const { port, m } = await start();
    port.emitControl(Buffer.from([0x80, 0x05, 0x01]));
    await settle();
    expect(port.writes).toEqual([]);
    port.emitControl(Buffer.from([0xff])); port.emitControl(Buffer.from([0xff]));
    await settle();
    expect(port.writes.filter((w) => w.bytes[0] === 0x00)).toHaveLength(1);
    m.stop();
  });

});

describe('Zwift Click', () => {
  const PLUS = Buffer.from([0x37, 0x08, 0x00, 0x10, 0x01]);
  const MINUS = Buffer.from([0x37, 0x08, 0x01, 0x10, 0x00]);
  const IDLE = Buffer.from([0x37, 0x08, 0x01, 0x10, 0x01]);
  const start = async () => {
    const port = new FakeBlePort(); port.online.clicker = true;
    const m = new DeviceManager(port, { retryMs: 100 });
    const clicks: string[] = [];
    m.onClick((d) => clicks.push(d));
    m.start();
    await vi.advanceTimersByTimeAsync(10);
    return { port, m, clicks };
  };
  test('plus shifts up, minus shifts down', async () => {
    const { port, m, clicks } = await start();
    port.emit('clicker', PLUS); port.emit('clicker', IDLE); port.emit('clicker', MINUS);
    expect(clicks).toEqual(['up', 'down']);
    m.stop();
  });
  test('repeated frames of a held button count once', async () => {
    const { port, m, clicks } = await start();
    port.emit('clicker', PLUS); port.emit('clicker', PLUS); port.emit('clicker', PLUS);
    expect(clicks).toEqual(['up']);
    m.stop();
  });
  test('a dropped clicker does not swallow the next press', async () => {
    const { port, m, clicks } = await start();
    port.emit('clicker', PLUS);
    port.drop('clicker'); port.online.clicker = true;
    await vi.advanceTimersByTimeAsync(150);
    port.emit('clicker', PLUS);
    expect(clicks).toEqual(['up', 'up']);
    m.stop();
  });
  test('garbage from the clicker changes nothing', async () => {
    const { port, m, clicks } = await start();
    port.emit('clicker', Buffer.from([0x37, 0xff])); port.emit('clicker', Buffer.from('RideOn'));
    expect(clicks).toEqual([]);
    m.stop();
  });
});

test('a device you disconnect stays off until you connect it again', async () => {
  const port = new FakeBlePort();
  port.online.clicker = true;
  const m = new DeviceManager(port, { retryMs: 100 });
  m.start();
  await vi.advanceTimersByTimeAsync(10);
  expect(m.getStatus().clicker).toBe('connected');
  await m.disconnect('clicker');
  expect(m.getStatus().clicker).toBe('off');
  const attempts = port.connectAttempts;
  await vi.advanceTimersByTimeAsync(1000);
  expect(port.connectAttempts).toBe(attempts);
  m.connect('clicker');
  await vi.advanceTimersByTimeAsync(10);
  expect(m.getStatus().clicker).toBe('connected');
});
test('disconnecting stops a running search', async () => {
  const port = new FakeBlePort();
  port.online.clicker = false;
  const m = new DeviceManager(port, { retryMs: 100 });
  m.start();
  await vi.advanceTimersByTimeAsync(10);
  await m.disconnect('clicker');
  const attempts = port.connectAttempts;
  await vi.advanceTimersByTimeAsync(1000);
  expect(port.connectAttempts).toBe(attempts);
  expect(m.getStatus().clicker).toBe('off');
});
test('a connect that finishes after you disconnected is undone', async () => {
  const port = new FakeBlePort();
  let finish = () => {};
  const orig = port.connect.bind(port);
  port.connect = async (k) => { await new Promise<void>((r) => { finish = r; }); return orig(k); };
  const off = vi.spyOn(port, 'disconnect');
  const m = new DeviceManager(port, { retryMs: 100 });
  void m.disconnect('hr');
  m.connect('hr');
  await m.disconnect('hr');
  finish();
  await vi.advanceTimersByTimeAsync(10);
  expect(m.getStatus().hr).toBe('off');
  expect(off).toHaveBeenCalled();
});
test('connecting a searching device tries right away, without starting a second attempt', async () => {
  const port = new FakeBlePort();
  port.online.hr = false;
  port.online.clicker = true;
  const m = new DeviceManager(port, { retryMs: 10_000 });
  m.start();
  await vi.advanceTimersByTimeAsync(10);
  port.online.hr = true;
  m.connect('hr');
  m.connect('hr');
  await vi.advanceTimersByTimeAsync(10);
  expect(m.getStatus().hr).toBe('connected');
  const attempts = port.connectAttempts;
  await vi.advanceTimersByTimeAsync(5_000); // shorter than the silence watchdog
  expect(port.connectAttempts).toBe(attempts);
});
test('a connected device ignores connect', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 100 });
  m.start();
  await vi.advanceTimersByTimeAsync(10);
  const attempts = port.connectAttempts;
  m.connect('trainer');
  await vi.advanceTimersByTimeAsync(10);
  expect(port.connectAttempts).toBe(attempts);
});

const trainerData = Buffer.from([0x41, 0x00, 0x64, 0x00]);
test('a silent trainer is treated as lost after 10 s and reconnected', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 2000 });
  const statuses: string[] = [];
  m.onStatus((s) => statuses.push(s.trainer));
  m.start();
  await settle();
  expect(m.getStatus().trainer).toBe('connected');
  port.attemptsBy.trainer = 0;
  await vi.advanceTimersByTimeAsync(9000);
  expect(m.getStatus().trainer).toBe('connected');
  await vi.advanceTimersByTimeAsync(2000);
  expect(statuses).toContain('searching');
  await vi.advanceTimersByTimeAsync(2500);
  expect(port.attemptsBy.trainer).toBeGreaterThan(0);
  expect(m.getStatus().trainer).toBe('connected');
  m.stop();
});
test('readings keep the watchdog quiet, per device', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 2000 });
  const trainerSeen: string[] = [];
  const hrSeen: string[] = [];
  m.onStatus((st) => { trainerSeen.push(st.trainer); hrSeen.push(st.hr); });
  m.start();
  await settle();
  trainerSeen.length = 0;
  hrSeen.length = 0;
  for (let i = 0; i < 20; i++) {
    port.emit('trainer', trainerData);
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(trainerSeen).not.toContain('searching'); // the trainer kept sending
  expect(hrSeen).toContain('searching'); // the silent strap alone was dropped
  m.stop();
});
test('a device switched off by hand is not touched by the watchdog', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 2000 });
  m.start();
  await settle();
  await m.disconnect('hr');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(m.getStatus().hr).toBe('off');
  m.stop();
});
test('the watchdog does not fire while a connect is in progress', async () => {
  const port = new FakeBlePort();
  port.online.trainer = false;
  const m = new DeviceManager(port, { retryMs: 2000 });
  m.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(m.getStatus().trainer).toBe('searching');
  expect(port.attemptsBy.trainer).toBeGreaterThan(2);
  m.stop();
});
test('reconnect backoff doubles up to 30 s and resets after a successful connect', async () => {
  const port = new FakeBlePort();
  const m = new DeviceManager(port, { retryMs: 2000 });
  m.start();
  await settle();
  port.drop('trainer'); // offline: every attempt fails
  const base = port.attemptsBy.trainer;
  const attemptsAt = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); return port.attemptsBy.trainer - base; };
  expect(await attemptsAt(1999)).toBe(0);
  expect(await attemptsAt(1)).toBe(1); // t=2 s
  expect(await attemptsAt(3999)).toBe(1);
  expect(await attemptsAt(1)).toBe(2); // t=6 s (+4 s)
  expect(await attemptsAt(8000)).toBe(3); // t=14 s (+8 s)
  expect(await attemptsAt(16000)).toBe(4); // t=30 s (+16 s)
  expect(await attemptsAt(30000)).toBe(5); // t=60 s (capped at 30 s)
  expect(await attemptsAt(30000)).toBe(6);
  port.online.trainer = true;
  await vi.advanceTimersByTimeAsync(30000);
  expect(m.getStatus().trainer).toBe('connected');
  port.drop('trainer');
  port.online.trainer = true;
  await vi.advanceTimersByTimeAsync(2000);
  expect(m.getStatus().trainer).toBe('connected'); // back at 2 s
  m.stop();
});
