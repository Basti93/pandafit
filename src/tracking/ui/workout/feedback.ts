/** A short buzz when a set is done. Where the device cannot vibrate (iOS), nothing happens; this never throws. */
export function buzz(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(15);
  } catch { /* kein Vibrieren */ }
}
