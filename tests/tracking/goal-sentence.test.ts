import { goalSentence } from '../../src/tracking/ui/GoalRules';

test('the goal is one sentence, the focus groups joined with "und"', () => {
  expect(goalSentence({ strength: 'muscle', focus: [] })).toBe('Du baust Muskeln auf.');
  expect(goalSentence({ strength: 'strength', focus: ['chest'] })).toMatch(/^Du wirst stärker, vor allem \S+\.$/);
  expect(goalSentence({ strength: 'muscle', focus: ['back', 'chest'] })).toBe('Du baust Muskeln auf, vor allem Rücken und Brust.');
});
