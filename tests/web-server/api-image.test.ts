import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

/**
 * Both images copy whole source folders, not single files. These tests keep the folder lists complete: everything the server
 * (api image) or the coach image starts from must lie inside a copied folder. The module boundaries themselves are in
 * tests/architecture/boundaries.test.ts.
 */
const root = join(__dirname, '..', '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

const copiedFolders = (dockerfile: string): string[] =>
  [...read(dockerfile).matchAll(/^COPY\s+(src\/\S+)\s+\.\/src\//gm)].map((m) => m[1]!);

/** Relative value imports (not `import type`) of a file, as repo paths without extension. */
function imports(file: string): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/^import\s+(?!type\b)[^'"]*from\s+'(\.[^']+)'/gm)) out.push(normalize(join(dirname(file), m[1]!)));
  return out;
}

function closure(starts: string[]): Set<string> {
  const seen = new Set<string>();
  const todo = [...starts];
  while (todo.length) {
    const f = todo.pop()!;
    for (const i of imports(f)) {
      const file = [`${i}.ts`, `${i}.tsx`, `${i}/index.ts`].find((c) => { try { return statSync(join(root, c)).isFile(); } catch { return false; } });
      if (!file || seen.has(file)) continue;
      seen.add(file);
      todo.push(file);
    }
  }
  return seen;
}

const outside = (files: Set<string>, folders: string[]): string[] =>
  [...files].filter((f) => f.startsWith('src/') && !folders.some((d) => f.startsWith(`${d}/`))).sort();

describe('docker images', () => {
  it('the api image copies the whole src/shared folder and the server needs nothing else from src', () => {
    expect(copiedFolders('web-server/Dockerfile')).toEqual(['src/shared']);
    const starts = readdirSync(join(root, 'web-server')).filter((f) => f.endsWith('.ts')).map((f) => `web-server/${f}`);
    expect(outside(closure(starts), ['src/shared'])).toEqual([]);
  });

  it('the coach image copies whole folders and the coach server needs nothing else from src', () => {
    const folders = copiedFolders('web-server/Dockerfile.coach');
    expect(folders).toEqual(expect.arrayContaining(['src/coach', 'src/shared', 'src/ride-format', 'src/tracking']));
    expect(folders.every((f) => relative('src', f).split('/').length === 1)).toBe(true);
    expect(outside(closure(['src/coach/server/main.ts']), folders)).toEqual([]);
  });
});
