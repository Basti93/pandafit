import { describe, expect, it } from 'vitest';
import { RECIPES } from '../../../src/coach/meals/recipes';
import { pickRecipe, ruleMeals, stockHits, stockSet, type Member } from '../../../src/coach/meals/rules';
import { DEFAULT_MEAL_SETTINGS } from '../../../src/shared/meals';

const member: Member = { id: 'max', settings: { ...DEFAULT_MEAL_SETTINGS, on: true } };
const base = { slot: 'abend' as const, eaters: [member], takeAlong: false, training: false, keepDays: 0, used: new Set<string>(), random: () => 0.5 };

describe('stock in the rule plan', () => {
  it('pickRecipe prefers a recipe with a stock ingredient', () => {
    const plain = pickRecipe(base)!;
    const other = RECIPES.find((r) => r.slots.includes('abend') && r.id !== plain.id && r.ingredients.some((i) => !plain.ingredients.some((p) => p.name === i.name)))!;
    const name = other.ingredients.find((i) => !plain.ingredients.some((p) => p.name === i.name))!.name;
    const stock = stockSet([name]);
    const picked = pickRecipe({ ...base, stock })!;
    expect(stockHits(picked.ingredients, stock)).toBeGreaterThan(0);
    expect(stockHits(plain.ingredients, stock)).toBe(0);
  });

  it('ruleMeals passes the stock on', () => {
    const plain = ruleMeals([member], [{ day: 2, slot: 'abend', eaters: ['max'], takeAlong: false, reuseOf: null }], [], () => 0.5);
    const name = RECIPES.find((r) => r.slots.includes('abend') && r.id !== plain[0]!.dish.recipeId)!.ingredients.find((i) => !plain[0]!.dish.ingredients.some((p) => p.name === i.name))!.name;
    const stock = stockSet([name]);
    const meals = ruleMeals([member], [{ day: 2, slot: 'abend', eaters: ['max'], takeAlong: false, reuseOf: null }], [], () => 0.5, new Set(), stock);
    expect(stockHits(meals[0]!.dish.ingredients, stock)).toBeGreaterThan(0);
  });
});
