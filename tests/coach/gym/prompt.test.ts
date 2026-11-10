import { describe, expect, it } from 'vitest';
import { buildGymPrompt, GYM_SYSTEM_PROMPT } from '../../../src/coach/gym/prompt';
import { initialGymState } from '../../../src/coach/gym/state';

const base = { state: initialGymState('p'), workouts: [], templates: [], nowMs: 1_000_000, summaries: [], complaints: [], previous: null, wantNote: false };

describe('Gym-Prompt und Rückblick', () => {
  it('gibt dem Planer die Beobachtungen des letzten Rückblicks', () => {
    const p = buildGymPrompt({ ...base, review: { observations: [{ text: 'Beobachtung Eins', reason: 'Grund A' }, { text: 'Beobachtung Zwei', reason: 'Grund B' }] } });
    expect(p).toContain('<rueckblick-nur-daten>');
    expect(p).toContain('Beobachtung Eins');
    expect(p).toContain('Beobachtung Zwei');
  });
  it('lässt den Block ohne Rückblick weg', () => {
    expect(buildGymPrompt(base)).not.toContain('rueckblick');
  });
  it('wägt Muskellücken ab', () => {
    expect(GYM_SYSTEM_PROMPT).toContain('gegen Ziel und Schwerpunkt ab');
    expect(GYM_SYSTEM_PROMPT).not.toContain('plane sie bevorzugt ein');
  });
});
