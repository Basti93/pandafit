import { useEffect, useRef, useState } from 'react';
import type { PandaGesture, PandaHandle } from './panda-canvas';

export type { PandaGesture } from './panda-canvas';

/** Bo waits this long after the canvas has drawn, so the page's data has arrived before he picks his pose. */
const SETTLE_MS = 800;
/** One slow glide into the pose. */
const GLIDE_MS = 2400;

const reducedMotion = (): boolean => {
  try { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * Bo's portrait: the still picture, and above it a canvas once the player has loaded and drawn.
 * Decorative only (the caller keeps all text and buttons). Calm rule: each time the surface opens, Bo glides slowly into
 * one pose (`pose` as it is shortly after the canvas has drawn) and keeps it until the surface closes. Later changes of
 * `pose` wait for the next opening. Under reduced motion the player is never loaded, and any load failure keeps the still.
 */
export function PandaPortrait({ pose, className = '' }: { pose?: PandaGesture | null; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [still] = useState(reducedMotion);
  const wanted = useRef(pose);
  wanted.current = pose;

  useEffect(() => {
    if (still) return;
    let alive = true;
    let handle: PandaHandle | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const { mountPanda } = await import('./panda-canvas');
        const h = await mountPanda(canvas.current!);
        if (!alive) { h.dispose(); return; }
        handle = h;
        setDrawn(true);
        timer = setTimeout(() => { const p = wanted.current; if (alive && p) h.hold(p, GLIDE_MS); }, SETTLE_MS);
      } catch { /* the still stays */ }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      handle?.dispose();
    };
  }, [still]);

  return (
    <span className={`tk-panda ${className}`.trim()} data-drawn={drawn ? 'true' : undefined} aria-hidden="true">
      <img className="tk-pandastill" src="/brand/panda-still.svg" alt="" width="128" height="134" />
      {!still && <canvas ref={canvas} className="tk-pandacanvas" width="396" height="328" />}
    </span>
  );
}
