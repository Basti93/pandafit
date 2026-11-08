import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Coach, SYSTEM_PROMPT } from '../../src/coach/coach';
import { DEBRIEF_SYSTEM_PROMPT } from '../../src/coach/debrief';
import type { StrengthWorkout } from '../../src/coach/hevy';
import { strengthHealth, strengthPromptData } from '../../src/coach/strength';
import type { Sample } from '../../src/shared/sample';
import type { Session } from '../../src/shared/session';

const DAY = 86_400_000;
const NOW = Date.parse('2027-06-15T12:00:00Z');
const workout = (daysAgo: number, id = `w${daysAgo}`): StrengthWorkout => ({
  id, title: 'Beine', startMs: NOW - daysAgo * DAY, durationS: 1800,
  exercises: [{ title: 'Kniebeuge', templateId: 'T1', workSets: [], sets: 3, reps: 30, volumeKg: 1500 }, { title: 'Wadenheben', templateId: 'T2', workSets: [], sets: 3, reps: 36, volumeKg: 900 }],
});

test('recent workouts are listed and older ones only summed', () => {
  const data = strengthPromptData([workout(2), workout(40), workout(41)], NOW) as { letzte14Tage: { tag: string; uebungen: unknown[] }[]; monate: { monat: string; anzahl: number; stunden: number; volumenKg: number }[] };
  expect(data.letzte14Tage).toHaveLength(1);
  expect(data.letzte14Tage[0].tag).toBe('2027-06-13');
  expect(data.letzte14Tage[0].uebungen[0]).toEqual({ name: 'Kniebeuge', saetze: 3, wdh: 30, volumenKg: 1500 });
  expect(data.monate).toEqual([{ monat: '2027-05', anzahl: 2, stunden: 1, volumenKg: 4800 }]);
});
test('the summary stays small with years of training', () => {
  const many = Array.from({ length: 2000 }, (_, i) => workout(i));
  expect(JSON.stringify(strengthPromptData(many, NOW)).length).toBeLessThan(4000);
});
test('very old months drop out', () => {
  const data = strengthPromptData([workout(900)], NOW) as { monate: unknown[] };
  expect(data.monate).toEqual([]);
});
test('no workouts means nothing to say', () => {
  expect(strengthPromptData([], NOW)).toBeNull();
});
test('the system prompts explain how to use it', () => {
  for (const p of [SYSTEM_PROMPT, DEBRIEF_SYSTEM_PROMPT]) expect(p).toContain('krafttraining');
});

