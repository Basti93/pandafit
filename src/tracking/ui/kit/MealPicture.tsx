import type { Slot } from '../../../shared/meals';

/**
 * The one drawn picture per meal type (brand/meals.svg). `small` fills a 40 px tile, `big` is the 196 x 154 picture of a head or main card.
 * The class `tk-meal {size}` also sizes a photo (<img>), so photo and drawing stand the same.
 */
export function MealPicture({ slot, size = 'small' }: { slot: Slot; size?: 'small' | 'big' }) {
  return <svg className={`tk-meal ${size}`} aria-hidden="true" viewBox="0 -4 120 94"><use href={`/brand/meals.svg#${slot}`} /></svg>;
}
