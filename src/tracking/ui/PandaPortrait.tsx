import { useEffect, useRef, useState } from 'react';
import type { PandaGesture, PandaHandle } from './panda-canvas';
import { stillUrl } from './panda-still-url';

export type { PandaGesture } from './panda-canvas';

const reducedMotion = (): boolean => {
  try { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * Bo's portrait: the still picture of his pose, and above it a canvas once the player has loaded and drawn.
 * Decorative only (the caller keeps all text and buttons). Calm rule: Bo has one pose per opening, the `pose` he is
 * mounted with. The still already shows it, and the canvas starts in the same pose, so nothing jumps when it draws.
 * Later changes of `pose` wait for the next opening. Under reduced motion, or when the player fails to load, the still stays.
 */
export function PandaPortrait({ pose, className = '', still: held = false }: { pose?: PandaGesture | null; className?: string; /** Only the still picture: no canvas, no endless animation (a workout is open). */ still?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [reduced] = useState(reducedMotion);
  const still = reduced || held;
  const [kept] = useState<PandaGesture | null>(pose ?? null);

  useEffect(() => {
    if (still) return;
    let alive = true;
    let handle: PandaHandle | null = null;
    void (async () => {
      try {
        const { mountPanda } = await import('./panda-canvas');
        const h = await mountPanda(canvas.current!);
        if (!alive) { h.dispose(); return; }
        handle = h;
        if (kept) h.hold(kept, 0); // straight into the pose the still shows
        setDrawn(true);
      } catch { /* Bo stands as the still */ }
    })();
    return () => {
      alive = false;
      handle?.dispose();
    };
  }, [still, kept]);

  return (
    <span className={`tk-panda ${className}`.trim()} data-drawn={drawn && !still ? 'true' : undefined} aria-hidden="true">
      <img className="tk-pandastill" src={kept ? stillUrl(kept) : '/brand/panda-still.svg'} alt="" width="128" height="134" />
      {!still && <canvas ref={canvas} className="tk-pandacanvas" width="396" height="328" />}
    </span>
  );
}
