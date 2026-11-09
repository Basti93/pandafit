import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { exerciseBlocks, type TrackedWorkout } from '../session';
import { Sheet } from './kit';

/** What starts a drag: the row that was held, and where the finger is. A negative pointerId only opens the list (from the exercise menu). */
export type DragStart = { rid: string; pointerId: number; y: number };

/**
 * "Reihenfolge": every exercise collapsed in one compact list. The held row lifts and follows the finger; the others make room;
 * on release `onDrop` gets the new block index. A superset group moves as one block. ↑/↓ buttons are the keyboard fallback.
 * The drag listens on the window, so the finger that began on the exercise title carries on in this list.
 */
export function ReorderSheet({ workout, start, onDrop, onStep, onClose }: {
  workout: TrackedWorkout; start: DragStart | null;
  onDrop: (rid: string, blockIndex: number) => void; onStep: (rid: string, dir: -1 | 1) => void; onClose: () => void;
}) {
  const blocks = useMemo(() => exerciseBlocks(workout), [workout]);
  const els = useRef<(HTMLLIElement | null)[]>([]);
  const rects = useRef<{ top: number; height: number }[]>([]);
  const [drag, setDrag] = useState<{ rid: string; pointerId: number; y0: number; dy: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const drop = useRef(onDrop);
  drop.current = onDrop;

  const begin = (rid: string, pointerId: number, y: number) => {
    rects.current = blocksRef.current.map((_, i) => { const r = els.current[i]?.getBoundingClientRect(); return { top: r?.top ?? 0, height: r?.height ?? 0 }; });
    setDrag({ rid, pointerId, y0: y, dy: 0 });
  };
  useLayoutEffect(() => { if (start && start.pointerId >= 0) begin(start.rid, start.pointerId, start.y); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const from = drag ? blocks.findIndex((b) => b.some((e) => e.rid === drag.rid)) : -1;
  const target = (dy: number, i: number): number => {
    const r = rects.current[i];
    if (!r) return i;
    const centre = r.top + r.height / 2 + dy;
    return rects.current.filter((o, k) => k !== i && o.top + o.height / 2 < centre).length;
  };

  const active = drag !== null;
  useEffect(() => {
    if (!active) return;
    const mine = (e: PointerEvent) => e.pointerId === dragRef.current?.pointerId;
    const move = (e: PointerEvent) => { if (mine(e)) setDrag((d) => (d ? { ...d, dy: e.clientY - d.y0 } : d)); };
    const end = (e: PointerEvent, cancelled: boolean) => {
      const d = dragRef.current;
      if (!d || !mine(e)) return;
      const i = blocksRef.current.findIndex((b) => b.some((x) => x.rid === d.rid));
      const to = cancelled ? i : target(e.clientY - d.y0, i);
      setDrag(null);
      if (i >= 0 && to !== i) drop.current(d.rid, to);
    };
    const up = (e: PointerEvent) => end(e, false);
    const cancel = (e: PointerEvent) => end(e, false); // a browser that takes the touch over still drops where the row was dragged to
    const noScroll = (e: Event) => { if (e.cancelable) e.preventDefault(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', noScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', noScroll);
    };
  }, [active]);  

  const to = drag && from >= 0 ? target(drag.dy, from) : -1;
  const gap = rects.current.length > 1 ? Math.max(0, rects.current[1]!.top - (rects.current[0]!.top + rects.current[0]!.height)) : 0;
  const shift = (k: number): number => {
    if (!drag || from < 0 || k === from) return 0;
    const h = (rects.current[from]?.height ?? 0) + gap;
    if (k > from && k <= to) return -h;
    if (k < from && k >= to) return h;
    return 0;
  };

  return (
    <Sheet title="Reihenfolge" onClose={onClose}>
      <ul className={`tk-reorder${drag ? ' dragging' : ''}`} aria-label="Reihenfolge der Übungen">
        {blocks.map((block, bi) => {
          const lifted = drag !== null && bi === from;
          const style = lifted ? { transform: `translateY(${drag.dy}px)` } : drag ? { transform: `translateY(${shift(bi)}px)` } : undefined;
          return (
            <li key={block[0]!.rid} ref={(el) => { els.current[bi] = el; }} className={`tk-reorder-block${block.length > 1 ? ' group' : ''}${lifted ? ' lifted' : ''}`} style={style}>
              {block.map((e) => {
                const mates = block.filter((x) => x !== e).map((x) => x.title);
                return (
                  <div key={e.rid} className="tk-reorder-row">
                    <span className="tk-reorder-grip" aria-hidden="true" onPointerDown={(ev) => { if (ev.button === 0 || ev.button === undefined) begin(e.rid, ev.pointerId, ev.clientY); }}>⋮⋮</span>
                    <span className="tk-reorder-title">
                      <span className="tk-row-title">{e.title}</span>
                      {block.length > 1 && <span className="muted tk-reorder-mark">{mates.length > 0 ? `Supersatz mit ${mates.join(', ')}` : 'Supersatz'}</span>}
                    </span>
                    <button type="button" className="link tk-reorder-step" aria-label={`${e.title} nach oben`} disabled={bi === 0} onClick={() => onStep(e.rid, -1)}>↑</button>
                    <button type="button" className="link tk-reorder-step" aria-label={`${e.title} nach unten`} disabled={bi === blocks.length - 1} onClick={() => onStep(e.rid, 1)}>↓</button>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
