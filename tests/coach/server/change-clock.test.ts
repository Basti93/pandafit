import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChangeClock, changeKey } from '../../../src/coach/server/change-clock';
import type { CoachClientMessage } from '../../../src/coach/protocol';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clock-'));
const P = 'pa';

describe('changeKey', () => {
  test('complaint-update → complaint:<id>', () => {
    expect(changeKey({ type: 'complaint-update', profileId: P, id: 'c1', status: 'over' })).toBe('complaint:c1');
  });
  test('set-ftp → ftp', () => {
    expect(changeKey({ type: 'set-ftp', profileId: P, ftpW: 250 })).toBe('ftp');
  });
  test('feedback → feedback:<rideId>', () => {
    expect(changeKey({ type: 'feedback', profileId: P, rideId: 'ride-1', rating: 'hard' })).toBe('feedback:ride-1');
  });
  test('meals-item → meal:<week>:<item>', () => {
    expect(changeKey({ type: 'meals-item', profileId: P, week: '2026-11-02', item: 'hafer', state: 'da' })).toBe('meal:2026-11-02:hafer');
  });
  test('meals-eater → eater:<week>:<meal>:<person>', () => {
    expect(changeKey({ type: 'meals-eater', profileId: P, week: '2026-11-02', meal: '2-mittag', person: 'pb', on: false })).toBe('eater:2026-11-02:2-mittag:pb');
  });
  test('meals-settings → meals-settings', () => {
    expect(changeKey({ type: 'meals-settings', profileId: P, settings: {} })).toBe('meals-settings');
  });
  test('garmin-upload-settings → garmin-upload', () => {
    expect(changeKey({ type: 'garmin-upload-settings', profileId: P, mode: 'off' })).toBe('garmin-upload');
  });
  test('profile-update → profile', () => {
    expect(changeKey({ type: 'profile-update', profileId: P, profile: { id: P, name: 'A', ftpW: 200 } as never })).toBe('profile');
  });
  test('every other message → null (append-only, always applied)', () => {
    const others: CoachClientMessage[] = [
      { type: 'note', profileId: P, text: 'x' },
      { type: 'answer-question', profileId: P, questionId: 'q', text: 'x' },
      { type: 'debrief-answer', profileId: P, rideId: 'r', question: 'q', text: 'x' },
      { type: 'gym-note', profileId: P, text: 'x' },
      { type: 'mobility-done', profileId: P, sessionId: 's' },
      { type: 'word-result', profileId: P, nl: 'fiets', knew: true },
      { type: 'subscribe', profileId: P },
    ];
    for (const m of others) expect(changeKey(m)).toBeNull();
  });
});

describe('ChangeClock', () => {
  test('a change older than the last one for the same key is not admitted; another key is independent', () => {
    const file = path.join(temp(), 'clock.json');
    const clock = new ChangeClock(file);
    expect(clock.admit('complaint:c1', 2000)).toBe(true);
    expect(clock.admit('complaint:c1', 1000)).toBe(false);
    expect(clock.admit('complaint:c2', 1000)).toBe(true);
    expect(clock.admit('complaint:c1', 2000)).toBe(true);
    expect(clock.admit('complaint:c1', 3000)).toBe(true);
    expect(clock.admit('complaint:c1', 2500)).toBe(false);
  });

  test('kept in its file across a restart, readable only by the owner', () => {
    const file = path.join(temp(), 'clock.json');
    new ChangeClock(file).admit('ftp', 5000);
    expect(new ChangeClock(file).admit('ftp', 4000)).toBe(false);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  test('a broken file starts empty instead of failing', () => {
    const file = path.join(temp(), 'clock.json');
    fs.writeFileSync(file, '{nope');
    expect(new ChangeClock(file).admit('ftp', 1)).toBe(true);
  });
});

test('admits only asks; stamp records an applied change and never moves back', () => {
  const file = path.join(temp(), 'clock.json');
  const clock = new ChangeClock(file);
  expect(clock.admits('ftp', 2000)).toBe(true);
  expect(fs.existsSync(file)).toBe(false);
  clock.stamp('ftp', 2000);
  clock.stamp('ftp', 1000);
  expect(clock.admits('ftp', 1500)).toBe(false);
  expect(clock.admits('ftp', 2000)).toBe(true);
});
