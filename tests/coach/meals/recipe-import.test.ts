import { describe, expect, it, vi } from 'vitest';
import { estimateProtein, importRecipe, isoMinutes, meatWord, notVegetarian, parseIngredientLine, parseInstructions, parseYield, sectionOf } from '../../../src/coach/meals/recipe-import';

const lineOf = (s: string) => { const p = parseIngredientLine(s); return p.ok ? p.ingredients.map((i) => `${i.amount} ${i.unit} ${i.name}`) : null; };

describe('schema.org instructions and durations', () => {
  it('reads a string, steps, sections and a mix', () => {
    expect(parseInstructions('Erst rühren.\nDann backen.')).toEqual(['Erst rühren.', 'Dann backen.']);
    expect(parseInstructions([{ '@type': 'HowToStep', text: 'Eins &amp; zwei' }, { '@type': 'HowToStep', name: 'Drei' }])).toEqual(['Eins & zwei', 'Drei']);
    expect(parseInstructions([{ '@type': 'HowToSection', name: 'Teig', itemListElement: [{ text: 'A' }, { text: 'B' }] }, 'C'])).toEqual(['A', 'B', 'C']);
    expect(parseInstructions('<p>Erster</p><p>Zweiter</p>')).toEqual(['Erster', 'Zweiter']);
    expect(parseInstructions(undefined)).toEqual([]);
  });
  it('splits one long block into steps of bounded length', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Satz Nummer ${i} steht hier.`).join(' ');
    const steps = parseInstructions(long);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.every((s) => s.length <= 400)).toBe(true);
  });
  it('reads ISO 8601 durations', () => {
    expect(isoMinutes('PT1H30M')).toBe(90);
    expect(isoMinutes('PT45M')).toBe(45);
    expect(isoMinutes('P0DT2H')).toBe(120);
    expect(isoMinutes('PT90M')).toBe(90);
    expect(isoMinutes('P1D')).toBe(1440);
    expect(isoMinutes('soon')).toBeNull();
    expect(isoMinutes('PT')).toBeNull();
    expect(isoMinutes(5)).toBeNull();
  });
  it('reads the yield in its shapes', () => {
    expect(parseYield(4)).toBe(4);
    expect(parseYield('4 Portionen')).toBe(4);
    expect(parseYield(['6', '6 Stück'])).toBe(6);
    expect(parseYield('4-6')).toBe(4);
    expect(parseYield('viele')).toBeNull();
    expect(parseYield(0)).toBeNull();
  });
});

describe('the vegetarian check', () => {
  it.each(['Hähnchenbrustfilet', 'Speckwürfel', 'Fischsauce', 'Hackfleisch', 'Rinderhack', 'Lachsfilet', 'Thunfisch aus der Dose', 'Garnelen', 'Sardellen', 'Gelatine', 'Blattgelatine', 'Brühe vom Rind', 'Hühnerbrühe', 'Schinkenwürfel', 'Bratwurst', 'Würstchen', 'Putenbrust', 'Entenbrust', 'Kalbsleber', 'Leberkäse', 'Worcestersauce', 'Austernsauce', 'Schweineschmalz', '200 g Bacon', 'chicken breast', 'Lammkeule', 'Zitronenhähnchen', 'Gänsebrust'])(
    'rejects %s', (t) => { expect(meatWord(t)).not.toBeNull(); });
  it.each(['vegetarischer Speck', 'Sojahack', 'Soja-Hack', 'veganer Schinken', 'veggie Wurst', 'Gemüsebrühe', 'Hühnereier', 'Fleischtomaten', 'Zitronenrinde', 'Orangenschale', 'gehackte Tomaten', 'Austernpilze', 'Frischkäse', 'Champignons', 'Haselnüsse', 'Spinat, Hafer', 'Räuchertofu', 'Kichererbsen', 'Pflanzliches Hack', 'Pasta ohne Fleisch', 'Wildkräuter', 'Studentenfutter', 'Mehl, Eier', 'Fleischersatz', 'Blumenkohlsteak', 'Zwiebeln fein hacken', 'Mango-Fruchtfleisch', 'veganes Hack', 'vegane Fischsauce', 'Bärlauch-Flammkuchen', 'Fleischtomate', 'pork_free, diet_vegetarian'])(
    'lets %s pass', (t) => { expect(meatWord(t)).toBeNull(); });
  it('does not let a plant word in another part of the line clear meat', () => {
    expect(meatWord('Erbsen, Schinkenwürfel')).not.toBeNull();
    expect(meatWord('Linsen mit Speck')).not.toBeNull();
  });
  it('still rejects a meat keyword', () => { expect(meatWord('main_ingredient_pork')).not.toBeNull(); });
  it('ignores the steps: their verbs are no ingredients', () => {
    expect(notVegetarian({ title: 'Linsen-Dal', ingredients: ['1 Zwiebel', '200 g Linsen'], steps: ['Die Zwiebel fein hacken.'], extra: [] })).toBeNull();
  });
});

describe('ingredient lines', () => {
  it('reads amounts, units, fractions and ranges', () => {
    expect(lineOf('200 g Mehl')).toEqual(['200 g Mehl']);
    expect(lineOf('1 EL Öl')).toEqual(['1 EL Öl']);
    expect(lineOf('1 ½ EL Honig')).toEqual(['1.5 EL Honig']);
    expect(lineOf('½ Bund Petersilie')).toEqual(['0.5 Bund Petersilie']);
    expect(lineOf('2-3 Zwiebeln')).toEqual(['2.5 Stk Zwiebeln']);
    expect(lineOf('2 bis 3 Zwiebeln')).toEqual(['2.5 Stk Zwiebeln']);
    expect(lineOf('1,5 kg Kartoffeln')).toEqual(['1500 g Kartoffeln']);
    expect(lineOf('0,5 l Milch')).toEqual(['500 ml Milch']);
    expect(lineOf('1/2 TL Zimt')).toEqual(['0.5 TL Zimt']);
    expect(lineOf('1 Prise Salz')).toEqual(['1 Prise Salz']);
    expect(lineOf('3 Knoblauchzehen')).toEqual(['3 Stk Knoblauchzehen']);
    expect(lineOf('2 Zehen Knoblauch')).toEqual(['2 Zehe Knoblauch']);
  });
  it('drops brackets and the preparation after a comma', () => {
    expect(lineOf('1 Dose (400 g) Tomaten')).toEqual(['1 Dose Tomaten']);
    expect(lineOf('2 Zwiebeln, fein gewürfelt')).toEqual(['2 Stk Zwiebeln']);
    expect(lineOf('100 g Käse (z. B. Gouda)')).toEqual(['100 g Käse']);
  });
  it('reads salt and pepper without amount as pinches', () => {
    expect(lineOf('Salz, Pfeffer')).toEqual(['1 Prise Salz', '1 Prise Pfeffer']);
    expect(lineOf('Salz und Pfeffer')).toEqual(['1 Prise Salz', '1 Prise Pfeffer']);
    expect(lineOf('Salz')).toEqual(['1 Prise Salz']);
  });
  it('leaves the unclear unclear', () => {
    expect(lineOf('nach Belieben dekorieren')).toBeNull();
    expect(lineOf('')).toBeNull();
    expect(lineOf('Für die Soße:')).toBeNull();
  });
  it('puts ingredients in the supermarket section', () => {
    expect(sectionOf('Zwiebeln')).toBe('Obst und Gemüse');
    expect(sectionOf('Naturjoghurt')).toBe('Kühlregal');
    expect(sectionOf('Eier')).toBe('Kühlregal');
    expect(sectionOf('Eisbergsalat')).toBe('Obst und Gemüse');
    expect(sectionOf('Tomatenmark')).toBe('Vorrat');
    expect(sectionOf('Kokosmilch')).toBe('Vorrat');
    expect(sectionOf('Olivenöl')).toBe('Vorrat');
    expect(sectionOf('Vollkornbrot')).toBe('Brot und Backwaren');
    expect(sectionOf('TK-Erbsen')).toBe('Tiefkühl');
    expect(sectionOf('Drachenfrucht')).toBe('Sonstiges');
  });
});

const base = (over: Record<string, unknown> = {}) => ({
  '@type': 'Recipe', name: 'Linsen-Gemüse-Topf', recipeYield: '4 Portionen', totalTime: 'PT40M',
  recipeIngredient: ['300 g rote Linsen', '2 Zwiebeln', '1 Dose (400 g) Tomaten', '2 EL Olivenöl', '400 ml Gemüsebrühe', 'Salz, Pfeffer'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Zwiebeln anschwitzen.' }, { '@type': 'HowToStep', text: 'Alles köcheln lassen.' }],
  recipeCategory: 'Hauptgericht', keywords: 'vegetarisch, einfach', ...over,
});

describe('the whole import', () => {
  it('turns a recipe into one per portion with derived values', async () => {
    const r = await importRecipe(base());
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const lentils = r.recipe.ingredients.find((i) => i.name === 'Rote Linsen')!;
    expect(lentils).toMatchObject({ amount: 75, unit: 'g', section: 'Vorrat' });
    expect(r.recipe.ingredients.find((i) => i.name === 'Zwiebeln')).toMatchObject({ amount: 0.5, unit: 'Stk', section: 'Obst und Gemüse' });
    expect(r.recipe).toMatchObject({ title: 'Linsen-Gemüse-Topf', minutes: 40, slots: [], keepsDays: 2, vegan: true });
    expect(r.recipe.steps).toHaveLength(2);
    expect(r.recipe.proteinG).toBeGreaterThan(10);
  });
  it('uses the stated protein, and an unknown one stays unknown', async () => {
    const a = await importRecipe(base({ nutrition: { proteinContent: '17,5 g' } }));
    expect(a.status === 'ok' && a.recipe.proteinG).toBe(18);
    const b = await importRecipe(base({ recipeIngredient: ['300 g Lupinenschrot', '200 g Dinkelgrieß', '150 g Quittenmus', '2 Zwiebeln'] }));
    expect(b.status === 'ok' && b.recipe.proteinG).toBe(-1);
  });
  it('derives the keeping time, the canonical ingredients and the quality; the tags wait for the AI', async () => {
    const salad = await importRecipe(base({ name: 'Bunter Bohnensalat' }));
    expect(salad.status === 'ok' && salad.recipe.keepsDays).toBe(0);
    const r = await importRecipe(base({ keywords: 'vegetarisch, einfach', recipeIngredient: ['2 Paradeiser', '1 Dose Kichererbsen', '1 Zwiebel', '1 EL Öl'] }));
    expect(r.status === 'ok' && r.recipe).toMatchObject({ slots: [], tags: null, parseQuality: 1, deriveVersion: 1, category: ['Hauptgericht'], keywords: ['vegetarisch', 'einfach'] });
    expect(r.status === 'ok' && r.recipe.canon).toEqual(['tomate', 'kichererbse', 'zwiebel', 'oel']);
  });
  it('stores rating and count when there are some, and ignores rubbish', async () => {
    const r = await importRecipe(base({ aggregateRating: { '@type': 'AggregateRating', ratingValue: '4,6', ratingCount: 123 }, suitableForDiet: 'https://schema.org/VegetarianDiet' }));
    expect(r.status === 'ok' && r.recipe.rating).toEqual({ value: 4.6, count: 123 });
    const bad = await importRecipe(base({ aggregateRating: { ratingValue: 'viel' } }));
    expect(bad.status === 'ok' && bad.recipe.rating).toBeUndefined();
  });
  it('rejects meat in the title, an ingredient or a keyword, not because of a step', async () => {
    expect((await importRecipe(base({ recipeIngredient: ['200 g Speckwürfel', '1 Zwiebel'] }))).status).toBe('rejected');
    expect((await importRecipe(base({ name: 'Hähnchen-Topf' }))).status).toBe('rejected');
    expect((await importRecipe(base({ recipeInstructions: ['Die Zwiebel fein hacken.'] }))).status).toBe('ok');
    expect((await importRecipe(base({ keywords: 'Fleisch, schnell' }))).status).toBe('rejected');
  });
  it('fails what is incomplete', async () => {
    expect((await importRecipe(null)).status).toBe('failed');
    expect((await importRecipe(base({ name: '' }))).status).toBe('failed');
    expect((await importRecipe(base({ recipeIngredient: [] }))).status).toBe('failed');
    expect((await importRecipe(base({ recipeInstructions: [] }))).status).toBe('failed');
    expect((await importRecipe(base({ recipeYield: undefined }))).status).toBe('failed');
  });
  it('merges the same ingredient twice', async () => {
    const r = await importRecipe(base({ recipeIngredient: ['100 g Mehl', '100 g Mehl', '1 Zwiebel'] }));
    expect(r.status === 'ok' && r.recipe.ingredients.find((i) => i.name === 'Mehl')?.amount).toBe(50);
  });
});

describe('unclear lines and the AI', () => {
  const unclear = base({ recipeIngredient: ['Eine Schüssel voll Tomaten', 'ein paar Kräuter', 'nach Lust Gemüse', '200 g Nudeln'] });
  it('stays pending without an AI', async () => {
    expect((await importRecipe(unclear)).status).toBe('pending');
  });
  it('lets the AI structure the lines and checks its answer', async () => {
    const ask = vi.fn(async () => ({ zutaten: [
      { name: 'Tomaten', menge: 500, einheit: 'g', abteilung: 'Obst und Gemüse', roh: false }, { name: 'Kräuter', menge: 1, einheit: 'Bund', abteilung: 'Obst und Gemüse', roh: true },
      { name: 'Gemüse', menge: 400, einheit: 'g', abteilung: 'Obst und Gemüse', roh: false }, { name: 'Nudeln', menge: 200, einheit: 'g', abteilung: 'Vorrat', roh: false }] }));
    const r = await importRecipe(unclear, { ask });
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.recipe.ingredients.find((i) => i.name === 'Tomaten')?.amount).toBe(125);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(String((ask.mock.calls[0] as unknown[])[0] && ((ask.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt))).toContain('nur-daten');
  });
  it('stays pending when the AI answers wrongly or fails', async () => {
    expect((await importRecipe(unclear, { ask: async () => ({ zutaten: [] }) })).status).toBe('pending');
    expect((await importRecipe(unclear, { ask: async () => { throw new Error('down'); } })).status).toBe('pending');
    expect((await importRecipe(unclear, { ask: async () => ({ zutaten: [{ name: '', menge: 1, einheit: 'g', abteilung: 'Vorrat', roh: false }, { name: 'a', menge: 1, einheit: 'g', abteilung: 'Vorrat', roh: false }, { name: 'a', menge: 1, einheit: 'g', abteilung: 'Vorrat', roh: false }, { name: 'a', menge: 1, einheit: 'g', abteilung: 'Vorrat', roh: false }] }) })).status).toBe('pending');
  });
  it('does not ask the AI when few lines are unclear', async () => {
    const ask = vi.fn();
    const r = await importRecipe(base({ recipeIngredient: [...(base().recipeIngredient as string[]), 'irgendwas dazu'] }), { ask });
    expect(r.status).toBe('ok');
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('protein estimate', () => {
  it('adds the known and is unsure when a heavy ingredient is unknown', () => {
    const ing = (name: string, amount: number, unit: 'g' | 'Stk' | 'EL') => ({ name, amount, unit, section: 'Vorrat' as const });
    expect(estimateProtein([ing('Tofu natur', 150, 'g'), ing('Olivenöl', 1, 'EL')])).toBe(21);
    expect(estimateProtein([ing('Eier', 3, 'Stk')])).toBe(21);
    expect(estimateProtein([ing('Mandelmilch', 200, 'g')])).toBe(7);
    expect(estimateProtein([ing('Tofu natur', 100, 'g'), ing('Quittenmus', 200, 'g')])).toBeNull();
  });
});
