import { expect, it } from 'vitest';
import { reasonPhrase } from '../../../src/coach/gym/guardrails';

it('turns guardrail reasons into short plain German', () => {
  expect(reasonPhrase('mehr als 30 Sätze')).toBe('zu viele Sätze');
  expect(reasonPhrase('Bank: Gewicht zu hoch')).toBe('ein Gewicht, das noch nicht dran ist');
  expect(reasonPhrase('Die Antwort passte nicht zum Schema.')).toBe('die Antwort war nicht lesbar');
  expect(reasonPhrase('etwas ganz Neues')).toBe('eine Angabe außerhalb der Grenzen');
});

it('nennt die abgelehnte Härte in einem eigenen Satz', () => {
  expect(reasonPhrase('Versagen passt nicht zur Härte')).toBe('Sätze bis zum Versagen, obwohl du vorsichtig trainierst');
});

it('nennt die Gründe des Abschnitts in eigenen Worten', () => {
  expect(reasonPhrase('Kernübung fehlt')).toBe('eine Kernübung des Abschnitts fehlt');
  expect(reasonPhrase('zu viel für die leichte Woche')).toBe('mehr, als die leichte Woche tragen soll');
});
