import { useState } from 'react';
import { COACH_PREFS_ID, prefsOf, type CoachPrefs as Prefs } from '../../shared/chat';
import { WEEKDAY_LABEL } from '../../shared/week-plan';
import type { TrackingPort } from '../ports';
import { usePortRecords } from './hooks';
import { nextUpdatedMs } from './run-view';
import { ChoiceRow, Switch } from './kit';

const HOURS = Array.from({ length: 17 }, (_, i) => ({ value: i + 6, label: `${i + 6}:00` }));
const DAYS = WEEKDAY_LABEL.map((label, value) => ({ value, label }));

/** When the coach writes by itself. Both off until switched on; pushes need notifications allowed on this device. Lives on Profil. */
export function CoachPrefs({ port, now, nested = false }: { port: TrackingPort; now: () => number; nested?: boolean }) {
  const q = usePortRecords(port, 'coachprefs');
  const prefs = prefsOf(q.all ?? []);
  const [error, setError] = useState<string | null>(null);
  const save = (p: Prefs) => {
    const have = (q.all ?? []).find((r) => r.id === COACH_PREFS_ID);
    setError(null);
    void port.put({ kind: 'coachprefs', id: COACH_PREFS_ID, updatedMs: nextUpdatedMs(now(), have), deleted: false, body: p }).catch(() => setError('Die Einstellung konnte nicht gespeichert werden.'));
  };
  return (
    <section aria-label="Wann sich der Coach meldet" className={nested ? 'tk-group tk-indent' : 'tk-group'}>
      {!nested && <h2 className="tk-section">Wann sich der Coach meldet</h2>}
      <Switch label="Wochengespräch" hint="Der Coach schlägt dir dabei die nächste Woche vor." checked={prefs.week.on} onChange={(on) => save({ ...prefs, week: { ...prefs.week, on } })} />
      {prefs.week.on && (
        <>
          <ChoiceRow label="Tag des Wochengesprächs" value={prefs.week.day} options={DAYS} onChange={(day) => save({ ...prefs, week: { ...prefs.week, day } })} />
          <ChoiceRow label="Uhrzeit des Wochengesprächs" value={prefs.week.hour} options={HOURS} onChange={(hour) => save({ ...prefs, week: { ...prefs.week, hour } })} />
        </>
      )}
      <Switch label="Am Vorabend sagen, was morgen ansteht" hint="Er meldet sich nur vor Trainingstagen." checked={prefs.evening.on} onChange={(on) => save({ ...prefs, evening: { ...prefs.evening, on } })} />
      {prefs.evening.on && <ChoiceRow label="Uhrzeit am Vorabend" value={prefs.evening.hour} options={HOURS} onChange={(hour) => save({ ...prefs, evening: { ...prefs.evening, hour } })} />}
      {error && <p role="status" className="tk-note">{error}</p>}
    </section>
  );
}
