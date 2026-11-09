import { useState } from 'react';
import type { Slot } from '../../shared/meals';
import { MealPicture } from '../../tracking/ui/kit';

/** The one place that chooses photo or drawing: the recipe's photo, and the drawing of the meal type when there is no recipe, no photo, or it does not load. */
export function MealImage({ recipeId, has, slot, size = 'small' }: { recipeId?: string; has?: boolean; slot: Slot; size?: 'small' | 'big' }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  if (recipeId && has !== false && failedId !== recipeId) {
    return <img className={`tk-meal ${size} photo`} src={`/coach/recipes/${recipeId}/image`} alt="" loading="lazy" onError={() => setFailedId(recipeId)} />;
  }
  return <MealPicture slot={slot} size={size} />;
}
