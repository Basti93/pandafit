import { buildSportChart, readSportChart, sportChartSentence, sportChartSummary, sportVerdicts, type SportChart } from '../../src/shared/sport-chart';

const range = { fromMs: 0, toMs: 28 * 86_400_000 };
const part = (c: SportChart, s: string) => c.parts.find((p) => p.sport === s);
const mk = (parts: [string, number, number][]): SportChart => ({ kind: 'sport', ...range, parts: parts.map(([sport, minutes, target]) => ({ sport, minutes, target })) as SportChart['parts'] });

describe('buildSportChart', () => {
  it('verteilt das Ziel nach Gewicht aus dem Register: Schwerpunkt 2, gleich 1, halten 0,5', () => {
    const c = buildSportChart({ ...range, minutes: { strength: 60, bike: 60, run: 60 }, sports: { gym: 'focus', bike: 'equal', run: 'keep' } })!;
    expect(part(c, 'gym')!.target).toBeCloseTo(2 / 3.5);
    expect(part(c, 'bike')!.target).toBeCloseTo(1 / 3.5);
    expect(part(c, 'run')!.target).toBeCloseTo(0.5 / 3.5);
  });
  it('zählt Laufen und sonstige Ausdauer zusammen, Mobility nicht', () => {
    const c = buildSportChart({ ...range, minutes: { strength: 0, bike: 0, run: 30, other: 45, mobility: 99 }, sports: { run: 'equal' } })!;
    expect(part(c, 'run')!.minutes).toBe(75);
    expect(c.parts.map((p) => p.sport)).toEqual(['run']);
  });
  it('zeigt eine nicht gewählte Sportart nur, wenn trainiert wurde, mit Ziel 0', () => {
    const c = buildSportChart({ ...range, minutes: { strength: 40, bike: 0, run: 0 }, sports: { bike: 'equal', gym: undefined } })!;
    expect(c.parts.map((p) => [p.sport, p.target])).toEqual([['gym', 0], ['bike', 1]]);
  });
  it('ohne Trainingszeit gibt es kein Diagramm', () => {
    expect(buildSportChart({ ...range, minutes: { strength: 0, bike: 0, run: 0 }, sports: { gym: 'focus' } })).toBeNull();
    expect(buildSportChart({ ...range, minutes: {}, sports: {} })).toBeNull();
  });
  it('rundet Minuten ganz', () => {
    expect(part(buildSportChart({ ...range, minutes: { bike: 10.6 }, sports: {} })!, 'bike')!.minutes).toBe(11);
  });
});

describe('sportVerdicts', () => {
  it('passt innerhalb von 10 Prozentpunkten, sonst zu wenig oder zu viel', () => {
    const v = sportVerdicts(mk([['gym', 50, 0.5], ['bike', 36, 0.4], ['run', 14, 0.1]]));
    expect(v).toEqual({ gym: 'passt', bike: 'passt', run: 'passt' });
    expect(sportVerdicts(mk([['gym', 80, 0.5], ['bike', 10, 0.3], ['run', 10, 0.2]]))).toEqual({ gym: 'zu viel', bike: 'zu wenig', run: 'passt' });
  });
  it('ohne Ziel gibt es kein Urteil', () => {
    expect(sportVerdicts(mk([['gym', 50, 0], ['bike', 50, 0]]))).toEqual({});
  });
});

