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
  it('verlangt für eine nie gemachte Übung ein vorsichtiges Startgewicht', () => {
    expect(GYM_SYSTEM_PROMPT).toContain('noch nie gemacht hat, gib ein vorsichtiges Startgewicht an');
    expect(GYM_SYSTEM_PROMPT).toContain('lieber zu leicht als zu schwer');
    expect(GYM_SYSTEM_PROMPT).not.toContain('ohne Verlauf weight null');
  });
  it('wägt Muskellücken ab', () => {
    expect(GYM_SYSTEM_PROMPT).toContain('gegen Ziel und Schwerpunkt ab');
    expect(GYM_SYSTEM_PROMPT).not.toContain('plane sie bevorzugt ein');
  });
});

describe('Gym-Prompt und Rückfragen', () => {
  it('erlaubt höchstens eine Rückfrage, nur zu dem, was die Daten nicht zeigen', () => {
    expect(GYM_SYSTEM_PROMPT).toContain('höchstens 1 freiwillige Rückfrage');
    expect(GYM_SYSTEM_PROMPT).toContain('nur zu dem, was die Daten nicht zeigen (Beschwerden, Zeit, Geräte, Vorlieben)');
    expect(GYM_SYSTEM_PROMPT).toContain('erklärst es in der Notiz in einem Satz, statt zu fragen');
    expect(GYM_SYSTEM_PROMPT).not.toContain('höchstens zwei freiwillige');
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

describe('Gym-Prompt und Abschnitt', () => {
  const abschnitt = { n: 3, of: 5, template: 'Oberkörper A', light: false, core: [{ templateId: 't1', title: 'Bankdrücken', stagnates: false }, { templateId: 't2', title: 'Rudern', stagnates: true }] };
  it('zeigt Woche, Vorlage und Kernübungen im Block abschnitt', () => {
    const p = buildGymPrompt({ ...base, abschnitt });
    const m = /<abschnitt-nur-daten>\n([\s\S]*?)\n<\/abschnitt-nur-daten>/.exec(p);
    expect(JSON.parse(m![1]!)).toEqual({ woche: 3, von: 5, vorlage: 'Oberkörper A', leichteWoche: false, kernuebungen: [{ templateId: 't1', titel: 'Bankdrücken' }, { templateId: 't2', titel: 'Rudern', stagniert: true }] });
    expect(p).toContain('Im Abschnitt bleiben die Kernübungen; Ergänzungen wählst du frei.');
    expect(p).toContain('Verpasste Einheiten holt niemand nach.');
  });
  it('lässt Block und Satz ohne Abschnitt weg', () => {
    const p = buildGymPrompt(base);
    expect(p).not.toContain('abschnitt');
    expect(p).not.toContain('Im Abschnitt bleiben');
  });
});

describe('Gym-Prompt und Erfahrung', () => {
  it('ohne Angabe keine Zeile, erfahren mit den allgemeinen Grenzen', () => {
    expect(buildGymPrompt(base)).not.toContain('Erfahrung mit Gewichten');
    const p = buildGymPrompt({ ...base, experience: 'erfahren', push: 'hard' });
    expect(p).toContain('Erfahrung mit Gewichten: erfahren. Es gelten die allgemeinen Grenzen.');
    expect(p).toContain('Härte: Fordere mich. Plane die Arbeitssätze mit 0 bis 2 Wiederholungen Reserve. Versagens- und Drop-Sätze');
  });
  it('wer anfängt: Stufe in Worten, engere Grenzen aus den Regeln, Reserve 2 bis 3 und kein Versagen, auch bei „Fordere mich“', () => {
    const p = buildGymPrompt({ ...base, experience: 'neu', push: 'hard' });
    expect(p).toContain('Erfahrung mit Gewichten: fängt an. Für diese Stufe gelten engere Grenzen: höchstens 15 Arbeitssätze und 6 Bruchteilssätze je Muskel pro Training, keine Versagens-, keine Drop-Sätze und keine Widowmaker.');
    expect(p).toContain('Härte: Fordere mich. Plane die Arbeitssätze mit 2 bis 3 Wiederholungen Reserve. Keine Versagens-, keine Drop-Sätze und keine Widowmaker.');
    expect(p).toContain('bevorzugt Maschinen, Kabelzug und einfache Kurzhantelübungen');
  });
  it('einige Monate: mittlere Grenzen, Versagen höchstens am Ende', () => {
    const p = buildGymPrompt({ ...base, experience: 'einige', push: 'hard' });
    expect(p).toContain('Erfahrung mit Gewichten: einige Monate dabei. Für diese Stufe gelten mittlere Grenzen: höchstens 22 Arbeitssätze und 8 Bruchteilssätze je Muskel pro Training, höchstens 2 Versagens- oder Drop-Sätze');
    expect(p).toContain('Versagen höchstens im letzten Satz an sicheren Geräten.');
  });
  it('die Einladung „bis nichts mehr geht“ gilt nicht für eine Person, die anfängt', () => {
    expect(GYM_SYSTEM_PROMPT).toContain('Für eine Person, die gerade anfängt, gilt diese Einladung nicht');
    expect(GYM_SYSTEM_PROMPT).toContain('Engere Grenzen für die Erfahrung der Person stehen im Auftrag und gehen vor.');
  });
  it('die Wiederholungsbereiche im Block muskelvolumen beginnen bei 8, wer anfängt', () => {
    expect(buildGymPrompt({ ...base, experience: 'neu' })).toMatch(/"gruppe":"Brust"[^\]]*?"wiederholungen":\{"min":8,"max":12\}/);
    expect(buildGymPrompt(base)).toMatch(/"gruppe":"Brust"[^\]]*?"wiederholungen":\{"min":6,"max":12\}/);
  });
});
