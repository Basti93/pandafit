import type { ReactNode } from 'react';

/**
 * Bo in one of his places: the scene behind him, a glow, Bo (`children`), and the front edge of the place in front of him.
 * Dojo 5 fügt die übrigen Orte aus DESIGN.md (Bos Orte) hinzu: ein Name in `BoPlace` und eine Datei `brand/bo-{place}.svg` mit den Symbolen `back` und `front`, gefärbt nur über `--scene-*`-Tokens.
 * `children` darf das Standbild oder das bewegte `PandaPortrait` sein.
 */
export type BoPlace = 'nest';

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
