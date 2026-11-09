import { useCallback, useEffect, useRef } from 'react';
import type { DragStart } from '../ReorderSheet';
import { useLatest } from './useLatest';

/**
 * Holding an exercise title (about half a second, the finger hardly moving) opens the "Reihenfolge" mode; the same finger then drags.
 * `held` tells the click that ends a long press not to also open the row.
 */
export function useHold(onHold: (start: DragStart) => void) {
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; rid: string; id: number } | null>(null);
  const held = useRef(false);
  const onHoldRef = useLatest(onHold);
  const stopHold = useCallback(() => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null; } }, []);
  useEffect(() => stopHold, [stopHold]);
  const holdProps = (rid: string) => ({
    onPointerDown: (ev: React.PointerEvent) => {
      if (ev.button !== 0 && ev.button !== undefined) return;
      stopHold();
      const h = { x: ev.clientX, y: ev.clientY, rid, id: ev.pointerId, timer: setTimeout(() => {
        const at = hold.current;
        hold.current = null;
        if (!at) return;
        held.current = true;
        onHoldRef.current({ rid: at.rid, pointerId: at.id, y: at.y });
      }, 450) };
      hold.current = h;
    },
    onPointerMove: (ev: React.PointerEvent) => {
      const h = hold.current;
      if (!h) return;
      if (Math.hypot(ev.clientX - h.x, ev.clientY - h.y) > 8) stopHold();
      else h.y = ev.clientY;
    },
    onPointerUp: stopHold, onPointerCancel: stopHold, onPointerLeave: stopHold,
    onContextMenu: (ev: React.MouseEvent) => ev.preventDefault(),
  });
  return { holdProps, held };
}
