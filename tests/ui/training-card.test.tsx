// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { StepList } from '../../src/ui/views/TrainingCard';
import type { Session } from '../../src/shared/session';

afterEach(cleanup);
const session = (hold: boolean): Session => ({ id: 's', name: 's', steps: [
  { kind: 'erg', durationS: 1200, ftpFraction: 0.6, label: 'Locker', hrZone: 2, ...(hold ? { hrHold: true } : {}) },
] });

test('a hold section says that the watts follow the heart rate', () => {
  const { container } = render(<StepList session={session(true)} ftpW={200} />);
  expect(container.textContent).toContain('Die Watt folgen deinem Puls in Zone 2');
  expect(container.textContent).not.toContain('Puls bis');
});
test('a normal heart rate limit still says up to', () => {
  const { container } = render(<StepList session={session(false)} ftpW={200} />);
  expect(container.textContent).toContain('Puls bis');
});
