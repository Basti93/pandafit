import type { CoachHome } from '../../shared/coach-protocol';

/** One muted line: whether this Mac's rides are on the server. Nothing for a profile that has not moved or where it cannot be told. */
export const backupLine = (home: CoachHome | undefined): string | null => {
  if (home?.where !== 'server' || home.pendingRides === undefined) return null;
  if (home.pendingRides === 0) return 'Alle Fahrten gesichert';
  return home.pendingRides === 1 ? '1 Fahrt wartet auf Upload' : `${home.pendingRides} Fahrten warten auf Upload`;
};
