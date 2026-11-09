import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askClaude, ClaudeError, findClaude } from '../../src/coach/claude-client';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'claude-'));
const fake = (body: string) => {
  const d = dir();
  const bin = path.join(d, 'claude');
  fs.writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { bin, d };
};
const ask = (bin: string, timeoutMs?: number) => askClaude({ prompt: 'p', systemPrompt: 's', schema: { type: 'object' }, workDir: dir(), bin, timeoutMs });
const kind = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as ClaudeError).kind; } };

test('returns structured_output', async () => {
  const { bin } = fake(`echo '{"result":"","structured_output":{"a":1}}'`);
  expect(await ask(bin)).toEqual({ a: 1 });
});
test('the prompt goes through stdin, not argv, also when it is huge', async () => {
  const { bin, d } = fake(`echo "$@" > ${'$'}(dirname "$0")/args; cat > ${'$'}(dirname "$0")/stdin; echo '{"structured_output":{}}'`);
  const prompt = 'Zeile mit Umlaut ä\n'.repeat(15_000);
  expect(prompt.length).toBeGreaterThan(200 * 1024);
  await askClaude({ prompt, systemPrompt: 's', schema: { type: 'object' }, workDir: dir(), bin });
  expect(fs.readFileSync(path.join(d, 'stdin'), 'utf8')).toBe(prompt);
  expect(fs.readFileSync(path.join(d, 'args'), 'utf8')).not.toContain('Umlaut');
});
test('never passes --bare, disables tools and reads the prompt from stdin', async () => {
  const { bin, d } = fake(`echo "$@" > ${'$'}(dirname "$0")/args; cat > ${'$'}(dirname "$0")/stdin; echo '{"structured_output":{}}'`);
  await ask(bin);
  const args = fs.readFileSync(path.join(d, 'args'), 'utf8');
  expect(args).not.toContain('--bare');
  expect(args).toContain('-p');
  expect(args).toContain('--tools');
  expect(args).toContain('--json-schema');
  expect(args).toContain('--no-session-persistence');
  expect(fs.readFileSync(path.join(d, 'stdin'), 'utf8')).toBe('p');
});
test('kills the process at the timeout and reports timeout', async () => {
  const { bin } = fake('sleep 30');
  const start = Date.now();
  expect(await kind(ask(bin, 100))).toBe('timeout');
  expect(Date.now() - start).toBeLessThan(3000);
});
test('rate limit output is reported as limit', async () => {
  const { bin } = fake(`echo '{"is_error":true,"result":"You have hit your usage limit"}'; exit 1`);
  expect(await kind(ask(bin))).toBe('limit');
});
test('missing structured_output is reported as invalid', async () => {
  const { bin } = fake(`echo '{"result":"nur Text"}'`);
  expect(await kind(ask(bin))).toBe('invalid');
});
test('garbage output is reported as invalid', async () => {
  const { bin } = fake('echo hallo');
  expect(await kind(ask(bin))).toBe('invalid');
});
test('non-zero exit is reported as failed', async () => {
  const { bin } = fake('echo kaputt >&2; exit 3');
  expect(await kind(ask(bin))).toBe('failed');
});
test('unstartable binary is reported as missing, not thrown from spawn', async () => {
  expect(await kind(ask('/nicht/da/claude'))).toBe('missing');
});
test('findClaude uses the login shell result', async () => {
  expect(await findClaude(async () => '/opt/x/claude\n')).toBe('/opt/x/claude');
});
test('findClaude reports missing when the shell finds nothing', async () => {
  expect(await kind(findClaude(async () => ''))).toBe('missing');
  expect(await kind(findClaude(async () => { throw new Error('x'); }))).toBe('missing');
});

test('a successful answer mentioning a limit or 429 stays valid', async () => {
  const { bin } = fake(`echo '{"is_error":false,"usage":{"input_tokens":429},"structured_output":{"reason":"limit reached"}}'`);
  await expect(ask(bin)).resolves.toEqual({ reason: 'limit reached' });
});
test('is_error with exit code 0 and limit text is a limit', async () => {
  const { bin } = fake(`echo '{"is_error":true,"result":"You have hit your usage limit"}'`);
  expect(await kind(ask(bin))).toBe('limit');
});
test('is_error without limit text fails', async () => {
  const { bin } = fake(`echo '{"is_error":true,"result":"kaputt"}'`);
  expect(await kind(ask(bin))).toBe('failed');
});

test('server throttling is not reported as the plan limit', async () => {
  const { bin } = fake(`echo '{"is_error":true,"result":"Server is temporarily limiting requests (not your usage limit)"}'; exit 1`);
  expect(await kind(ask(bin))).toBe('failed');
});
test('exhausted structured output retries are invalid', async () => {
  const { bin } = fake(`echo '{"is_error":true,"subtype":"error_max_structured_output_retries","errors":["x"]}'; exit 1`);
  expect(await kind(ask(bin))).toBe('invalid');
});
test('token count 429 on a failing call is not a limit', async () => {
  const { bin } = fake(`echo '{"is_error":true,"result":"kaputt","usage":{"input_tokens":429}}'; exit 1`);
  expect(await kind(ask(bin))).toBe('failed');
});
