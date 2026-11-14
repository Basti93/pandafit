import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canUploadWorkout } from '../../src/coach/garmin-upload';
import { STRENGTH_ACTIVITY_NAME, uploadSettings } from '../../src/shared/garmin-upload';
import { loadState, saveState, type CoachState } from '../../src/coach/state';

const state = (workouts = {}) => ({ garminUpload: { mode: 'ask', rides: {}, workouts } }) as unknown as CoachState;
const w = (over = {}) => ({ id: 'w1', source: 'pandafit', endMs: 5000, ...over });

test('only finished own workouts that are not up or on their way can go up', () => {
  expect(canUploadWorkout(state(), undefined)).toBe(false);
  expect(canUploadWorkout(state(), w({ source: 'hevy' }))).toBe(false);
  expect(canUploadWorkout(state(), w({ endMs: null }))).toBe(false);
  expect(canUploadWorkout(state(), w({ deleted: true }))).toBe(false);
  expect(canUploadWorkout(state({ w1: { status: 'uploading', atMs: 1 } }), w())).toBe(false);
  expect(canUploadWorkout(state({ w1: { status: 'uploaded', atMs: 1 } }), w())).toBe(false);
  expect(canUploadWorkout(state({ w1: { status: 'failed', atMs: 1 } }), w())).toBe(true);
  expect(canUploadWorkout(state(), w())).toBe(true);
});
test('a state without upload settings still has no workouts', () => {
  expect(uploadSettings({})).toEqual({ mode: 'off', rides: {}, workouts: {} });
  expect(canUploadWorkout({} as CoachState, w())).toBe(true);
});
test('the activity name is plain', () => {
  expect(STRENGTH_ACTIVITY_NAME).toBe('Krafttraining');
});
test('a workout upload cut off by a restart counts as failed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-'));
  const s = loadState(dir, 'pa', 200, 1);
  s.garminUpload = { mode: 'ask', rides: {}, workouts: { w1: { status: 'uploading', atMs: 1 }, w2: { status: 'uploaded', atMs: 1 } } };
  saveState(dir, s);
  const ws = loadState(dir, 'pa', 200, 1).garminUpload?.workouts;
  expect(ws?.w1).toMatchObject({ status: 'failed', reason: 'failed' });
  expect(ws?.w2.status).toBe('uploaded');
});
