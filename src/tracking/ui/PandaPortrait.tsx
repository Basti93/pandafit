import { useEffect, useRef, useState } from 'react';
import type { PandaGesture, PandaHandle } from './panda-canvas';
import { stillUrl } from './panda-still-url';

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
 * `pose` wait for the next opening. `onTake` tells once per opening which pose he took (or null if there was none).
 * Under reduced motion the player is never loaded, and when it fails to load, Bo stands as the still picture of his
 * pose: it shows while there is a pose, and is kept once taken (SETTLE_MS after opening, at the earliest).
 */
export function PandaPortrait({ pose, className = '', onTake }: { pose?: PandaGesture | null; className?: string; onTake?: (pose: PandaGesture | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [still] = useState(reducedMotion);
  const [failed, setFailed] = useState(false);
  /** undefined until Bo has settled; null when he settled with no pose. */
  const [taken, setTaken] = useState<PandaGesture | null | undefined>(undefined);
  const wanted = useRef(pose);
  wanted.current = pose;
  const told = useRef(onTake);
  useEffect(() => { told.current = onTake; });
  const [openedAt] = useState(() => Date.now());
  const standing = still || failed;

  useEffect(() => {
    if (!standing) return;
    let alive = true;
    const wait = Math.max(0, SETTLE_MS - (Date.now() - openedAt));
    const timer = setTimeout(() => {
      if (!alive) return;
      const p = wanted.current ?? null;
      setTaken(p);
      told.current?.(p);
    }, wait);
    return () => { alive = false; clearTimeout(timer); };
  }, [standing]);

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
        timer = setTimeout(() => { if (!alive) return; const p = wanted.current; if (p) h.hold(p, GLIDE_MS); told.current?.(p ?? null); }, SETTLE_MS);
      } catch { if (alive) setFailed(true); /* Bo stands as a still */ }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
      handle?.dispose();
    };
  }, [still]);

  const shown = standing ? (taken === undefined ? pose : taken) : null;
  return (
    <span className={`tk-panda ${className}`.trim()} data-drawn={drawn ? 'true' : undefined} aria-hidden="true">
      <img className="tk-pandastill" src={shown ? stillUrl(shown) : '/brand/panda-still.svg'} alt="" width="128" height="134" />
      {!still && <canvas ref={canvas} className="tk-pandacanvas" width="396" height="328" />}
    </span>
  );
}
