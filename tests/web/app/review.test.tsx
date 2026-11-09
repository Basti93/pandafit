// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TrackedRecord } from '../../../src/shared/records';
import { NOW, DAY, boot } from './helpers';

afterEach(cleanup);

describe('Rückblick in Woche', () => {
  const statsRec: TrackedRecord = { kind: 'stats', id: 'stats', updatedMs: NOW - 1000, deleted: false, body: { type: 'stats', atMs: NOW - 1000, goal: null, days: [], muscles: {} } };
  const done: TrackedRecord = { kind: 'workout', id: 'w1', updatedMs: NOW - 1000, deleted: false, body: { id: 'w1', title: 'Training', startMs: NOW - 2 * DAY, endMs: NOW - 2 * DAY + 3_600_000, source: 'pandafit', exercises: [] } };

  it('there is no Statistik tab; Woche has the Rückblick tile, which opens it with its rows once there is a stats record or a finished workout', async () => {
    await boot({ account: 'anna', seed: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Woche' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rückblick' }));
    const empty = await screen.findByRole('region', { name: 'Rückblick' });
    await new Promise((r) => setTimeout(r, 30));
    expect(within(empty).getAllByRole('button').map((b) => b.textContent)).toEqual(['Verlauf›']);
    expect(screen.queryByRole('button', { name: 'Statistik' })).toBeNull();
    cleanup();
    await boot({ account: 'anna', seed: [statsRec] });
    fireEvent.click(await screen.findByRole('button', { name: 'Woche' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rückblick' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Zeit pro Woche' }));
    expect(await screen.findByRole('dialog', { name: 'Zeit pro Woche' })).toBeTruthy();
    cleanup();
    await boot({ account: 'anna', seed: [done] });
    fireEvent.click(await screen.findByRole('button', { name: 'Woche' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rückblick' }));
    expect(await screen.findByRole('button', { name: 'Zeit pro Woche' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Statistik' })).toBeNull();
  });
});
