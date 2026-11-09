import { spawn } from 'node:child_process';
import { guardChild } from '../../src/coach/child-guard';

const run = (code: string, timeoutMs: number) => {
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe'] });
  let fired = 0;
  const guard = guardChild(child, timeoutMs, () => { fired += 1; });
  return new Promise<{ guard: typeof guard; fired: number }>((resolve) => child.on('close', () => resolve({ guard, fired })));
};

test('collects stderr of a finished process and does not fire', async () => {
  const { guard, fired } = await run('console.error("note")', 5000);
  expect(guard.stderr()).toContain('note');
  expect(guard.timedOut()).toBe(false);
  expect(fired).toBe(0);
});
test('a timeout ends the process and fires once', async () => {
  const t0 = Date.now();
  const { guard, fired } = await run('setTimeout(()=>{},60000)', 200);
  expect(guard.timedOut()).toBe(true);
  expect(fired).toBe(1);
  expect(Date.now() - t0).toBeLessThan(4000);
});
test('stderr is capped at 64 KiB and still drained', async () => {
  const { guard } = await run('console.error("x".repeat(200000))', 5000);
  expect(guard.stderr().length).toBe(64 * 1024);
});
