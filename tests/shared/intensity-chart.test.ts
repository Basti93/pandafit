import { buildIntensityChart, intensityBands, intensityChartSentence, intensityChartSummary, readIntensityChart, type IntensityChart } from '../../src/shared/intensity-chart';

const WEEK = 7 * 86_400_000;
const totals = (strengthSessions: number, enduranceMin: number, hardSessions: number) => ({ strengthSessions, enduranceMin, hardSessions });
const chart = (strength: number, endurance: number, hard: number, goal: Parameters<typeof intensityBands>[0] = { strength: 'muscle', sports: { gym: 'equal', bike: 'equal' } }, weeks = 4, newToIntensity = false): IntensityChart =>
  buildIntensityChart({ fromMs: 0, toMs: weeks * WEEK, totals: totals(strength * weeks, endurance * weeks, hard * weeks), goal, newToIntensity })!;

describe('intensityBands', () => {
  it('uses the equal bands and the WHO floor', () => {
    expect(intensityBands({ strength: 'muscle', sports: { gym: 'equal', run: 'equal' } }, false)).toEqual({
      strength: { min: 2, max: 3 }, endurance: { min: 150, max: 300 }, hard: { min: 1, max: 1 },
    });
  });
  it('shifts the bands with the priority; endurance follows the higher of bike and run', () => {
    expect(intensityBands({ strength: 'muscle', sports: { gym: 'focus', bike: 'keep', run: 'focus' } }, false)).toEqual({
      strength: { min: 3, max: 4 }, endurance: { min: 300, max: 450 }, hard: { min: 1, max: 2 },
    });
    expect(intensityBands({ strength: 'muscle', sports: { gym: 'keep', bike: 'keep' } }, false)).toEqual({
      strength: { min: 2, max: 2 }, endurance: { min: 150, max: 300 }, hard: { min: 0, max: 1 },
    });
  });
  it('caps strength at 3 for the fitness goal and hard sessions at 1 without a history of them', () => {
    const b = intensityBands({ strength: 'fitness', sports: { gym: 'focus', bike: 'focus' } }, true);
    expect(b.strength).toEqual({ min: 3, max: 3 });
    expect(b.hard).toEqual({ min: 1, max: 1 });
  });
  it('gives a sport the goal does not name only the WHO floor (no upper edge to exceed)', () => {
    const b = intensityBands({ strength: 'muscle', sports: { bike: 'equal' } }, false);
    expect(b.strength).toMatchObject({ min: 2, floorOnly: true });
    expect(intensityBands({ strength: 'muscle', sports: { gym: 'equal' } }, false).endurance).toMatchObject({ min: 150, floorOnly: true });
  });
});

describe('buildIntensityChart', () => {
  it('averages per week and carries the bands', () => {
    const c = chart(2, 200, 1);
    expect(c).toMatchObject({ kind: 'intensity', weeks: 4, strength: { perWeek: 2, min: 2, max: 3 }, endurance: { perWeek: 200, min: 150, max: 300 }, hard: { perWeek: 1, min: 1, max: 1 } });
  });
  it('is null without any training', () => {
    expect(buildIntensityChart({ fromMs: 0, toMs: WEEK, totals: totals(0, 0, 0), goal: { strength: 'muscle', sports: {} }, newToIntensity: false })).toBeNull();
  });
  it('counts a period under one week as one week', () => {
    const c = buildIntensityChart({ fromMs: 0, toMs: 3 * 86_400_000, totals: totals(2, 100, 0), goal: { strength: 'muscle', sports: {} }, newToIntensity: false })!;
    expect(c.weeks).toBe(1);
    expect(c.strength.perWeek).toBe(2);
  });
});

describe('intensityChartSentence', () => {
  it('says it fits', () => {
    expect(intensityChartSentence(chart(2.5, 200, 1))).toBe('Kraft, Ausdauer und harte Einheiten passen gut zu deinem Ziel.');
  });
  it('names the clearest gap in words', () => {
    expect(intensityChartSentence(chart(1, 200, 1))).toBe('Zu deinem Ziel würde ein Tag mehr Kraft pro Woche passen.');
    expect(intensityChartSentence(chart(0, 200, 1, { strength: 'muscle', sports: { gym: 'focus', bike: 'equal' } }))).toBe('Zu deinem Ziel würden drei Tage mehr Kraft pro Woche passen.');
    expect(intensityChartSentence(chart(2.5, 200, 0))).toBe('Eine harte Einheit mehr pro Woche würde zu deinem Ziel passen.');
  });
  it('picks the largest gap relative to its band', () => {
    expect(intensityChartSentence(chart(2, 60, 1))).toMatch(/^Bei der Ausdauer/);
  });
  it('is calm below the WHO floor', () => {
    expect(intensityChartSentence(chart(2.5, 100, 1))).toBe('Bei der Ausdauer wäre pro Woche etwa eine Stunde mehr gut für dein Ziel, aber auch weniger ist schon sinnvoll.');
  });
  it('names an excess', () => {
    expect(intensityChartSentence(chart(2.5, 420, 1))).toBe('Bei der Ausdauer liegst du über deinem Ziel, pro Woche würden etwa zwei Stunden weniger reichen.');
    expect(intensityChartSentence(chart(4, 200, 1))).toBe('Für dein Ziel würde ein Tag weniger Kraft pro Woche reichen.');
    expect(intensityChartSentence(chart(2.5, 200, 2.5))).toBe('Du trainierst öfter hart, als dein Ziel vorsieht: zwei harte Einheiten weniger pro Woche würden reichen.');
  });
  it('does not call training beyond a sport the goal does not name an excess', () => {
    expect(intensityChartSentence(chart(5, 200, 1, { strength: 'muscle', sports: { bike: 'equal' } }))).toBe('Kraft, Ausdauer und harte Einheiten passen gut zu deinem Ziel.');
  });
  it('has no digits', () => {
    for (const c of [chart(1, 200, 1), chart(2.5, 100, 1), chart(5, 420, 3)]) expect(intensityChartSentence(c)).not.toMatch(/\d/);
  });
});

describe('intensityChartSummary', () => {
  it('describes each row in words', () => {
    const s = intensityChartSummary(chart(1, 200, 3));
    expect(s).toContain('Kraft: darunter');
    expect(s).toContain('Ausdauer: im Zielbereich');
    expect(s).toContain('Intensiv: darüber');
  });
});

describe('readIntensityChart', () => {
  it('reads what it wrote', () => {
    const c = chart(2, 200, 1);
    expect(readIntensityChart(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
  it('gives null for old sport cards, other kinds and broken data, never throws', () => {
    expect(readIntensityChart({ kind: 'sport', fromMs: 0, toMs: 1, parts: [{ sport: 'gym', minutes: 3, target: 0.5 }] })).toBeNull();
    for (const bad of [null, 5, 'x', [], {}, { kind: 'intensity' }, { kind: 'intensity', fromMs: 0, toMs: 1, weeks: 1, strength: {}, endurance: {}, hard: {} }]) expect(readIntensityChart(bad)).toBeNull();
  });
});
