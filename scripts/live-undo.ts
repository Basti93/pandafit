import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

type LogEntry = { sha: string; subject: string; body: string };

/** Newest "live:" commit (log is newest first) that no later commit has reverted, or null. */
export const pickUndoTarget = (log: LogEntry[]): string | null => {
  const reverted = new Set<string>();
  for (const e of log) {
    for (const m of e.body.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)) reverted.add(m[1]!);
    if (e.subject.startsWith('live:') && ![...reverted].some((r) => e.sha.startsWith(r) || r.startsWith(e.sha))) return e.sha;
  }
  return null;
};

/** Reverts the newest not yet reverted commit with the prefix "live:" using git revert. */
export const undoLastLive = (repo: string, gitArgs: string[] = []): string => {
  const git = (...a: string[]) => execFileSync('git', [...gitArgs, '-C', repo, ...a], { stdio: 'pipe' }).toString();
  const raw = git('log', '--format=%H%x1f%s%x1f%b%x1e');
  const log = raw.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha = '', subject = '', body = ''] = r.split('\x1f');
    return { sha, subject, body };
  });
  const hash = pickUndoTarget(log);
  if (!hash) throw new Error('Kein Commit mit Präfix live: gefunden.');
  git('revert', '--no-edit', hash);
  return hash;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`Rückgängig: ${undoLastLive(process.cwd())}\n`);
}
