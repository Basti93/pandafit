// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WaitingProposal } from '../../src/tracking/ui/WaitingProposal';

afterEach(cleanup);

test('a jump to another place is an outline button', () => {
  render(<WaitingProposal onOpen={() => {}} />);
  expect(screen.getByRole('button', { name: 'Ansehen' }).className).toBe('secondary');
});

test('the old ghost alias is gone: one name per button look', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });
  for (const f of ['src/tracking/ui/tracking.css', 'src/web/web.css']) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\.ghost\b/);
  for (const f of [...files('src/tracking/ui'), ...files('src/web')].filter((p) => p.endsWith('.tsx'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/className="ghost/);
});