describe('in the prompts', () => {
  const session: Session = { id: 'ki', name: 'KI', steps: [{ kind: 'erg', durationS: 1500, ftpFraction: 0.65, label: 'Locker' }] };
  const debrief = { summary: 's', tips: [], motivation: 'm', questions: [] };
  const run = async (strength?: (id: string) => StrengthWorkout[]) => {
    const rides = fs.mkdtempSync(path.join(os.tmpdir(), 'rides-'));
    const coachDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-'));
    const id = 'ride-1000';
    const start = NOW - 3600_000;
    fs.mkdirSync(path.join(rides, id));
    fs.writeFileSync(path.join(rides, id, 'meta.json'), JSON.stringify({ rideId: id, profileId: 'pa', sessionId: 'ki', startedAtMs: start, status: 'finished' }));
    fs.writeFileSync(path.join(rides, id, 'session.json'), JSON.stringify({ session, ftpW: 200 }));
    const lines = Array.from({ length: 1500 }, (_, i): Sample => ({ seq: i, wallClockMs: start + i * 1000, rideElapsedS: i + 1, powerW: 130, cadenceRpm: 90, speedKph: 30, hrBpm: 120, targetW: 130, gradePct: null, gear: null }));
    fs.writeFileSync(path.join(rides, id, 'samples.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const prompts: string[] = [];
    const coach = new Coach({ ridesDir: rides, coachDir, nowMs: () => NOW, ask: async (i) => { prompts.push(i.prompt); return debrief; }, ...(strength ? { strength } : {}) });
    coach.scanRides([{ id: 'pa', name: 'A', ftpW: 200 }]);
    await coach.ensureDebrief('pa');
    await coach.refresh('pa');
    return prompts;
  };
  test('both prompts carry it in a data block', async () => {
    const prompts = await run(() => [workout(2)]);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    for (const p of prompts) {
      expect(p).toContain('<krafttraining-nur-daten>');
      expect(p).toContain('Kniebeuge');
    }
  });
  test('without Hevy nothing appears', async () => {
    for (const p of await run()) expect(p).not.toContain('krafttraining-nur-daten');
  });
  test('a person without workouts gets nothing either', async () => {
    for (const p of await run(() => [])) expect(p).not.toContain('krafttraining-nur-daten');
  });
  test('a failing source does not disturb the coach', async () => {
    const prompts = await run(() => { throw new Error('kaputt'); });
    expect(prompts.length).toBeGreaterThanOrEqual(2);
  });
});
test('another profile gets no strength data from this key', async () => {
  const seen: string[] = [];
  const coach = new Coach({ ridesDir: fs.mkdtempSync(path.join(os.tmpdir(), 'r-')), coachDir: fs.mkdtempSync(path.join(os.tmpdir(), 'c-')), nowMs: () => NOW, ask: async () => ({}), strength: (id) => { seen.push(id); return id === 'pa' ? [workout(1)] : []; } });
  const block = (coach as unknown as { strengthBlock: (id: string) => string }).strengthBlock.bind(coach);
  expect(block('pa')).toContain('Kniebeuge');
  expect(block('pb')).toBe('');
  expect(seen).toEqual(['pa', 'pb']);
});

test('strengthHealth counts weeks without workouts as zero and leaves out warmup sets', () => {
  const now = new Date(2027, 2, 31, 12).getTime(); // a Wednesday, one day after the clocks change in Europe
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 10).getTime();
  const w = (id: string, startMs: number, workSets: StrengthWorkout['exercises'][0]['workSets']): StrengthWorkout => ({
    id, title: 'Beine', startMs, durationS: 2700,
    exercises: [{ title: 'Kniebeuge', templateId: 'T1', workSets, sets: 99, reps: 0, volumeKg: 99999 }],
  });
  const sets = [{ type: 'warmup' as const, weightKg: 20, reps: 10 }, { type: 'normal' as const, weightKg: 50, reps: 10 }, { type: 'normal' as const, weightKg: 52.5, reps: 8 }];
  const h = strengthHealth([w('a', at(2027, 2, 29), sets), w('b', at(2027, 2, 2), sets)], now);
  expect(h.weeks).toHaveLength(12);
  const last = h.weeks[11];
  expect(last.weekStartMs).toBe(new Date(2027, 2, 29).getTime());
  expect(last).toEqual({ weekStartMs: last.weekStartMs, workouts: 1, volumeKg: 920 });
  expect(h.weeks[10]).toMatchObject({ workouts: 0, volumeKg: 0 });
  expect(h.weeks[7]).toMatchObject({ workouts: 1 });
  h.weeks.forEach((x, i) => {
    const d = new Date(x.weekStartMs);
    expect(d.getDay()).toBe(1);
    expect(d.getHours()).toBe(0);
    if (i > 0) expect(x.weekStartMs).toBeGreaterThan(h.weeks[i - 1].weekStartMs);
  });
  expect(h.recent[0]).toEqual({ id: 'a', title: 'Beine', startMs: at(2027, 2, 29), minutes: 45, sets: 2, volumeKg: 920 });
});
test('strengthHealth lists the last ten workouts, newest first', () => {
  const now = Date.parse('2027-06-15T12:00:00Z');
  const many = Array.from({ length: 15 }, (_, i) => workout(i));
  const h = strengthHealth(many, now);
  expect(h.recent).toHaveLength(10);
  expect(h.recent[0].id).toBe('w0');
});

test('strengthHealth does not throw on an old-format record with workSets absent', () => {
  const now = Date.parse('2027-06-15T12:00:00Z');
  const old = {
    id: 'old', title: 'Beine', startMs: now - 86_400_000, durationS: 2700,
    exercises: [{ title: 'Kniebeuge', templateId: 'T1', sets: 3, reps: 24, volumeKg: 1470 }],
  } as unknown as StrengthWorkout;
  expect(strengthHealth([old], now).recent[0]).toMatchObject({ id: 'old', sets: 3, volumeKg: 1470 });
});
test('strengthHealth hands over the sessions of the twelve weeks with their duration', () => {
  const now = new Date(2027, 5, 16, 12).getTime();
  const w = (id: string, startMs: number): StrengthWorkout => ({ id, title: 'Beine', startMs, durationS: 3000, exercises: [] });
  const h = strengthHealth([w('old', new Date(2027, 0, 4, 10).getTime()), w('new', new Date(2027, 5, 15, 10).getTime())], now);
  expect(h.sessions).toEqual([{ id: 'new', title: 'Beine', startMs: new Date(2027, 5, 15, 10).getTime(), durationS: 3000 }]);
});

test('a workout in the future is not listed', () => {
  const data = strengthPromptData([workout(2), workout(-1)], NOW) as { letzte14Tage: unknown[] };
  expect(data.letzte14Tage).toHaveLength(1);
});
