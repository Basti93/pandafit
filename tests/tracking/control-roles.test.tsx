// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RunFeelQuestion } from '../../src/tracking/ui/RunFeel';

afterEach(cleanup);

test('the old ghost alias is gone: one name per button look', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
  for (const f of ['src/tracking/ui/tracking.css', 'src/web/web.css']) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\.ghost\b/);
  for (const f of [...files('src/tracking/ui'), ...files('src/web')].filter((p) => p.endsWith('.tsx'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/className="ghost/);
});

test('a toggle choice is a chip in .tk-chips, not an outline button', () => {
  render(<RunFeelQuestion onAnswer={() => {}} />);
  const chip = screen.getByRole('button', { name: 'leicht' });
  expect(chip.className).toBe('');
  expect(chip.parentElement!.className).toBe('tk-chips');
  expect(screen.getByRole('button', { name: 'Später' }).className).toBe('link');
});

test('one switch, one chip and one stepper look: the old local copies are gone', () => {
  const css = readFileSync('src/web/web.css', 'utf8') + readFileSync('src/tracking/ui/tracking.css', 'utf8');
  for (const old of ['.pm-seg', '.rc-chips', '.tk-focus', '.rc-portions button']) expect(css, old).not.toContain(old);
});
