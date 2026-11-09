import type { ReactNode } from 'react';
import type { PandaGesture } from '../panda-canvas';

/**
 * Bo in one of his places: the scene behind him, a glow, Bo (`children`), and the front edge of the place in front of him.
 * A place is a name in `BoPlace`, a row in `PLACE_POSES` and a file `brand/bo-{place}.svg` with the symbols `back` and `front`, coloured only through tokens.
 * `children` may be the still picture or the moving `PandaPortrait`.
 */
export type BoPlace = 'nest' | 'dojo' | 'huegel' | 'wald';

export const PLACES: readonly BoPlace[] = ['nest', 'dojo', 'huegel', 'wald'];

/**
 * The poses that fit each place; the first is the place's own pose and the stand-in when another does not fit.
 * Bo sits in the nest, so standing poses with their own ground (bike, run) do not fit there; they have places of their own.
 * Today `place="own"` is used; the fixed place and the further poses per place stay for places that carry more than one pose (DESIGN.md).
 */
export const PLACE_POSES: Record<BoPlace, readonly PandaGesture[]> = {
  nest: ['greet', 'listen', 'nod', 'breathe', 'flex', 'read', 'knit'],
  dojo: ['flex', 'greet', 'nod', 'listen', 'breathe'],
  huegel: ['bike'],
  wald: ['run'],
};

/** The pose Bo takes in a place: the wanted one if it fits there, otherwise the place's own pose. */
export function poseIn(place: BoPlace, wanted: PandaGesture | null | undefined): PandaGesture {
  return wanted && PLACE_POSES[place].includes(wanted) ? wanted : PLACE_POSES[place][0]!;
}

/** The place a pose belongs to: the place whose own (first) pose it is, otherwise the nest. */
export function placeOf(pose: PandaGesture | null | undefined): BoPlace {
  return PLACES.find((p) => PLACE_POSES[p][0] === pose) ?? 'nest';
}

export function BoScene({ place, children }: { place: BoPlace; children: ReactNode }) {
  return (
    <span className="tk-scene" data-place={place} aria-hidden="true">
      <svg className="tk-scene-back" viewBox="0 0 116 176" preserveAspectRatio="xMidYMax slice"><use href={`/brand/bo-${place}.svg#back`} /></svg>
      <span className="tk-scene-glow" />
      {children}
      <svg className="tk-scene-front" viewBox="0 0 116 176" preserveAspectRatio="xMidYMax slice"><use href={`/brand/bo-${place}.svg#front`} /></svg>
    </span>
  );
}
