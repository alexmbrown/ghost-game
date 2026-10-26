import type { Obstacle, Vec2 } from './types';

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.z);
  if (len < 1e-4) return { x: 0, z: 0 };
  return { x: v.x / len, z: v.z / len };
}

export function dirTo(from: Vec2, to: Vec2): Vec2 {
  return normalize({ x: to.x - from.x, z: to.z - from.z });
}

/** Shortest signed difference between two angles (radians). */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/**
 * Does segment p→q pass through the box (expanded by `pad`)? Slab test.
 * Used by bots for line-of-sight and by projectiles for wall hits.
 */
export function segmentHitsBox(p: Vec2, q: Vec2, o: Obstacle, pad = 0): boolean {
  const minX = o.min.x - pad;
  const maxX = o.max.x + pad;
  const minZ = o.min.z - pad;
  const maxZ = o.max.z + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const axes: [number, number, number, number][] = [
    [p.x, dx, minX, maxX],
    [p.z, dz, minZ, maxZ],
  ];
  for (const [start, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (start <= lo || start >= hi) return false;
    } else {
      let a = (lo - start) / d;
      let b = (hi - start) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Small, fast, seedable PRNG (mulberry32) so matches are reproducible in tests. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
