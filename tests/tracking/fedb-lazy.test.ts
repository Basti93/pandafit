import { vi } from 'vitest';

test('a failed catalog import is retried by the next caller', async () => {
  vi.resetModules();
  let calls = 0;
  vi.doMock('../../src/shared/fedb', () => {
    calls++;
    if (calls === 1) throw new Error('chunk failed');
    return { FEDB_EXERCISES: [{ id: 'x' }] };
  });
  const { loadFedb } = await import('../../src/tracking/fedb-lazy');
  await expect(loadFedb()).rejects.toThrow('chunk failed');
  await expect(loadFedb()).resolves.toEqual([{ id: 'x' }]);
  vi.doUnmock('../../src/shared/fedb');
});
