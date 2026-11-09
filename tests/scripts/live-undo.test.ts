import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickUndoTarget, undoLastLive } from '../../scripts/live-undo';

const c = (sha: string, subject: string, body = '') => ({ sha, subject, body });

test('picks the newest live commit', () => {
  expect(pickUndoTarget([c('c3', 'fix: x'), c('c2', 'live: b'), c('c1', 'live: a')])).toBe('c2');
});
test('skips a live commit that a later commit reverted', () => {
  const log = [c('r2', 'Revert "live: b"', 'This reverts commit b2b2b2b2.'), c('b2b2b2b2', 'live: b'), c('a1a1a1a1', 'live: a')];
  expect(pickUndoTarget(log)).toBe('a1a1a1a1');
});
test('returns null when every live commit is reverted or none exists', () => {
  expect(pickUndoTarget([c('r1', 'Revert "live: a"', 'This reverts commit a1a1a1a1.'), c('a1a1a1a1', 'live: a')])).toBeNull();
  expect(pickUndoTarget([c('x', 'feat: y')])).toBeNull();
});
test('two undos revert both live commits in a real repo', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-'));
  const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
  const git = (...a: string[]) => execFileSync('git', [...id, '-C', repo, ...a], { stdio: 'pipe' }).toString();
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a'), '1'); git('add', '.'); git('commit', '-qm', 'base');
  fs.writeFileSync(path.join(repo, 'a'), '2'); git('add', '.'); git('commit', '-qm', 'live: first');
  fs.writeFileSync(path.join(repo, 'b'), 'x'); git('add', '.'); git('commit', '-qm', 'live: second');
  undoLastLive(repo, id);
  undoLastLive(repo, id);
  expect(fs.existsSync(path.join(repo, 'b'))).toBe(false);
  expect(fs.readFileSync(path.join(repo, 'a'), 'utf8')).toBe('1');
});
