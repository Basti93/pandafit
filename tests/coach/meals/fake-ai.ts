import type { TagAsk } from '../../../src/coach/meals/recipe-tags';

type Item = { id: string; title: string; ingredients: string[]; steps: string[]; category: string[]; keywords: string[]; zutatenzeilen?: string[]; vegHint?: string };
export type Answer = { id: string; mahlzeit: string[]; art: string | null; kueche: string | null; eiweiss: string | null; eigenschaft: string[]; vegetarisch: boolean; grund: string };

/** The recipes of a tagging prompt, read back out of its data block. */
export const itemsOf = (prompt: string): Item[] => {
  const m = /<rezepte-nur-daten>\n([\s\S]*?)\n<\/rezepte-nur-daten>/.exec(prompt);
  return m ? (JSON.parse(m[1]!) as Item[]) : [];
};

/** A fake AI client for the tagging calls: `decide` gives the answer for one recipe (default: a vegetarian lunch/dinner pan dish with legumes). */
export const taggingAi = (decide: (i: Item) => Partial<Answer> = () => ({})): TagAsk & { calls: number; batches: number[] } => {
  const fn = (async (input: { prompt: string; systemPrompt?: string; schema?: object }) => {
    fn.calls++;
    const items = itemsOf(input.prompt);
    fn.batches.push(items.length);
    return { rezepte: items.map((i) => ({ id: i.id, mahlzeit: ['mittag', 'abend'], art: 'curry-eintopf', kueche: null, eiweiss: 'huelsenfruechte', eigenschaft: [], vegetarisch: true, grund: 'pflanzlich', ...decide(i) })) };
  }) as unknown as TagAsk & { calls: number; batches: number[] };
  fn.calls = 0;
  fn.batches = [];
  return fn;
};
