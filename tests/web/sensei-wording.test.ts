import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');
function files(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, exts, out);
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// Sichtbarer Text: JSX-Text zwischen > und < (auch über Zeilen) und String-Literale. Bezeichner wie CoachScreen zählen nicht.
const VISIBLE = /(?:>[^<>{}]*\bCoach(?:es)?\b[^<>{}]*<)|(?:(['"`])(?:(?!\1)[\s\S])*?\bCoach(?:es)?\b(?:(?!\1)[\s\S])*?\1)/g;
const hits = (paths: string[]) =>
  paths.flatMap((f) => [...read(f).replace(/^\s*import .*$/gm, '').matchAll(VISIBLE)].map((m) => `${f}: ${m[0].slice(0, 80)}`));

describe('Sensei wording', () => {
  it('never calls Bo a coach in the web app', () => {
    expect(hits([...files('src/web', ['.ts', '.tsx']), ...files('src/tracking/ui', ['.ts', '.tsx'])])).toEqual([]);
  });
  it('never calls Bo a coach in push and e-mail texts', () => {
    expect(hits([...files('src/coach', ['.ts']), ...files('web-server', ['.ts'])].filter((f) => /push|mail|notif/i.test(f)))).toEqual([]);
  });
  it('takes the fixed Bo texts from one place', () => {
    expect(read('src/web/today/CoachLine.tsx')).toContain('BO.ask');
  });
});
