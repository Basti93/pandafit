import type { DeviceStatus, Reading } from '../service/ble/device-manager';
import type { DeviceKind } from '../service/ble/device-port';
import type { EngineState } from '../service/engine';
import type { RideMeta } from '../service/recorder';
import type { Profile } from './profiles';
import type { Session } from './session';

export type ClientMessage =
  | { type: 'start'; profileId: string; session: Session; ftpW: number; maxHrBpm?: number; hrMaxBpm?: number }
  | { type: 'device-connect'; kind: DeviceKind }
  | { type: 'device-disconnect'; kind: DeviceKind }
  | { type: 'adjust'; deltaPct: number }
  | { type: 'mark'; note?: string }
  | { type: 'skip' }
  | { type: 'stop' }
  | { type: 'discard' }
  | { type: 'resume'; rideId: string }
  | { type: 'discard-resume'; rideId: string }
  | { type: 'export-fit'; rideId: string }
  | { type: 'save-profile'; profile: Profile }
  | { type: 'delete-profile'; profileId: string }
  | { type: 'problem-report'; note: string };

export type RecoveryOffer = { type: 'recovery-offer'; rideId: string; profileId: string; sessionName: string; rideElapsedS: number };
export type StateMessage = {
  type: 'state'; ride: RideMeta | null; engine: EngineState | null; devices: DeviceStatus; deviceNames?: Partial<Record<DeviceKind, string>>;
  latest: Reading; storageError: boolean; recovered: boolean; profiles: Profile[]; session: Session | null;
};
export type ServerMessage = StateMessage | RecoveryOffer | { type: 'click'; dir: 'up' | 'down' } | { type: 'error'; message: string } | { type: 'report-saved'; path: string };
export const SERVICE_PORT = 7410;
