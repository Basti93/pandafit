import { useState } from 'react';
import { initialOf, mealKey, recipeAmount, eatersOf, sideText, type Ingredient, type Meal, type Side } from '../../shared/meals';
import { Card, Kicker, Sheet } from '../../tracking/ui/kit';
import { eatersLine, eaterNames, type Week } from './meals-view';

/** The ingredients for `portions`; with `onPortions` the stepper (1 to 4), without it the fixed count. */
export function IngredientsCard({ portions, onPortions, ingredients, side }: { portions: number; onPortions?: (n: number) => void; ingredients: Ingredient[]; side?: Side }) {
  return (
    <Card label="Zutaten">
      <Kicker>Zutaten</Kicker>
      {onPortions ? (
        <div className="rc-portions" role="group" aria-label="Portionen">
          <button type="button" className="tk-step-btn" aria-label="Eine Portion weniger" disabled={portions <= 1} onClick={() => onPortions(portions - 1)}>−</button>
          <span aria-live="polite">{portions} {portions === 1 ? 'Portion' : 'Portionen'}</span>
          <button type="button" className="tk-step-btn" aria-label="Eine Portion mehr" disabled={portions >= 4} onClick={() => onPortions(portions + 1)}>+</button>
        </div>
      ) : <p className="muted">Für {portions} {portions === 1 ? 'Portion' : 'Portionen'}</p>}
      <ul className="pm-ingredients">{ingredients.map((i, n) => <li key={n}><b>{recipeAmount(i, portions)}</b> {i.name}</li>)}</ul>
      {side && <p className="pm-side">Dazu: {sideText(side)} <span className="muted">(je Portion)</span></p>}
    </Card>
  );
}

export function StepsCard({ steps }: { steps: string[] }) {
  return (
    <Card label="So geht's">
      <Kicker>So geht's</Kicker>
      <ol className="pm-steps">{steps.map((s, n) => <li key={n}>{s}</li>)}</ol>
    </Card>
  );
}

/** "Max und Lena essen mit" as a quiet button; it opens the switches. A day that is over shows only the sentence. */
export function EatersButton({ week, meal, me, onEater, past = false }: { week: Week; meal: Meal; me?: string; onEater: (person: string, on: boolean) => void; /** The day is over: who ate is shown, not changed. */ past?: boolean }) {
  const [open, setOpen] = useState(false);
  const sentence = eatersLine(eaterNames(week, meal));
  if (past) return <p className="muted">{sentence}</p>;
  const eaters = eatersOf(week.plan, week.state, mealKey(meal.day, meal.slot));
  const colour = (id: string) => Math.max(0, week.plan.people.findIndex((p) => p.id === id)) % 4;
  // The reader comes first among the people.
  const isMe = (p: { name: string }) => !!me && p.name.trim().toLowerCase() === me.trim().toLowerCase();
  const people = [...week.plan.people].sort((x, y) => Number(isMe(y)) - Number(isMe(x)));
  return (
    <>
      <button type="button" className="secondary tk-eaters" onClick={() => setOpen(true)}>
        <span className="tk-eaters-dots" aria-hidden="true">
          {week.plan.people.filter((p) => eaters.includes(p.id)).map((p) => <span key={p.id} className={`tk-eaters-dot pc${colour(p.id)}`}>{initialOf(p)}</span>)}
        </span>
        {sentence}
      </button>
      {open && (
        <Sheet title="Wer isst mit?" size="small" onClose={() => setOpen(false)}>
          <div className="tk-chips" role="group" aria-label="Wer isst mit">
            {people.map((p) => {
              const on = eaters.includes(p.id);
              return <button key={p.id} type="button" aria-pressed={on} aria-label={`${p.name} isst ${on ? 'mit' : 'nicht mit'}`} onClick={() => onEater(p.id, !on)}>{p.name}</button>;
            })}
          </div>
        </Sheet>
      )}
    </>
  );
}
