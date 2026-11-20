import { buildMuscleChart, chartPeriodRange, chartSentence, chartSummary, readMuscleChart, CHART_PERIODS, type MuscleChart } from '../../src/shared/muscle-chart';
import type { BalanceItem } from '../../src/shared/muscle-balance';

const DAY = 86_400_000;
const bench = { primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'front_delts', 'abdominals'] };
const item = (exercise: BalanceItem['exercise'], sets: number): BalanceItem => ({ exercise, sets, ageMs: 0 });
const range = { fromMs: 0, toMs: 28 * DAY };
const axis = (c: MuscleChart, g: string) => c.axes.find((a) => a.group === g)!;

describe('buildMuscleChart', () => {
  it('zählt direkte Sätze 1 und Mitspieler 0,5, nicht-Mitspieler gar nicht', () => {
    const c = buildMuscleChart([item(bench, 10)], { ...range, goal: 'muscle', focus: [] })!;
    expect(axis(c, 'chest').sets).toBe(10);
    expect(axis(c, 'triceps').sets).toBe(5);
    expect(axis(c, 'front_delts').sets).toBe(5);
    expect(axis(c, 'abs').sets).toBe(0);
  });
  it('hat nur die Achsen aus dem Regelregister, nie Sonstiges', () => {
    const c = buildMuscleChart([item(null, 4), item(bench, 2)], { ...range, goal: 'muscle', focus: [] })!;
    expect(c.axes.map((a) => a.group)).not.toContain('other');
    expect(c.axes.length).toBeGreaterThanOrEqual(8);
  });
  it('skaliert den Zielbereich auf die Wochen des Zeitraums', () => {
    const c = buildMuscleChart([item(bench, 10)], { ...range, goal: 'muscle', focus: [] })!;
    expect(axis(c, 'chest')).toMatchObject({ min: 48, max: 72 }); // 12-18 pro Woche, 4 Wochen
    const half = buildMuscleChart([item(bench, 10)], { fromMs: 0, toMs: 14 * DAY, goal: 'muscle', focus: [] })!;
    expect(axis(half, 'chest')).toMatchObject({ min: 24, max: 36 });
  });
  it('rechnet einen kurzen Zeitraum mindestens als eine Woche', () => {
    const c = buildMuscleChart([item(bench, 3)], { fromMs: 0, toMs: 2 * DAY, goal: 'muscle', focus: [] })!;
    expect(axis(c, 'chest')).toMatchObject({ min: 12, max: 18 });
  });
  it('ohne Sätze gibt es kein Diagramm', () => {
    expect(buildMuscleChart([], { ...range, goal: 'muscle', focus: [] })).toBeNull();
    expect(buildMuscleChart([item(bench, 0)], { ...range, goal: 'muscle', focus: [] })).toBeNull();
  });
  it('für Anfänger gibt es keine Untergrenze, damit nichts als Lücke gilt', () => {
    const c = buildMuscleChart([item(bench, 2)], { ...range, goal: 'muscle', focus: [], experience: 'neu' })!;
    expect(c.axes.every((a) => a.min === 0)).toBe(true);
    expect(chartSentence(c)).not.toMatch(/wenig|fehlt|Platz/);
  });
  it('rundet auf eine Nachkommastelle', () => {
    const c = buildMuscleChart([item({ primaryMuscle: 'chest', secondaryMuscles: ['triceps'] }, 3)], { ...range, goal: 'muscle', focus: [] })!;
    expect(axis(c, 'triceps').sets).toBe(1.5);
  });
});

describe('chartPeriodRange', () => {
  const now = new Date(2026, 10, 29, 18).getTime();
  it('Monat beginnt am Ersten um 0 Uhr', () => {
    expect(chartPeriodRange('month', now)).toEqual({ fromMs: new Date(2026, 10, 1).getTime(), toMs: now });
  });
  it('vier Wochen und drei Monate kommen aus dem Register', () => {
    expect(chartPeriodRange('weeks4', now)).toEqual({ fromMs: now - 28 * DAY, toMs: now });
    expect(chartPeriodRange('months3', now)).toEqual({ fromMs: now - 91 * DAY, toMs: now });
  });
  it('kennt nur diese Zeiträume', () => {
    expect([...CHART_PERIODS]).toEqual(['month', 'weeks4', 'months3']);
  });
});

