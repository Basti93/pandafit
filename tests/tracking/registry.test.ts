import { acquireStore, releaseStore, openStoreCount } from '../../src/tracking/registry';
import { confirmSet, startFromPlan } from '../../src/tracking/session';
import type { LoggedWorkout } from '../../src/shared/records';
import type { GymWorkout } from '../../src/shared/gym/types';
import { fakePort } from './fake-port';

const plan: GymWorkout = { name: 'P', exercises: [{ templateId: 'pf-squat', title: 'K', restS: null, supersetId: null, notes: '', sets: [{ type: 'normal', weightKg: null, reps: null }] }] };
afterEach(() => { vi.useRealTimers(); });

test('leaving while a save failed keeps the store alive until the retry works, then lets it go', async () => {
  vi.useFakeTimers();
  const { port, map, state } = fakePort();
  const w = startFromPlan(plan, [], 1, 'w1');
  const store = acquireStore(port, w, () => 100);
  state.failPuts = true;
  await store.apply((x) => confirmSet(x, x.exercises[0].rid, x.exercises[0].sets[0].rid, 5));
  releaseStore(port, store); // screen left
  expect(openStoreCount(port)).toBe(1);
  expect(acquireStore(port, w, () => 100)).toBe(store); // reopening returns the same store
  state.failPuts = false;
  await vi.advanceTimersByTimeAsync(15_000);
  expect((map.get('workout:w1')!.body as LoggedWorkout).exercises[0].sets[0].doneMs).toBe(5);
  releaseStore(port, store);
  expect(openStoreCount(port)).toBe(0);
});

test('a clean store is let go at once and a new acquire starts from the given record', async () => {
  const { port } = fakePort();
  const w = startFromPlan(plan, [], 1, 'w1');
  const s1 = acquireStore(port, w, () => 100);
  await s1.apply((x) => x);
  releaseStore(port, s1);
  expect(openStoreCount(port)).toBe(0);
  expect(acquireStore(port, w, () => 100)).not.toBe(s1);
});
