import { useLayoutEffect, useRef, type MutableRefObject } from 'react';

/** The newest value of a render, readable from effects and handlers without making them depend on it. Set before any effect of the same commit runs. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; });
  return ref;
}
