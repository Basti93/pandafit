import type { ReactNode } from 'react';
import type { PandaGesture } from '../panda-canvas';

/**
 * Bo in one of his places: the scene behind him, a glow, Bo (`children`), and the front edge of the place in front of him.
 * Dojo 5 fügt die übrigen Orte aus DESIGN.md (Bos Orte) hinzu: ein Name in `BoPlace` und eine Datei `brand/bo-{place}.svg` mit den Symbolen `back` und `front`, gefärbt nur über `--scene-*`-Tokens.
 * `children` darf das Standbild oder das bewegte `PandaPortrait` sein.
 */
export type BoPlace = 'nest';

/**
 * The poses that fit each place. Bo sits in the nest, so standing poses with their own ground
 * (bike, run, yoga on a mat) do not fit there; they get their own places in Dojo 5.
 */
export const PLACE_POSES: Record<BoPlace, readonly PandaGesture[]> = {
  nest: ['greet', 'listen', 'nod', 'breathe', 'flex', 'read', 'knit'],
};

/** The pose Bo takes in a place: the wanted one if it fits there, otherwise the greeting. */
export function poseIn(place: BoPlace, wanted: PandaGesture | null | undefined): PandaGesture {
  return wanted && PLACE_POSES[place].includes(wanted) ? wanted : 'greet';
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
