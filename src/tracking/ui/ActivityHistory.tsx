import { useState } from 'react';
import type { ActivityItem } from '../../shared/activities';
import { monthLabel, timeLabel } from '../../shared/dates';
import type { TrackedRecord } from '../../shared/records';
import type { TrackingPort } from '../ports';
import { RideSheet } from './BikeScreen';
import { ridesOf } from './bike-view';
import { activityText, mergedActivities } from './done-days';
import { WorkoutDetail } from './HistoryScreen';
import { usePortRecords } from './hooks';
import { Row, RowList, Sheet } from './kit';
import { dateLabel } from './labels';

/** The small sheet for an activity without a detail view of its own (Garmin, runs): what is known, nothing more. */
function ActivitySheet({ item, onClose }: { item: ActivityItem; onClose: () => void }) {
  const facts = [
    `${Math.max(1, Math.round(item.minutes))} Min`,
    item.distanceM !== null && item.distanceM > 0 ? `${(item.distanceM / 1000).toFixed(1).replace('.', ',')} km` : null,
    item.avgHr !== null && item.avgHr > 0 ? `Ø Puls ${Math.round(item.avgHr)}` : null,
  ].filter((x): x is string => x !== null);
  return (
    <Sheet title={activityText(item)} size="small" onClose={onClose}>
      <p className="muted">{dateLabel(item.startMs)} · {timeLabel(item.startMs)}</p>
      <p>{facts.join(' · ')}</p>
    </Sheet>
  );
}

/** One history across all sports: newest first by month; a tap opens the workout, the ride or a small sheet. */
export function ActivityHistory({ port, now, onClose }: { port: TrackingPort; now: () => number; onClose: () => void }) {
  const activities = usePortRecords(port, 'activities').all;
  const workouts = usePortRecords(port, 'workout').all;
  const rideRecords = usePortRecords(port, 'ride').records;
  const { items } = mergedActivities(activities, workouts);
  const [picked, setPicked] = useState<ActivityItem | null>(null);
  const level = useState<string | null>(null);
  const pick = (a: ActivityItem | null) => { setPicked(a); level[1](null); };

  const workoutOf = (a: ActivityItem): TrackedRecord | null =>
    a.kind === 'kraft' && a.ref !== null ? (workouts ?? []).find((r) => r.id === a.ref && !r.deleted) ?? null : null;
  const rideOf = (a: ActivityItem) => (a.kind === 'rad' && a.ref !== null ? ridesOf(rideRecords).find((r) => r.id === a.ref) ?? null : null);

  const months: { label: string; items: ActivityItem[] }[] = [];
  for (const a of items) {
    const label = monthLabel(a.startMs);
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(a); else months.push({ label, items: [a] });
  }

  const record = picked ? workoutOf(picked) : null;
  const ride = picked ? rideOf(picked) : null;
  if (picked && record) return <Sheet title="Verlauf" onClose={onClose} onBack={() => (level[0] !== null ? level[1](null) : pick(null))}><WorkoutDetail port={port} record={record} now={now} onBack={() => pick(null)} inSheet level={level} /></Sheet>;
  return (
    <Sheet title="Verlauf" onClose={onClose}>
      {items.length === 0 && <p className="muted">Hier erscheinen deine Aktivitäten.</p>}
      {months.map((m) => (
        <section key={m.label} aria-label={m.label}>
          <h3 className="tk-section">{m.label}</h3>
          <RowList>{m.items.map((a) => <Row key={a.key} title={activityText(a)} value={dateLabel(a.startMs)} onClick={() => pick(a)} />)}</RowList>
        </section>
      ))}
      {picked && ride && <RideSheet ride={ride} onClose={() => setPicked(null)} />}
      {picked && !ride && <ActivitySheet item={picked} onClose={() => setPicked(null)} />}
    </Sheet>
  );
}
