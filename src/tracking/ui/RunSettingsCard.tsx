import { useState } from 'react';
import type { TrackedRecord } from '../../shared/records';
import { RUN_SETTINGS_ID, readRunBody, runIdType, type RunSettingsBody } from '../../shared/run';
import type { TrackingPort } from '../ports';
import { usePortRecords } from './hooks';
import { nextUpdatedMs } from './run-view';
import { Switch } from './kit';

/** Reads the person's settings record, if it is a readable one. */
export function settingsOf(records: TrackedRecord[] | null): { have: TrackedRecord | undefined; body: RunSettingsBody | null } {
  const have = (records ?? []).find((r) => r.id === RUN_SETTINGS_ID);
  const b = have && !have.deleted ? readRunBody(have.body) : null;
  return { have, body: b && b.type === 'settings' && runIdType(have!.id) === 'settings' ? b : null };
}

/** Writes the settings record; `all` includes tombstones so the write stays above them. */
export function writeSettings(port: TrackingPort, all: TrackedRecord[] | null, now: number, change: (old: RunSettingsBody | null) => RunSettingsBody): Promise<unknown> {
  const { have, body } = settingsOf(all);
  const next = change(body);
  return port.put({ kind: 'run', id: RUN_SETTINGS_ID, updatedMs: nextUpdatedMs(now, have), deleted: false, body: next });
}

/** The always-present switch row (profile): running can be switched on by hand, with or without Garmin. */
export function RunSettingsCard({ port, now }: { port: TrackingPort; now: () => number }) {
  const q = usePortRecords(port, 'run');
  const { body } = settingsOf(q.records);
  const [busy, setBusy] = useState(false);
  const on = body?.on === true;
  const toggle = () => {
    setBusy(true);
    void writeSettings(port, q.all, now(), (old) => ({ type: 'settings', on: !on, weekdays: old?.weekdays ?? null, answers: old?.answers ?? null }))
      .catch(() => {}).finally(() => setBusy(false));
  };
  return <Switch icon="lauf" label="Laufen planen" hint={on ? 'Pandafit plant dein Laufen mit.' : 'Deine Läufe zählen trotzdem bei der Belastung mit.'} checked={on} disabled={q.records === null || busy} onChange={toggle} />;
}
