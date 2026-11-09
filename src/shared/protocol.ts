import type { DeviceKind, DeviceStatus, EngineState, Reading } from './device-types';
import type { RideMeta } from '../ride-format/read';
import type { Profile } from './profiles';
import type { Session } from './session';

export type { ClientMessage } from './ride-messages';

export type RecoveryOffer = { type: 'recovery-offer'; rideId: string; profileId: string; sessionName: string; rideElapsedS: number };
export type StateMessage = {
  type: 'state'; ride: RideMeta | null; engine: EngineState | null; devices: DeviceStatus; deviceNames?: Partial<Record<DeviceKind, string>>;
  latest: Reading; storageError: boolean; recovered: boolean; profiles: Profile[]; session: Session | null;
};
export type ServerMessage = StateMessage | RecoveryOffer | { type: 'click'; dir: 'up' | 'down' } | { type: 'error'; message: string } | { type: 'report-saved'; path: string };
export const SERVICE_PORT = 7410;
