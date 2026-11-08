/** The words every proposal card uses (workout, next workout, week), so the three read the same. */
export const TAKE = 'Übernehmen';
export const DECLINE = 'Nein danke';
export const UNDO = 'Rückgängig';
export const DECLINED = 'Du hast den Vorschlag abgelehnt';

/** "Das geht nicht, weil …": the reasons are clauses ("die Übung nicht mehr da ist"). Null when nothing was rejected. */
export const gehtNicht = (reasons: readonly string[]): string | null => {
  const r = [...new Set(reasons)];
  return r.length ? `Das geht nicht, weil ${r.length > 1 ? `${r.slice(0, -1).join(', ')} und ${r[r.length - 1]}` : r[0]}.` : null;
};
