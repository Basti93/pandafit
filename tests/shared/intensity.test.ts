import { classifyByAvgHr, classifyByIntensityMinutes, classifyByZoneSeconds, classifyRide, isHardSession, noData, sumClasses } from '../../src/shared/intensity';

const s = (powerW: number | null, hrBpm: number | null = null) => ({ powerW, hrBpm });
const rep = (n: number, x: ReturnType<typeof s>) => Array.from({ length: n }, () => x);

describe('classifyRide', () => {
  it('sorts each second by watts against the FTP: moderate from 45 %, vigorous above 75 %, peak above 105 %', () => {
    const c = classifyRide([...rep(10, s(100)), ...rep(20, s(150)), ...rep(30, s(200)), ...rep(40, s(220))], 200, 190);
    // 100 W = 50 %: moderate, 150 W = 75 %: moderate (not above), 200 W = 100 %: vigorous, 220 W = 110 %: peak and vigorous
    expect(c).toEqual({ moderateS: 30, vigorousS: 70, peakS: 40 });
  });
  it('leaves easy seconds out', () => {
    expect(classifyRide(rep(60, s(80)), 200, null)).toEqual({ moderateS: 0, vigorousS: 0, peakS: 0 });
  });
  it('goes by watts even if the heart rate runs behind', () => {
    expect(classifyRide(rep(300, s(230, 120)), 200, 190)).toEqual({ moderateS: 0, vigorousS: 300, peakS: 300 });
  });
  it('uses the heart rate zone where there is no power: zone 2-3 moderate, 4-5 vigorous, 5 peak', () => {
    // hrMax 200: 110 = zone 1, 130 = zone 2, 150 = zone 3, 170 = zone 4, 190 = zone 5
    const c = classifyRide([...rep(10, s(null, 110)), ...rep(20, s(null, 130)), ...rep(30, s(null, 150)), ...rep(40, s(null, 170)), ...rep(50, s(null, 190))], 200, 200);
    expect(c).toEqual({ moderateS: 50, vigorousS: 90, peakS: 50 });
  });
  it('counts the whole duration as moderate without power and heart rate, never vigorous', () => {
    expect(classifyRide(rep(600, s(null, null)), 200, 190)).toEqual({ moderateS: 600, vigorousS: 0, peakS: 0 });
    expect(classifyRide(rep(600, s(null, 160)), 200, null)).toEqual({ moderateS: 600, vigorousS: 0, peakS: 0 });
  });
  it('is empty without samples', () => {
    expect(classifyRide([], 200, 190)).toEqual({ moderateS: 0, vigorousS: 0, peakS: 0 });
  });
});

describe('other sources of the classes', () => {
  it('takes time in zone: zones 2-3 moderate, 4-5 vigorous, 5 peak', () => {
    expect(classifyByZoneSeconds([100, 600, 300, 1200, 400])).toEqual({ moderateS: 900, vigorousS: 1600, peakS: 400 });
  });
  it('takes the whole duration in the class of the average heart rate zone', () => {
    expect(classifyByAvgHr(3600, 150, 200)).toEqual({ moderateS: 3600, vigorousS: 0, peakS: 0 });
    expect(classifyByAvgHr(3600, 172, 200)).toEqual({ moderateS: 0, vigorousS: 3600, peakS: 0 });
    expect(classifyByAvgHr(3600, 190, 200)).toEqual({ moderateS: 0, vigorousS: 3600, peakS: 3600 });
    expect(classifyByAvgHr(3600, 100, 200)).toEqual({ moderateS: 0, vigorousS: 0, peakS: 0 });
  });
  it('falls back to moderate without an average heart rate or a maximum', () => {
    expect(classifyByAvgHr(1800, null, 200)).toEqual(noData(1800));
    expect(classifyByAvgHr(1800, 150, null)).toEqual(noData(1800));
  });
  it('takes intensity minutes of the watch', () => {
    expect(classifyByIntensityMinutes(20, 10)).toEqual({ moderateS: 1200, vigorousS: 600, peakS: 0 });
  });
  it('adds classes', () => {
    expect(sumClasses([{ moderateS: 1, vigorousS: 2, peakS: 3 }, { moderateS: 4, vigorousS: 5, peakS: 6 }])).toEqual({ moderateS: 5, vigorousS: 7, peakS: 9 });
  });
});

describe('isHardSession', () => {
  it('is hard with 20 vigorous minutes or 5 peak minutes', () => {
    expect(isHardSession({ moderateS: 0, vigorousS: 1200, peakS: 0 })).toBe(true);
    expect(isHardSession({ moderateS: 0, vigorousS: 1199, peakS: 0 })).toBe(false);
    expect(isHardSession({ moderateS: 0, vigorousS: 300, peakS: 300 })).toBe(true);
    expect(isHardSession({ moderateS: 3600, vigorousS: 0, peakS: 0 })).toBe(false);
  });
});
