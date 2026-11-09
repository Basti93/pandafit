import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

type Edge = { from: string; to: string; typeOnly: boolean };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const rel = posix.join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

const STATIC_RE = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

export function edgesOf(file: string, text: string): Edge[] {
  const edges: Edge[] = [];
  const add = (spec: string, typeOnly: boolean) => {
    if (!spec.startsWith('.')) return;
    edges.push({ from: file, to: posix.normalize(posix.join(dirname(file), spec)), typeOnly });
  };
  for (const m of text.matchAll(STATIC_RE)) add(m[3], m[2] !== undefined);
  for (const m of text.matchAll(DYNAMIC_RE)) add(m[1], false);
  return edges;
}

function allEdges(): Edge[] {
  const files = [...walk('src'), ...walk('web-server')];
  return files.flatMap((f) => edgesOf(f, readFileSync(join(ROOT, f), 'utf8')));
}

const under = (p: string, prefix: string) => p === prefix || p.startsWith(prefix + '/');

type Rule = { name: string; violates: (e: Edge) => boolean };

const rules: Rule[] = [
  {
    name: 'shared imports only shared and ride-format',
    violates: (e) =>
      under(e.from, 'src/shared') && e.to.startsWith('src/') && !under(e.to, 'src/shared') && !under(e.to, 'src/ride-format'),
  },
  {
    name: 'ride-format imports only shared',
    violates: (e) => under(e.from, 'src/ride-format') && e.to.startsWith('src/') && !under(e.to, 'src/shared') && !under(e.to, 'src/ride-format'),
  },
  {
    name: 'coach does not import service, ui, web, main',
    violates: (e) => under(e.from, 'src/coach') && ['src/service', 'src/ui', 'src/web', 'src/main'].some((p) => under(e.to, p)),
  },
  {
    name: 'ui and web import coach only as types',
    violates: (e) => (under(e.from, 'src/ui') || under(e.from, 'src/web')) && under(e.to, 'src/coach') && !e.typeOnly,
  },
  {
    name: 'tracking imports coach only as types',
    violates: (e) => under(e.from, 'src/tracking') && under(e.to, 'src/coach') && !e.typeOnly,
  },
  {
    name: 'web-server imports only src/shared from src',
    violates: (e) => under(e.from, 'web-server') && e.to.startsWith('src/') && !under(e.to, 'src/shared'),
  },
  {
    name: 'service does not import coach, ui, web',
    violates: (e) => under(e.from, 'src/service') && ['src/coach', 'src/ui', 'src/web'].some((p) => under(e.to, p)),
  },
];

// Known violations with a reason. Goal: empty.
const exceptions: { rule: string; from: string; reason: string }[] = [
  { rule: 'shared imports only shared and ride-format', from: 'src/shared/changes.ts', reason: 'to move (task 8)' },
  { rule: 'shared imports only shared and ride-format', from: 'src/shared/coach-protocol.ts', reason: 'to move (task 8)' },
  { rule: 'shared imports only shared and ride-format', from: 'src/shared/protocol.ts', reason: 'to move (task 8)' },
  { rule: 'ui and web import coach only as types', from: 'src/ui/views/CoachView.tsx', reason: 'to move (task 8)' },
  { rule: 'ui and web import coach only as types', from: 'src/ui/views/FeedbackView.tsx', reason: 'to move (task 8)' },
  { rule: 'ui and web import coach only as types', from: 'src/ui/views/GarminCard.tsx', reason: 'to move (task 8)' },
  { rule: 'ui and web import coach only as types', from: 'src/ui/views/GarminUploadButton.tsx', reason: 'to move (task 8)' },
  { rule: 'ui and web import coach only as types', from: 'src/ui/views/TrainingCard.tsx', reason: 'to move (task 8)' },
  { rule: 'ui and web import coach only as types', from: 'src/web/logic.ts', reason: 'to move (task 8)' },
];

describe('architecture boundaries', () => {
  const edges = allEdges();
  const key = (rule: string, from: string) => `${rule} | ${from}`;
  const allowed = new Set(exceptions.map((x) => key(x.rule, x.from)));

  for (const rule of rules) {
    it(rule.name, () => {
      const bad = edges.filter((e) => rule.violates(e));
      const unexpected = bad.filter((e) => !allowed.has(key(rule.name, e.from)));
      if (process.env.ARCH_COUNT) console.log(`${rule.name}: ${bad.length} violating imports`);
      expect(unexpected.map((e) => `${e.from} -> ${e.to}${e.typeOnly ? ' (type)' : ''}`)).toEqual([]);
    });
  }

  it('exceptions list has no stale entries', () => {
    const stale = exceptions.filter((x) => {
      const rule = rules.find((r) => r.name === x.rule)!;
      return !edges.some((e) => e.from === x.from && rule.violates(e));
    });
    expect(stale.map((x) => `${x.rule} | ${x.from}`)).toEqual([]);
  });
});
