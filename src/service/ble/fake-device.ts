import type { BlePort, DeviceKind } from './device-port';

/** Test device: connection, disconnection and incoming data are controlled from outside. */
export class FakeBlePort implements BlePort {
  online: Record<DeviceKind, boolean> = { trainer: true, hr: true, clicker: false };
  writes: { kind: DeviceKind; bytes: number[] }[] = [];
  connectAttempts = 0;
  attemptsBy: Record<DeviceKind, number> = { trainer: 0, hr: 0, clicker: 0 };
  private subs = new Map<DeviceKind, (b: Buffer) => void>();
  private disconnectCb: (kind: DeviceKind) => void = () => {};
  private controlCb: (b: Buffer) => void = () => {};
  private connected = new Set<DeviceKind>();

  async connect(kind: DeviceKind): Promise<void> {
    this.connectAttempts++;
    this.attemptsBy[kind]++;
    if (!this.online[kind]) throw new Error(`${kind} offline`);
    this.connected.add(kind);
  }
  async disconnect(kind: DeviceKind): Promise<void> { this.connected.delete(kind); }
  subscribe(kind: DeviceKind, cb: (b: Buffer) => void): void { this.subs.set(kind, cb); }
  async write(kind: DeviceKind, b: Buffer): Promise<void> {
    if (!this.connected.has(kind)) throw new Error('not connected');
    this.writes.push({ kind, bytes: [...b] });
  }
  onDisconnect(cb: (kind: DeviceKind) => void): void { this.disconnectCb = cb; }
  onControl(cb: (b: Buffer) => void): void { this.controlCb = cb; }
  emitControl(b: Buffer): void { this.controlCb(b); }

  emit(kind: DeviceKind, b: Buffer): void { if (this.connected.has(kind)) this.subs.get(kind)?.(b); }
  drop(kind: DeviceKind): void {
    this.online[kind] = false;
    this.connected.delete(kind);
    this.disconnectCb(kind);
  }
}
