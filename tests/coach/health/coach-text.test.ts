import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CoachTexts, HealthCoachText, fallbackCoachText, guardCoachText, healthTextInput } from '../../../src/coach/health/coach-text';
import type { HealthBody, HealthFinding } from '../../../src/shared/health';

const MON = new Date(2026, 10, 2, 7).getTime();
const f = (text: string, tone: HealthFinding['tone'] = 'info'): HealthFinding => ({ rule: 'health.steps-band', text, tone });
const body = (findings: HealthFinding[]): Pick<HealthBody, 'findings' | 'weeks' | 'today'> => ({ findings, weeks: [{ week: '2026-10-26', rhr: 55, steps: 7200 }], today: { level: 'normal', reasons: [] } });
const BASIC = body([f('Letzte Woche lagst du im Schnitt bei etwa 7.200 Schritten pro Tag; ein Richtwert aus Studien sind 8.000 bis 10.000.')]);
const DOC = body([f('Dein Ruhepuls lag an mehreren der letzten Tage über 100. Das lässt du am besten ärztlich abklären.', 'arzt')]);

let dir: string;
let texts: CoachTexts;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-htext-')); texts = new CoachTexts(path.join(dir, 'texts.json')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('guardCoachText', () => {
  const input = healthTextInput(BASIC);
  it('accepts a rephrasing with digits from the input', () => {
    expect(guardCoachText('Deine Schritte lagen bei 7.200 am Tag, etwas unter dem Richtwert von 8.000 bis 10.000.', input, BASIC.findings)).not.toBeNull();
  });
  it('rejects invented digits, diagnosis words, "du hast", long text and empty text', () => {
    expect(guardCoachText('Es waren 9.000 Schritte.', input, BASIC.findings)).toBeNull();
    expect(guardCoachText('Das könnte eine Infektion sein.', input, BASIC.findings)).toBeNull();
    expect(guardCoachText('Du hast einen Herzrhythmus, der auffällt.', input, BASIC.findings)).toBeNull();
    expect(guardCoachText('Du hast zu wenig Schritte gemacht.', input, BASIC.findings)).toBeNull();
    expect(guardCoachText('Dein Stresslevel war hoch.', input, BASIC.findings)).toBeNull();
    expect(guardCoachText('Ruhig. '.repeat(120), input, BASIC.findings)).toBeNull();
    expect(guardCoachText('   ', input, BASIC.findings)).toBeNull();
  });
  it('needs the doctor mentioned when a finding says so', () => {
    const doc = healthTextInput(DOC);
    expect(guardCoachText('Dein Ruhepuls war auffällig hoch, das lässt du am besten ärztlich abklären.', doc, DOC.findings)).not.toBeNull();
    expect(guardCoachText('Dein Ruhepuls war auffällig hoch, beobachte ihn weiter.', doc, DOC.findings)).toBeNull();
  });
});

describe('fallbackCoachText', () => {
  it('joins the findings, conspicuous first as given, and stays under the limit', () => {
    expect(fallbackCoachText([f('Eins.'), f('Zwei.')])).toBe('Eins. Zwei.');
    expect(fallbackCoachText([f('x'.repeat(400)), f('y'.repeat(400))])).toBe('x'.repeat(400));
    expect(fallbackCoachText([])).toBe('');
  });
});

describe('HealthCoachText', () => {
  const make = (ask: (i: { prompt: string; systemPrompt: string; schema: object }) => Promise<unknown>, now = MON) => new HealthCoachText({ texts, nowMs: () => now, ask });

  it('stores the AI text once per week', async () => {
    let calls = 0;
    const t = make(async () => { calls++; return { text: 'Deine Schritte lagen bei 7.200, etwas unter dem Richtwert.' }; });
    expect(await t.tick('pa', BASIC)).toBe(true);
    expect(texts.get('pa')).toEqual({ week: '2026-11-02', text: 'Deine Schritte lagen bei 7.200, etwas unter dem Richtwert.' });
    expect(await t.tick('pa', BASIC)).toBe(false);
    expect(await make(async () => { calls++; return { text: 'x' }; }, MON + 3 * 86_400_000).tick('pa', BASIC)).toBe(false);
    expect(calls).toBe(1);
    // a new week asks again, and a restart (new store object) still knows the old one
    const later = new CoachTexts(path.join(dir, 'texts.json'));
    expect(later.get('pa')!.week).toBe('2026-11-02');
    expect(await make(async () => { calls++; return { text: 'Neue Woche, 7.200 Schritte.' }; }, MON + 7 * 86_400_000).tick('pa', BASIC)).toBe(true);
    expect(calls).toBe(2);
  });

  it('falls back to the findings on invented numbers or diagnosis words, and does not ask again that week', async () => {
    let calls = 0;
    const t = make(async () => { calls++; return { text: 'Das sind 12.345 Schritte und vielleicht eine Infektion.' }; });
    await t.tick('pa', BASIC);
    expect(texts.get('pa')!.text).toBe(BASIC.findings[0]!.text);
    await t.tick('pa', BASIC);
    expect(calls).toBe(1);
  });

  it('falls back when the AI is down or answers nonsense', async () => {
    await make(async () => { throw new Error('down'); }).tick('pa', DOC);
    expect(texts.get('pa')!.text).toBe(DOC.findings[0]!.text);
    await make(async () => ({ nope: 1 })).tick('pb', DOC);
    expect(texts.get('pb')!.text).toContain('ärztlich abklären');
  });

  it('says nothing without findings and asks the AI only the findings and weeks', async () => {
    let calls = 0;
    expect(await make(async () => { calls++; return { text: 'x' }; }).tick('pa', body([]))).toBe(false);
    expect(calls).toBe(0);
    let seen = '';
    await make(async (i) => { seen = i.prompt + i.systemPrompt; return { text: 'Kurz.' }; }).tick('pa', BASIC);
    expect(seen).toContain('Keine Diagnose');
    expect(seen).not.toMatch(/bodyBattery|stressAvg/);
  });
});
