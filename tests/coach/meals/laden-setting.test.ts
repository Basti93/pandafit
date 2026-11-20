import { describe, expect, it } from 'vitest';
import { cleanSettings } from '../../../src/coach/meals/meal-coach';
import { DEFAULT_MEAL_SETTINGS, householdStore, STORES } from '../../../src/shared/meals';

describe('Einkaufsort der Haushalts-Einstellungen', () => {
  it('kennt drei Orte und Supermarkt als Vorgabe', () => {
    expect(STORES).toEqual(['discounter', 'supermarkt', 'bioladen']);
    expect(DEFAULT_MEAL_SETTINGS.store).toBe('supermarkt');
  });
  it('liest alte Einstellungen ohne Ort als Supermarkt', () => {
    expect(cleanSettings({ on: true, diet: 'vegan' }).store).toBe('supermarkt');
    expect(cleanSettings(undefined).store).toBe('supermarkt');
    expect(cleanSettings({ on: true, store: 'unsinn' }).store).toBe('supermarkt');
  });
  it('behält einen gültigen Ort', () => {
    expect(cleanSettings({ on: true, store: 'discounter' }).store).toBe('discounter');
    expect(cleanSettings({ on: true, store: 'bioladen' }).store).toBe('bioladen');
  });
  it('der Haushalt nimmt den Discounter, sobald jemand ihn wählt', () => {
    const s = (store?: 'discounter' | 'bioladen' | 'supermarkt') => ({ ...DEFAULT_MEAL_SETTINGS, ...(store ? { store } : {}) });
    expect(householdStore([s(), s('discounter')])).toBe('discounter');
    expect(householdStore([s('bioladen'), s()])).toBe('bioladen');
    expect(householdStore([{ ...DEFAULT_MEAL_SETTINGS }, {}])).toBe('supermarkt');
    expect(householdStore([])).toBe('supermarkt');
  });
});
