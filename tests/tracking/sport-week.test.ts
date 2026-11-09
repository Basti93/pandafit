import { describe, expect, it } from 'vitest';
import { sportWeekLabel, sportWeekOf, sportWeekText } from '../../src/tracking/ui/sport-week';

const [MO, DI, MI, DO, FR, SA] = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'] as [string, string, string, string, string, string];

describe('sport week', () => {
  it('counts done days and marks today and later plan days', () => {
    const w = sportWeekOf({ done: [MO], planned: [MO, DO, SA], today: DO });
    expect(w.marks).toEqual(['done', 'now', 'open']);
    expect(w.next).toBe(DO);
  });
  it('says the week in words for each sport', () => {
    expect(sportWeekText('kraft', sportWeekOf({ done: [MO], planned: [MO, FR], today: MI }), MI)).toBe('Ein Krafttraining hast du geschafft. Das nächste kommt am Freitag.');
    expect(sportWeekText('rad', sportWeekOf({ done: [], planned: [MI], today: MI }), MI)).toBe('Diese Woche ist noch keine Fahrt erledigt. Heute ist eine Fahrt dran.');
    expect(sportWeekText('lauf', sportWeekOf({ done: [MO, MI], planned: [MO, MI], today: DO }), DO)).toBe('Zwei Läufe hast du geschafft. Damit ist alles geschafft, was geplant war.');
  });
  it('without a plan there are only done dots and no "von"', () => {
    const w = sportWeekOf({ done: [MO], planned: null, today: MI });
    expect(w.marks).toEqual(['done']);
    expect(sportWeekLabel('kraft', w)).toBe('1 geschafft');
    expect(sportWeekText('kraft', w, MI)).toBe('Ein Krafttraining hast du geschafft.');
  });
  it('a missed day before today is not a dot', () => {
    expect(sportWeekOf({ done: [], planned: [MO, FR], today: MI }).marks).toEqual(['open']);
  });
  it('labels with plan and plural', () => {
    expect(sportWeekLabel('kraft', sportWeekOf({ done: [MO], planned: [MO, FR], today: MI }))).toBe('1 von 2 Krafttrainings');
    expect(sportWeekLabel('rad', sportWeekOf({ done: [MO], planned: [MO, FR], today: MI }))).toBe('1 von 2 Fahrten');
    expect(sportWeekLabel('lauf', sportWeekOf({ done: [MO], planned: [MO, FR], today: MI }))).toBe('1 von 2 Läufen');
  });
  it('a plan without a day of this sport is no plan', () => {
    const w = sportWeekOf({ done: [], planned: [], today: MI });
    expect(w.planned).toBeNull();
    expect(sportWeekText('kraft', w, MI)).toBe('Diese Woche ist noch kein Krafttraining erledigt.');
    expect(sportWeekLabel('kraft', w)).toBe('0 geschafft');
  });
  it('"alles geschafft" needs every planned day done; an extra session does not replace one', () => {
    const w = sportWeekOf({ done: [DI, MI], planned: [MO, MI], today: DO });
    expect(sportWeekText('kraft', w, DO)).toBe('Zwei Krafttrainings hast du geschafft.');
    expect(sportWeekLabel('kraft', w)).toBe('1 von 2 Krafttrainings');
  });
  it('a missed day with a later planned day names the next one', () => {
    const w = sportWeekOf({ done: [], planned: [MO, FR], today: MI });
    expect(sportWeekText('kraft', w, MI)).toBe('Diese Woche ist noch kein Krafttraining erledigt. Das nächste kommt am Freitag.');
  });
});
