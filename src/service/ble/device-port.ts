import type { DeviceKind } from '../../shared/device-types';
export type { DeviceKind };
export interface BlePort {
  connect(kind: DeviceKind): Promise<void>;
  disconnect(kind: DeviceKind): Promise<void>;
  subscribe(kind: DeviceKind, cb: (b: Buffer) => void): void;
  write(kind: DeviceKind, b: Buffer): Promise<void>;
  onDisconnect(cb: (kind: DeviceKind) => void): void;
  /** Responses from the trainer's FTMS Control Point and Machine Status. */
  onControl(cb: (b: Buffer) => void): void;
  /** The name the connected device reports, if known. */
  deviceName?(kind: DeviceKind): string | null;
}
