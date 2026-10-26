// Movement + collision shared by the authoritative engine AND client-side
// prediction, so a client predicting its own movement resolves walls, bases
// and speed effects exactly the way the host will.

import { ABILITIES } from './characters';
import * as C from './constants';
import { clamp } from './math';
import type { BaseState, Obstacle, TeamId, Vec2 } from './types';

/** Effect bitflags. Sent in snapshots so clients know their own speed state. */
export const FX = {
  SPEED: 1, // speed power unlocked
  MAGNET: 2,
  PHASE: 4, // walk-through-walls power unlocked
  BURST: 8, // post-steal speed burst
  PUMPKIN: 16,
  SLOWED: 32, // inside an enemy Grave Grasp
  DASH: 64, // Phase Dash active
  RUSH: 128, // Hellfire Rush active
  STAGGER: 256,
  STUN: 512,
  IMMUNE: 1024,
} as const;

const DASH_MULT = ABILITIES.phaseDash.speedMult ?? 2.6;
const RUSH_MULT = ABILITIES.hellfireRush.speedMult ?? 1.7;
const SLOW_MULT = ABILITIES.graveGrasp.slowMult ?? 0.45;

/** Movement speed (units/sec) implied by a set of effect flags. */
export function speedFromFlags(flags: number): number {
  if (flags & (FX.STUN | FX.STAGGER)) return 0;
  let s = C.PLAYER_SPEED;
  if (flags & FX.SPEED) s *= C.POWER_SPEED_MULT;
  if (flags & FX.BURST) s *= C.STEAL_BURST_MULT;
  if (flags & FX.RUSH) s *= RUSH_MULT;
  if (flags & FX.DASH) s *= DASH_MULT;
  else if (flags & FX.SLOWED) s *= SLOW_MULT;
  return s;
}

/** Players pass through obstacles while dashing or with the phase power. */
export function isPhasing(flags: number): boolean {
  return (flags & (FX.DASH | FX.PHASE)) !== 0;
}

export function insideObstacle(obstacles: readonly Obstacle[], pos: Vec2, pad = 0): boolean {
  return obstacles.some(
    (o) =>
      pos.x > o.min.x - pad && pos.x < o.max.x + pad && pos.z > o.min.z - pad && pos.z < o.max.z + pad,
  );
}

/**
 * Push `pos` (in place) out of walls, obstacles (unless phasing) and enemy
 * bases. Two obstacle passes handle corners where boxes meet.
 */
export function resolveCollisions(
  pos: Vec2,
  team: TeamId | -1,
  phasing: boolean,
  obstacles: readonly Obstacle[],
  bases: readonly BaseState[],
  half: number,
  radius = C.PLAYER_RADIUS,
): void {
  const bound = half - radius;
  pos.x = clamp(pos.x, -bound, bound);
  pos.z = clamp(pos.z, -bound, bound);

  if (!phasing) {
    for (let pass = 0; pass < 2; pass++) {
      for (const o of obstacles) {
        const minX = o.min.x - radius;
        const maxX = o.max.x + radius;
        const minZ = o.min.z - radius;
        const maxZ = o.max.z + radius;
        if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
          // Push out along the axis of least penetration.
          const penLeft = pos.x - minX;
          const penRight = maxX - pos.x;
          const penUp = pos.z - minZ;
          const penDown = maxZ - pos.z;
          const minPen = Math.min(penLeft, penRight, penUp, penDown);
          if (minPen === penLeft) pos.x = minX;
          else if (minPen === penRight) pos.x = maxX;
          else if (minPen === penUp) pos.z = minZ;
          else pos.z = maxZ;
        }
      }
    }
  }

  // Enemy bases are off-limits (Doodle rule) — even while phasing.
  for (const b of bases) {
    if (!b.active || b.team === team) continue;
    const dx = pos.x - b.pos.x;
    const dz = pos.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    const min = C.BASE_BLOCK_RADIUS + radius * 0.5;
    if (d < min) {
      if (d < 1e-4) {
        pos.x = b.pos.x - Math.sign(b.pos.x || 1) * min;
      } else {
        pos.x = b.pos.x + (dx / d) * min;
        pos.z = b.pos.z + (dz / d) * min;
      }
    }
  }

  pos.x = clamp(pos.x, -bound, bound);
  pos.z = clamp(pos.z, -bound, bound);
}