describe('sportChartSentence', () => {
  it('sagt in Worten, was passt', () => {
    expect(sportChartSentence(mk([['gym', 50, 0.5], ['bike', 50, 0.5]]))).toBe('Kraft und Rad passen gut zu deinem Ziel.');
    expect(sportChartSentence(mk([['gym', 100, 1]]))).toBe('Kraft passt gut zu deinem Ziel.');
    expect(sportChartSentence(mk([['gym', 40, 0.4], ['bike', 40, 0.4], ['run', 20, 0.2]]))).toBe('Kraft, Rad und Laufen & Co. passen gut zu deinem Ziel.');
  });
  it('nennt die größte Abweichung mit richtiger Grammatik je Sportart', () => {
    expect(sportChartSentence(mk([['gym', 60, 0.4], ['bike', 40, 0.3], ['run', 0, 0.3]]))).toBe('Für Laufen & Co. war zuletzt weniger Zeit, als dein Ziel vorsieht.');
    expect(sportChartSentence(mk([['gym', 20, 0.5], ['bike', 80, 0.5]]))).toBe('Fürs Krafttraining war zuletzt weniger Zeit, als dein Ziel vorsieht.');
    expect(sportChartSentence(mk([['gym', 80, 0.4], ['bike', 10, 0.3], ['run', 10, 0.3]]))).toBe('Das Krafttraining nahm zuletzt mehr Zeit ein, als dein Ziel vorsieht.');
    expect(sportChartSentence(mk([['bike', 90, 0.4], ['run', 10, 0.6]]))).toBe('Für Laufen & Co. war zuletzt weniger Zeit, als dein Ziel vorsieht.');
    expect(sportChartSentence(mk([['bike', 80, 0.2], ['gym', 20, 0.8]]))).toBe('Fürs Krafttraining war zuletzt weniger Zeit, als dein Ziel vorsieht.');
  });
  it('nennt die Ausdauer-Sportart im Plural beim Zuviel', () => {
    expect(sportChartSentence(mk([['gym', 10, 0.4], ['run', 90, 0.6 - 0.5]]))).toBe('Laufen & Co. nahm zuletzt mehr Zeit ein, als dein Ziel vorsieht.');
  });
  it('ohne Ziel sagt der Satz das und enthält keine Zahl', () => {
    const s = sportChartSentence(mk([['gym', 50, 0], ['bike', 50, 0]]));
    expect(s).toMatch(/Ziel/);
    expect(s).not.toMatch(/\d/);
  });
  it('enthält nie eine Zahl', () => {
    for (const c of [mk([['gym', 90, 0.5], ['bike', 10, 0.5]]), mk([['gym', 50, 0.5], ['bike', 50, 0.5]])]) expect(sportChartSentence(c)).not.toMatch(/\d/);
  });
});

describe('sportChartSummary', () => {
  it('fasst in Worten zusammen: Ausdauer und Kraft, was passt, zu wenig, zu viel', () => {
    const s = sportChartSummary(mk([['gym', 90, 0.5], ['bike', 10, 0.5]]));
    expect(s).toMatch(/Ausdauer und Kraft/);
    expect(s).toMatch(/Zu viel: Kraft/);
    expect(s).toMatch(/Zu wenig: Rad/);
    expect(sportChartSummary(mk([['gym', 50, 0.5], ['bike', 50, 0.5]]))).toMatch(/Passt: Kraft, Rad/);
  });
});

describe('readSportChart', () => {
  const ok = mk([['gym', 50, 0.5], ['bike', 50, 0.5]]);
  it('liest ein gespeichertes Diagramm', () => expect(readSportChart(JSON.parse(JSON.stringify(ok)))).toEqual(ok));
  it('gibt null für andere Arten und unbrauchbare Daten', () => {
    expect(readSportChart({ ...ok, kind: 'muskeln' })).toBeNull();
    expect(readSportChart({ ...ok, parts: [] })).toBeNull();
    expect(readSportChart({ ...ok, parts: [{ sport: 'swim', minutes: 1, target: 0 }] })).toBeNull();
    expect(readSportChart({ ...ok, parts: [{ sport: 'gym', minutes: -1, target: 0 }] })).toBeNull();
    expect(readSportChart({ ...ok, parts: [{ sport: 'gym', minutes: 1, target: 2 }] })).toBeNull();
    expect(readSportChart({ ...ok, parts: [{ sport: 'gym', minutes: 0, target: 0 }, { sport: 'gym', minutes: 0, target: 0 }] })).toBeNull();
    expect(readSportChart({ ...ok, toMs: -1 })).toBeNull();
    expect(readSportChart('x')).toBeNull();
  });
});