describe('chartSentence', () => {
  const mk = (rows: [string, number, number, number][]): MuscleChart => ({ kind: 'muskeln', fromMs: 0, toMs: 28 * DAY, axes: rows.map(([group, sets, min, max]) => ({ group: group as never, sets, min, max })) });
  it('nennt die deutlichste Lücke mit Namen', () => {
    const s = chartSentence(mk([['chest', 50, 48, 72], ['back', 10, 32, 40], ['biceps', 30, 40, 56]]));
    expect(s).toContain('Rücken');
    expect(s).not.toContain('Brust');
    expect(s).not.toMatch(/\d/);
  });
  it('nennt den deutlichsten Überschuss, wenn der größer ist als jede Lücke', () => {
    const s = chartSentence(mk([['chest', 200, 48, 72], ['back', 30, 32, 40]]));
    expect(s).toContain('Brust');
  });
  it('sagt ruhig, wenn alles im Ziel liegt', () => {
    const s = chartSentence(mk([['chest', 60, 48, 72], ['back', 36, 32, 40]]));
    expect(s).toMatch(/gut verteilt/);
  });
  it('spricht den Menschen mit du an', () => {
    expect(chartSentence(mk([['back', 1, 32, 40]]))).toMatch(/\b(du|dir|dein|deine|deinem)\b/i);
  });
  it('baut ganze Sätze mit Artikel und passender Verbform', () => {
    const gap = (g: string) => chartSentence(mk([[g, 1, 32, 40]]));
    const over = (g: string) => chartSentence(mk([[g, 99, 32, 40]]));
    expect(gap('calves')).toBe('Die Waden kamen bei dir zuletzt am wenigsten dran, da ist noch Platz.');
    expect(gap('biceps')).toBe('Der Bizeps kam bei dir zuletzt am wenigsten dran, da ist noch Platz.');
    expect(gap('abs')).toBe('Der Bauch kam bei dir zuletzt am wenigsten dran, da ist noch Platz.');
    expect(gap('glutes')).toBe('Das Gesäß kam bei dir zuletzt am wenigsten dran, da ist noch Platz.');
    expect(gap('chest')).toBe('Die Brust kam bei dir zuletzt am wenigsten dran, da ist noch Platz.');
    expect(over('calves')).toBe('Die Waden standen bei dir zuletzt im Vordergrund, du darfst gern etwas ausgleichen.');
    expect(over('back')).toBe('Der Rücken stand bei dir zuletzt im Vordergrund, du darfst gern etwas ausgleichen.');
  });
  it('fasst für Screenreader in Worten zusammen', () => {
    const t = chartSummary(mk([['chest', 60, 48, 72], ['back', 10, 32, 40], ['biceps', 90, 40, 56]]));
    expect(t).toMatch(/Spinnennetz/);
    expect(t).toContain('Rücken');
    expect(t).toContain('Bizeps');
    expect(t).not.toMatch(/\d/);
  });
});

describe('readMuscleChart', () => {
  const ok = { kind: 'muskeln', fromMs: 1, toMs: 2, axes: [{ group: 'chest', sets: 3, min: 1, max: 2 }, { group: 'back', sets: 0, min: 1, max: 2 }, { group: 'abs', sets: 1, min: 0, max: 2 }] };
  it('liest ein gültiges Diagramm', () => { expect(readMuscleChart(ok)).toEqual(ok); });
  it('überspringt unbekannte Arten und kaputte Daten, ohne zu werfen', () => {
    for (const bad of [null, 5, { ...ok, kind: 'herz' }, { ...ok, fromMs: 'x' }, { ...ok, toMs: 0 }, { ...ok, axes: 'x' }, { ...ok, axes: ok.axes.slice(0, 2) },
      { ...ok, axes: [...ok.axes.slice(0, 2), { group: 'other', sets: 1, min: 0, max: 1 }] }, { ...ok, axes: [...ok.axes.slice(0, 2), { group: 'abs', sets: -1, min: 0, max: 1 }] }])
      expect(readMuscleChart(bad)).toBeNull();
  });
});
