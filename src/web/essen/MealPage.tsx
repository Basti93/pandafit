import { useState } from 'react';
import { cookPortions, dateOf, mealKey, withEater } from '../../shared/meals';
import { localDayKey } from '../../shared/dates';
import { Card, HeadCard, Kicker } from '../../tracking/ui/kit';
import type { MealData } from '../MealsScreen';
import { RecipeView } from '../RecipesScreen';
import { EssenPage } from './EssenPage';
import { MealImage } from './MealImage';
import { askedSentence, mealPageKicker, NOBODY_EATS, mealSentence, type MealAt } from './meals-view';
import { EatersButton, IngredientsCard, StepsCard } from './RecipeParts';

/** One meal of the plan as a page: picture, when and what, who eats, ingredients and steps. */
export function MealPage({ data, at, me, backLabel, onBack }: { data: MealData; at: MealAt; me?: string; backLabel: 'Essen' | 'Heute'; onBack: () => void }) {
  const [recipeOpen, setRecipeOpen] = useState(false);
  const back = { label: backLabel, onClick: onBack };
  // Without the records there is nothing to say yet; the frame alone, so Back works.
  if (data.records === null) return <EssenPage back={back}><div className="tk-screen" /></EssenPage>;
  const week = data.weeks.find((w) => w.plan.week === at.week);
  const meal = week?.plan.meals.find((m) => mealKey(m.day, m.slot) === at.meal);
  if (!week || !meal) {
    return <EssenPage back={back}><div className="tk-screen"><Card><p>Diese Mahlzeit steht nicht mehr im Plan.</p></Card></div></EssenPage>;
  }
  const { dish } = meal;
  const nowMs = data.recipeCtx.now();
  const past = localDayKey(dateOf(week.plan.week, meal.day).getTime()) < localDayKey(nowMs);
  const cook = cookPortions(week.plan, week.state, at.meal);
  const asked = askedSentence(week, meal);
  const source = !dish.recipeId && dish.source === 'rezept' ? dish.sourceUrl : undefined;
  return (
    <EssenPage back={back}>
      <div className="tk-screen">
        <HeadCard picture={<MealImage recipeId={dish.recipeId} slot={meal.slot} size="big" />} kicker={mealPageKicker(week, meal, nowMs)} title={dish.title} text={mealSentence(week, meal)}>
          {asked && <p className="muted">{asked}</p>}
          <EatersButton week={week} meal={meal} me={me} past={past} onEater={(person, on) => void data.change(week.plan.week, (s, t) => withEater(s, at.meal, person, on, t))} />
        </HeadCard>
        {meal.reuseOf ? (
          <Card><p>Das ist schon gekocht. Pack es einfach ein.</p></Card>
        ) : (
          <>
            {cook.total > 0
              ? <IngredientsCard portions={cook.total} ingredients={dish.ingredients} side={dish.side} />
              : <Card label="Zutaten"><Kicker>Zutaten</Kicker><p>{NOBODY_EATS}</p></Card>}
            <StepsCard steps={dish.steps} />
          </>
        )}
        {(dish.recipeId || source) && (
          <Card soft label="Mehr">
            <Kicker>Mehr</Kicker>
            {dish.recipeId
              ? <button type="button" className="secondary" onClick={() => setRecipeOpen(true)}>Ganzes Rezept ansehen</button>
              : <a className="secondary" href={source} target="_blank" rel="noopener noreferrer">Originalrezept öffnen</a>}
          </Card>
        )}
        {recipeOpen && dish.recipeId && <RecipeView ctx={data.recipeCtx} id={dish.recipeId} onClose={() => setRecipeOpen(false)} />}
      </div>
    </EssenPage>
  );
}
