import type { TrackingPort } from '../ports';
import { usePortRecords } from './hooks';

/** Calm note, no alarm: finished workouts that the server has not confirmed yet stay safe on this device. */
export function SyncNote({ port }: { port: TrackingPort }) {
  usePortRecords(port, 'workout'); // re-renders when the port changes
  const { pending, refused = 0 } = port.syncState();
  if (refused > 0) return <p role="status" className="tk-note">Ein Eintrag wurde vom Server nicht angenommen. Er bleibt sicher auf diesem Gerät gespeichert.</p>;
  if (pending <= 0) return null;
  return <p role="status" className="tk-note">Das ist noch nicht auf dem Server, aber sicher auf diesem Gerät gespeichert. Es wird nachgereicht, sobald es geht.</p>;
}
