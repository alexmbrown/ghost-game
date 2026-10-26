import { PerformanceMonitor } from '@react-three/drei';
import { createElement, useCallback, useState, type ReactElement } from 'react';

/**
 * Render resolution that follows the frame rate: full sharpness (up to 2x on
 * high-DPI screens with High quality) while the GPU keeps up, stepping down to
 * 0.75x when it doesn't — the biggest single win on laptops, since pixel count
 * drives the bloom, fog and shading cost. Put `monitor` inside the Canvas and
 * pass `dpr` to it.
 */
export function useAdaptiveDpr(high: boolean): { dpr: number; monitor: ReactElement } {
  const max = high ? Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1) : 1;
  const min = 0.75;
  const [dpr, setDpr] = useState(max);
  const onChange = useCallback(
    ({ factor }: { factor: number }) => setDpr(Math.round((min + (max - min) * factor) * 4) / 4),
    [max],
  );
  const onFallback = useCallback(() => setDpr(min), []);
  const monitor = createElement(PerformanceMonitor, { factor: 1, flipflops: 3, onChange, onFallback });
  return { dpr: Math.min(dpr, max), monitor };
}
