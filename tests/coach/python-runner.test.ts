import { runPython } from '../../src/coach/python-runner';

const node = process.execPath;

test('returns stdout and stderr of a successful run, input goes to stdin', async () => {
  const r = await runPython('-e', ['process.stdin.on("data",d=>{process.stdout.write("got "+d);console.error("note")})'], { input: 'hi', timeoutMs: 5000, bin: node });
  expect(r.code).toBe(0);
  expect(r.stdout).toBe('got hi');
  expect(r.stderr).toContain('note');
});
test('a non-zero exit rejects with an excerpt of stderr', async () => {
  await expect(runPython('-e', ['console.error("it broke");process.exit(3)'], { timeoutMs: 5000, bin: node }))
    .rejects.toMatchObject({ message: expect.stringContaining('it broke'), code: 3 });
});
test('a timeout ends the process and rejects', async () => {
  const t0 = Date.now();
  await expect(runPython('-e', ['setTimeout(()=>{},60000)'], { timeoutMs: 200, bin: node })).rejects.toThrow(/timed out/);
  expect(Date.now() - t0).toBeLessThan(4000);
});
test('stderr is capped', async () => {
  await expect(runPython('-e', ['console.error("x".repeat(200000));process.exit(1)'], { timeoutMs: 5000, bin: node }))
    .rejects.toMatchObject({ stderr: expect.any(String) });
  const r = await runPython('-e', ['console.error("x".repeat(200000))'], { timeoutMs: 5000, bin: node });
  expect(r.stderr.length).toBeLessThanOrEqual(64 * 1024);
});
