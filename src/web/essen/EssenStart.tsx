import { useState } from 'react';
import { dayIndex, mealKey, SLOTS, weekOf, withEater, type Meal } from '../../shared/meals';
import { BO_LINES } from '../../tracking/ui/bo';
import { BoBubble, Card, HeadCard, Kicker, MainCard, RowCard, Sheet } from '../../tracking/ui/kit';
import type { MealData } from '../MealsScreen';
import { MealImage } from './MealImage';
import {
  favSentence, headKicker, headSentence, mealKicker, mealSentence, NEXT_PLAN, nextMeal, nextWeekRows, openCount, openSentence, pastSentence,
  restOfWeek, rowSentence, shoppingWeek, slotKicker, todayMeals, type DayRow, type MealAt,
} from './meals-view';
import { EatersButton } from './RecipeParts';

/** A calm card of days: one row card per day, a tap opens the day's sheet. */
function DaysCard({ label, rows, onDay }: { label: string; rows: DayRow[]; onDay: (row: DayRow) => void }) {
  if (rows.length === 0) return null;
  return (
    <Card soft label={label}>
      <Kicker>{label}</Kicker>
      <div className="tk-rowcards">
        {rows.map((r) => r.meal
          ? <RowCard key={`${r.week.plan.week}-${r.day}`} lead={r.lead} picture={<MealImage recipeId={r.meal.dish.recipeId} slot={r.meal.slot} />} title={r.meal.dish.title} sub={rowSentence(r.week, r.meal)} onClick={() => onDay(r)} />
          : <RowCard key={`${r.week.plan.week}-${r.day}`} lead={r.lead} icon="essen" title="Nichts geplant" end="none" />)}
      </div>
    </Card>
  );
}

/** The start page of Essen: the next meal large, the rest of today small, the week calm, the tiles and Bo. */
export function EssenStart({ data, nowMs, me, onMeal, onShopping, onRecipes, onChat }: { data: MealData; nowMs: number; me?: string; onMeal: (at: MealAt) => void; onShopping: () => void; onRecipes: () => void; onChat: () => void }) {
  const [day, setDay] = useState<DayRow | null>(null);
  const { weeks } = data;
  const recipes = <RowCard icon="rezepte" title="Rezepte" sub={favSentence(data.favs.size)} onClick={onRecipes} />;
  if (weeks.length === 0) {
    return (
      <div className="tk-screen">
        <HeadCard title="Essen" text={`Noch gibt es keinen Essensplan. ${NEXT_PLAN}`} />
        <div className="tk-tiles">{recipes}</div>
      </div>
    );
  }
  const today = todayMeals(weeks, nowMs);
  const next = nextMeal(weeks, nowMs);
  const current = weeks.find((w) => w.plan.week === weekOf(nowMs));
  const trainingDay = !!current?.plan.trainingDays.includes(dayIndex(nowMs));
  const shopping = shoppingWeek(weeks, nowMs);
  const open = (w: { plan: { week: string } }, m: Meal) => onMeal({ week: w.plan.week, meal: mealKey(m.day, m.slot) });
  const rest = today.filter((t) => !(next?.when === 'heute' && t.week === next.week && t.meal === next.meal));
  const dayMeals = day ? [...day.week.plan.meals.filter((m) => m.day === day.day)].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot)) : [];
  return (
    <div className="tk-screen">
      <HeadCard kicker={headKicker(nowMs, trainingDay)} title="Essen" text={headSentence(today, next)} />
      {next && (
        <MainCard
          label="Nächste Mahlzeit"
          picture={<MealImage recipeId={next.meal.dish.recipeId} slot={next.meal.slot} size="big" />}
          kicker={mealKicker(next)}
          title={next.meal.dish.title}
          text={mealSentence(next.week, next.meal)}
          middle={<EatersButton week={next.week} meal={next.meal} me={me} onEater={(person, on) => void data.change(next.week.plan.week, (s, t) => withEater(s, mealKey(next.meal.day, next.meal.slot), person, on, t))} />}
          primary={{ label: 'Rezept ansehen', onClick: () => open(next.week, next.meal) }}
        />
      )}
      {rest.length > 0 && (
        <div className="tk-rowcards">
          {rest.map((t) => (
            <RowCard key={t.meal.slot} picture={<MealImage recipeId={t.meal.dish.recipeId} slot={t.meal.slot} />} kicker={slotKicker(t.meal.slot)} title={t.meal.dish.title}
              sub={t.over ? pastSentence(t.meal.slot) : rowSentence(t.week, t.meal)} end={t.over ? 'done' : 'chevron'} onClick={() => open(t.week, t.meal)} />
          ))}
        </div>
      )}
      <DaysCard label="Der Rest der Woche" rows={restOfWeek(weeks, nowMs)} onDay={setDay} />
      <DaysCard label="Nächste Woche" rows={nextWeekRows(weeks, nowMs)} onDay={setDay} />
      <div className="tk-tiles">
        {recipes}
        {shopping && <RowCard icon="einkauf" title="Einkauf" sub={openSentence(openCount(shopping))} onClick={onShopping} />}
      </div>
      <BoBubble portrait="mini" actions={<button type="button" className="secondary" onClick={onChat}>Plan ändern</button>}>{BO_LINES.mealsChange}</BoBubble>
      {day && (
        <Sheet size="small" title={day.dateLong} onClose={() => setDay(null)}>
          <div className="tk-rowcards">
            {dayMeals.map((m) => (
              <RowCard key={m.slot} picture={<MealImage recipeId={m.dish.recipeId} slot={m.slot} />} kicker={slotKicker(m.slot)} title={m.dish.title} sub={rowSentence(day.week, m)}
                onClick={() => { const w = day.week; setDay(null); open(w, m); }} />
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