/**
 * Advance a position by a direction for dt seconds and collide. Returns true
 * if the entity actually moved (used for idle/run animation state).
 */
export function stepMovement(
  pos: Vec2,
  dir: Vec2,
  speed: number,
  dt: number,
  team: TeamId,
  phasing: boolean,
  obstacles: readonly Obstacle[],
  bases: readonly BaseState[],
  half: number,
): boolean {
  const len = Math.hypot(dir.x, dir.z);
  const ox = pos.x;
  const oz = pos.z;
  if (len > 1e-4 && speed > 0) {
    pos.x += (dir.x / len) * speed * dt;
    pos.z += (dir.z / len) * speed * dt;
  }
  resolveCollisions(pos, team, phasing, obstacles, bases, half);
  return Math.abs(pos.x - ox) + Math.abs(pos.z - oz) > 1e-4;
}

/**
 * Append breadcrumbs to a head-first trail, inserting evenly spaced crumbs
 * along long jumps (network updates arrive in steps larger than the spacing).
 */
export function recordTrail(trail: Vec2[], pos: Vec2, maxLen = C.MAX_TRAIL): void {
  const head = trail[0];
  if (!head) {
    trail.unshift({ x: pos.x, z: pos.z });
    return;
  }
  const dx = pos.x - head.x;
  const dz = pos.z - head.z;
  const d = Math.hypot(dx, dz);
  if (d < C.TRAIL_SPACING) return;
  if (d > C.TRAIL_SPACING * 12) {
    // Teleport-sized jump: start a fresh trail instead of drawing a line.
    trail.length = 0;
    trail.unshift({ x: pos.x, z: pos.z });
    return;
  }
  const steps = Math.floor(d / C.TRAIL_SPACING);
  for (let i = 1; i <= steps; i++) {
    const t = (i * C.TRAIL_SPACING) / d;
    trail.unshift({ x: head.x + dx * t, z: head.z + dz * t });
  }
  if (trail.length > maxLen) trail.length = maxLen;
}

/** Arc-length distance behind the head at which carried spirit k hangs. */
export function spiritDistance(k: number): number {
  return (C.TRAIL_FLAME_OFFSET + k) * C.TRAIL_SPACING;
}

/**
 * Walk the trail polyline (head -> crumb 0 -> crumb 1 …) and call `fn` with the
 * position of each of the first `n` carried spirits, spaced evenly by arc
 * length. Sampling by distance (rather than snapping to crumbs) makes spirits
 * glide smoothly as the trail grows. Returns how many fit on the trail;
 * `fn` returning true stops early.
 */
export function forEachSpirit(
  trail: readonly Vec2[],
  head: Vec2,
  n: number,
  fn: (k: number, x: number, z: number) => boolean | void,
): number {
  let k = 0;
  let want = spiritDistance(0);
  let walked = 0;
  let ax = head.x;
  let az = head.z;
  for (let i = 0; i < trail.length && k < n; i++) {
    const bx = trail[i].x;
    const bz = trail[i].z;
    const seg = Math.hypot(bx - ax, bz - az);
    while (k < n && walked + seg >= want) {
      const t = seg > 1e-6 ? (want - walked) / seg : 0;
      if (fn(k, ax + (bx - ax) * t, az + (bz - az) * t)) return k + 1;
      k++;
      want = spiritDistance(k);
    }
    walked += seg;
    ax = bx;
    az = bz;
  }
  return k;
}

/** Position of carried spirit k (or null if the trail is too short). */
export function carriedSpiritPos(trail: readonly Vec2[], head: Vec2, k: number): Vec2 | null {
  let out: Vec2 | null = null;
  forEachSpirit(trail, head, k + 1, (i, x, z) => {
    if (i === k) out = { x, z };
  });
  return out;
}

export function headingToDir(h: number): Vec2 {
  return { x: Math.sin(h), z: Math.cos(h) };
}

export function dirToHeading(d: Vec2): number {
  return Math.atan2(d.x, d.z);
}
