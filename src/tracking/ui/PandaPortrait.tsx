import { useEffect, useRef, useState } from 'react';
import type { PandaGesture, PandaHandle } from './panda-canvas';

export type { PandaGesture } from './panda-canvas';
/** One event for Panda. The id is unique per event: an id that was seen is never played again by the same portrait. */
export type PandaEvent = { kind: PandaGesture; id: string };

/** How long each clip runs (frames at 60 fps from the motion source, plus a little margin). */
const CLIP_MS: Record<PandaGesture, number> = {
  greet: 1650, listen: 1050, nod: 1200, breathe: 3450, flex: 2550, bike: 2700, run: 2650, yoga: 3150, read: 2900, knit: 3100,
};
/** Panda sits still for this long between the greeting and the day clip. */
const GAP_MS = 1200;
const IDLE_MIN_MS = 30_000;
const IDLE_SPAN_MS = 15_000;

const reducedMotion = (): boolean => {
  try { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * Panda's portrait: the still picture, and above it a Canvas portrait once the runtime has loaded and drawn.
 * Decorative only (the caller keeps all text and buttons). Calm rules: one clip at a time, a new request while a clip plays is
 * dropped unless it is `nod` or `listen`, and `breathe` comes at most every 30-45 s while the page is visible. After a `greet`
 * the current `dayClip` plays once. No runtime is loaded under reduced motion, and any load failure keeps the still.
 */
export function PandaPortrait({ gesture, dayClip, className = '' }: { gesture?: PandaEvent; dayClip?: PandaGesture | null; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<PandaHandle | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [still] = useState(reducedMotion);
  const busyUntil = useRef(0);
  const seen = useRef<string | null>(null);
  const pending = useRef<PandaEvent | null>(null);
  const day = useRef(dayClip);
  day.current = dayClip;
  const timers = useRef<{ idle?: ReturnType<typeof setTimeout>; day?: ReturnType<typeof setTimeout> }>({});

  const idle = useRef<() => void>(() => {});
  const request = useRef((kind: PandaGesture): boolean => {
    const h = handle.current;
    if (!h || document.hidden) return false;
    const t = Date.now();
    if (t < busyUntil.current && kind !== 'nod' && kind !== 'listen') return false;
    busyUntil.current = t + CLIP_MS[kind];
    h.play(kind);
    idle.current();
    return true;
  });
  const flush = useRef(() => {
    const e = pending.current;
    if (!e || !handle.current) return;
    pending.current = null;
    if (!request.current(e.kind) || e.kind !== 'greet') return;
    clearTimeout(timers.current.day);
    timers.current.day = setTimeout(() => { const c = day.current; if (c) request.current(c); }, CLIP_MS.greet + GAP_MS);
  });

  useEffect(() => {
    if (still) return; // reduced motion: the runtime is never imported
    let alive = true;
    const t = timers.current;
    idle.current = () => {
      clearTimeout(t.idle);
      if (!alive || document.hidden) return;
      t.idle = setTimeout(() => {
        if (document.hidden || Date.now() < busyUntil.current || !request.current('breathe')) idle.current();
      }, IDLE_MIN_MS + Math.random() * IDLE_SPAN_MS);
    };
    const onVisible = () => { if (document.hidden) clearTimeout(t.idle); else idle.current(); };
    document.addEventListener('visibilitychange', onVisible);
    void (async () => {
      try {
        const { mountPanda } = await import('./panda-canvas');
        const h = await mountPanda(canvas.current!);
        if (!alive) { h.dispose(); return; }
        handle.current = h;
        setDrawn(true);
        idle.current();
        flush.current();
      } catch { /* the still stays */ }
    })();
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(t.idle);
      clearTimeout(t.day);
      const h = handle.current;
      handle.current = null;
      h?.dispose();
    };
  }, [still]);

  // A new event id is taken once, even over rerenders. It waits for the runtime and is dropped with the surface.
  useEffect(() => {
    if (!gesture || gesture.id === seen.current) return;
    seen.current = gesture.id;
    pending.current = gesture;
    flush.current();
  }, [gesture]);

  return (
    <span className={`tk-panda ${className}`.trim()} data-drawn={drawn ? 'true' : undefined} aria-hidden="true">
      <img className="tk-pandastill" src="/brand/panda-still.svg" alt="" width="128" height="134" />
      {!still && <canvas ref={canvas} className="tk-pandacanvas" width="396" height="328" />}
    </span>
  );
}
