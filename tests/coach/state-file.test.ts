import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStateFile, legacyRuleTexts } from '../../src/coach/state-file';

type S = { n: number };
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sf-')), 'sub', 'p.json');
const mk = (f: string, migrate?: (raw: unknown) => S) => createStateFile<S>(f, { empty: () => ({ n: 0 }), migrate });

test('missing file gives empty, save creates the folder and load reads it back', () => {
  const f = tmp();
  const sf = mk(f);
  expect(sf.load()).toEqual({ n: 0 });
  sf.save({ n: 3 });
  expect(mk(f).load()).toEqual({ n: 3 });
  expect(fs.readdirSync(path.dirname(f))).toEqual(['p.json']);
});

test('broken JSON or a failing migrate keeps the file aside and gives empty', () => {
  const f = tmp();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{"n":');
  expect(mk(f).load()).toEqual({ n: 0 });
  expect(fs.readFileSync(`${f}.broken`, 'utf8')).toBe('{"n":');
  fs.writeFileSync(f, '[]');
  const strict = mk(f, (raw) => { if (!Array.isArray(raw) || raw.length > 0) throw new Error('x'); return { n: 1 }; });
  expect(strict.load()).toEqual({ n: 1 });
  fs.writeFileSync(f, '{"a":1}');
  expect(strict.load()).toEqual({ n: 0 });
});

test('migrate sees the raw value and can drop legacy fields', () => {
  const f = tmp();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ n: 5, rules: [{ text: 'a' }] }));
  const sf = mk(f, (raw) => ({ n: (raw as S).n }));
  expect(sf.load()).toEqual({ n: 5 });
  expect(legacyRuleTexts(f)).toEqual(['a']);
});

test('keepRules keeps legacy rules in the file, otherwise they go', () => {
  const f = tmp();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ n: 1, rules: [{ text: 'a' }] }));
  const sf = mk(f);
  sf.save({ n: 2 }, { keepRules: true });
  expect(legacyRuleTexts(f)).toEqual(['a']);
  sf.save({ n: 3 });
  expect(legacyRuleTexts(f)).toEqual([]);
});
