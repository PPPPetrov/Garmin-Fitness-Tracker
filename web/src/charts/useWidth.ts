import { useEffect, useRef, useState } from 'react';

/**
 * Measure the element so charts can be drawn in real pixels.
 *
 * Scaling a fixed viewBox to the container also scales its text: a 12px tick label
 * would render at about 4px on a phone, under the legibility floor.
 */
export function useWidth(fallback = 640): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next > 0) setWidth(Math.round(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}
