import { describe, expect, it } from 'vitest';
import { buildGymPrompt, GYM_SYSTEM_PROMPT } from '../../../src/coach/gym/prompt';
import { initialGymState } from '../../../src/coach/gym/state';
import { ruleNamedRange } from '../../../src/shared/training-policy';

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

describe('Gym-Prompt und Härte', () => {
  const reserve = (push: string) => { const r = ruleNamedRange('push.rir', push); return `Plane die Arbeitssätze mit ${r.min} bis ${r.max} Wiederholungen Reserve.`; };
  it('vorsichtig: Reserve aus dem Register, keine Versagens- und Drop-Sätze', () => {
    const p = buildGymPrompt({ ...base, push: 'gentle' });
    expect(p).toContain(`Härte: Vorsichtig. ${reserve('gentle')}`);
    expect(p).toContain('Keine Versagens-, keine Drop-Sätze und keine Widowmaker.');
  });
  it('normal: Versagen höchstens im letzten Satz', () => {
    const p = buildGymPrompt({ ...base, push: 'normal' });
    expect(p).toContain(`Härte: Normal. ${reserve('normal')}`);
    expect(p).toContain('Versagen höchstens im letzten Satz an sicheren Geräten.');
  });
  it('hart: Versagens- und Drop-Sätze innerhalb der Grenze', () => {
    const p = buildGymPrompt({ ...base, push: 'hard' });
    expect(p).toContain(`Härte: Fordere mich. ${reserve('hard')}`);
    expect(p).toContain('Versagens- und Drop-Sätze sind an sicheren Geräten erlaubt, innerhalb der Grenze für Versagenssätze.');
  });
  it('ohne Angabe gilt die Härte des Ziels, bei offener Beschwerde vorsichtig', () => {
    expect(buildGymPrompt(base)).toContain('Härte: Normal.');
    expect(buildGymPrompt({ ...base, goal: { strength: 'muscle', focus: [], sports: {}, push: 'hard' } })).toContain('Härte: Fordere mich.');
    const complaint = { id: 'c', text: 'Schulter', status: 'healing' as const, startedMs: 1, updatedMs: 1 };
    expect(buildGymPrompt({ ...base, goal: { strength: 'muscle', focus: [], sports: {}, push: 'hard' }, complaints: [complaint] })).toContain('Härte: Vorsichtig.');
  });
});
