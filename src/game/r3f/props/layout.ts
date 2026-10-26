// Where the prop models go: gameplay obstacles (fitted to their collision
// boxes), perimeter walls, and per-map decoration. Pure data, so the layouts
// are testable and the menu can preload a map's models before the match.
//
// Collision never reads any of this; it only uses the obstacle boxes in
// core/maps.ts. Models are fitted to those boxes so what you see is what you
// bump into, and decoration stays at the edges, outside or overhead.

import * as C from '@/game/core/constants';
import type { Obstacle } from '@/game/core/types';
import type { FireSpot } from '../fx/Fire';
import { PROPS, type PropName } from './catalog';

export interface PropPlace {
  x: number;
  /** Base height (default 0, on the ground). */
  y?: number;
  z: number;
  /** Yaw: the model's front (+Z) turns to (sin rot, cos rot). */
  rot?: number;
  /** Small lean about X and Z (radians) for organic pieces. */
  tilt?: readonly [number, number];
  /** Scale of the model's own units, per axis. */
  s: readonly [number, number, number];
}

export type PropLayout = Partial<Record<PropName, PropPlace[]>>;

export interface Dressing {
  props: PropLayout;
  /** Perimeter walls (drawn without shadows: the high light barely throws them into the arena). */
  walls?: PropLayout;
  /** Flames that belong to props: braziers, candles, lanterns. */
  fires: FireSpot[];
}

export type TorchStyle = 'post' | 'sconce' | 'lamp';

interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

const boxOf = (o: Obstacle): Box => ({
  x: (o.min.x + o.max.x) / 2,
  z: (o.min.z + o.max.z) / 2,
  w: o.max.x - o.min.x,
  d: o.max.z - o.min.z,
  h: o.height ?? 2,
});

/** Deterministic pseudo-random sequence for stable placement. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const push = (l: PropLayout, name: PropName, p: PropPlace) => (l[name] ??= []).push(p);

/** Yaw that turns a model's front toward (fx, fz). */
export const facing = (fx: number, fz: number) => Math.atan2(fx, fz);

/** World position of a point given in a placed model's own (re-centered) units. */
export function pointOn(p: PropPlace, lx: number, ly: number, lz: number): { x: number; y: number; z: number } {
  const r = p.rot ?? 0;
  const x = lx * p.s[0];
  const z = lz * p.s[2];
  return { x: p.x + x * Math.cos(r) + z * Math.sin(r), y: (p.y ?? 0) + ly * p.s[1], z: p.z - x * Math.sin(r) + z * Math.cos(r) };
}

/** Top of a placed model (world Y). */
export const topOf = (name: PropName, p: PropPlace) => (p.y ?? 0) + PROPS[name].size[1] * p.s[1];

interface Cell {
  x: number;
  z: number;
  /** Cell size along / across the footprint's long side. */
  len: number;
  dep: number;
  /** Long side runs along world X. */
  alongX: boolean;
  /** Offset across the long side (sign says which half). */
  v: number;
}

/** Split a footprint into `cols` cells along its long side and `rows` across it. */
function cells(b: Box, cols: number, rows: number): Cell[] {
  const alongX = b.w >= b.d;
  const L = Math.max(b.w, b.d);
  const D = Math.min(b.w, b.d);
  const out: Cell[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const u = -L / 2 + ((i + 0.5) * L) / cols;
      const v = -D / 2 + ((j + 0.5) * D) / rows;
      out.push({ x: b.x + (alongX ? u : v), z: b.z + (alongX ? v : u), len: L / cols, dep: D / rows, alongX, v });
    }
  }
  return out;
}

/** Grid whose cells best match the model's footprint shape (fewer, bigger pieces win ties). */
function bestGrid(b: Box, name: PropName, maxCols = 6, maxRows = 2): [number, number] {
  const [mw, , md] = PROPS[name].size;
  const L = Math.max(b.w, b.d);
  const D = Math.min(b.w, b.d);
  let best: [number, number] = [1, 1];
  let bestCost = Infinity;
  for (let c = 1; c <= maxCols; c++) {
    for (let r = 1; r <= maxRows; r++) {
      const cost = Math.abs(Math.log(L / c / (D / r) / (mw / md))) + 0.1 * (c * r - 1);
      if (cost < bestCost) {
        bestCost = cost;
        best = [c, r];
      }
    }
  }
  return best;
}

/**
 * Fill a footprint with copies of a free-standing model (crypt rows, tables,
 * ponds): each cell gets one copy stretched to it. Height is `h` if given,
 * else proportional to the footprint scale times `yMul`.
 */
function fill(l: PropLayout, name: PropName, b: Box, opt: { h?: number; yMul?: number; grid?: [number, number] } = {}): PropPlace[] {
  const [mw, mh, md] = PROPS[name].size;
  const [cols, rows] = opt.grid ?? bestGrid(b, name);
  return cells(b, cols, rows).map((c) => {
    const sx = c.len / mw;
    const sz = c.dep / md;
    const sy = opt.h ? opt.h / mh : Math.sqrt(sx * sz) * (opt.yMul ?? 1);
    const p: PropPlace = { x: c.x, z: c.z, rot: c.alongX ? 0 : Math.PI / 2, s: [sx, sy, sz] };
    push(l, name, p);
    return p;
  });
}

/**
 * Line a footprint with wall-like segments `h` tall. Segment count follows from
 * the height so pieces keep their proportions; depth stretches to fit.
 * `front` turns one-sided walls toward a direction; without it the strip is
 * built back to back so both faces show.
 */
function wall(l: PropLayout, name: PropName, b: Box, h: number, front?: [number, number]): PropPlace[] {
  const [mw, mh, md] = PROPS[name].size;
  const L = Math.max(b.w, b.d);
  const cols = Math.max(1, Math.round(L / ((mw * h) / mh)));
  const rows = front ? 1 : 2;
  return cells(b, cols, rows).map((c) => {
    let rot: number;
    if (front) rot = facing(front[0], front[1]);
    else rot = c.alongX ? (c.v < 0 ? Math.PI : 0) : c.v < 0 ? -Math.PI / 2 : Math.PI / 2;
    const p: PropPlace = { x: c.x, z: c.z, rot, s: [c.len / mw, h / mh, c.dep / md] };
    push(l, name, p);
    return p;
  });
}

/** One copy scaled uniformly to `size` world units tall. */
function stand(l: PropLayout, name: PropName, x: number, z: number, height: number, rot = 0, y = 0, tilt?: readonly [number, number]): PropPlace {
  const s = height / PROPS[name].size[1];
  const p: PropPlace = { x, y, z, rot, s: [s, s, s], ...(tilt ? { tilt } : {}) };
  push(l, name, p);
  return p;
}

/** Faces toward the arena center from a point near the perimeter. */
const inward = (x: number, z: number) => (Math.abs(x) > Math.abs(z) ? facing(-Math.sign(x), 0) : facing(0, -Math.sign(z)));

// --- gameplay obstacles + perimeter ----------------------------------------------

export interface ArenaStyle {
  /** How 'tree' obstacles look. */
  trees: 'dead' | 'pine';
  /** Model the perimeter wall is built from (else the arena draws textured boxes). */
  wallModel?: PropName;
}

/** The mansion wall's two lanterns, in its own units (from its base, front side). */
const LANTERNS: [number, number, number][] = [
  [-0.52, 0.69, 0.3],
  [0.52, 0.69, 0.3],
];

/** Wall thickness of the perimeter (matches Arena's collision walls). */
export const PERIMETER_THICKNESS = 1.2;

export function dressArena(obstacles: readonly Obstacle[], half: number, style: ArenaStyle): Dressing {
  const l: PropLayout = {};
  const fires: FireSpot[] = [];

  obstacles.forEach((o, i) => {
    const b = boxOf(o);
    const rand = seeded(i * 7919 + 17);
    switch (o.kind) {
      case 'pillar': {
        // Shrine pillar filling the footprint, capped so the big shrine stays in proportion.
        const [mw, mh, md] = PROPS.shrine_pillar.size;
        const s = Math.min(b.w / mw, b.d / md, (b.h * 1.3) / mh);
        const p = stand(l, 'shrine_pillar', b.x, b.z, mh * s);
        fires.push({ x: b.x, y: topOf('shrine_pillar', p) - 0.05, z: b.z, scale: 1.25, color: '#a777ff' });
        break;
      }
      case 'mausoleum': {
        const p = fill(l, 'tomb_small', b, { yMul: 0.8, grid: [1, 1] })[0];
        // A flame in the urn on the roof.
        fires.push({ x: b.x, y: topOf('tomb_small', p) - 0.1, z: b.z, scale: 0.8, color: '#a777ff' });
        break;
      }
      case 'corn':
        wall(l, 'corn_wall', b, b.h);
        break;
      case 'hedge':
        fill(l, 'hay_bale', b, { h: b.h });
        break;
      case 'wall':
        for (const p of wall(l, 'mansion_wall', b, b.h)) {
          for (const [lx, ly, lz] of LANTERNS) fires.push({ ...pointOn(p, lx, ly, lz), scale: 0.22, color: '#ffb347' });
        }
        break;
      case 'shelf': {
        // Against the perimeter: one row facing in. Free-standing aisles: back to back.
        const nearEdge = Math.max(Math.abs(b.x), Math.abs(b.z)) > half - 2.5;
        wall(l, 'bookshelf', b, b.h, nearEdge ? (Math.abs(b.x) > Math.abs(b.z) ? [-Math.sign(b.x), 0] : [0, -Math.sign(b.z)]) : undefined);
        break;
      }
      case 'table':
        // Surface at about waist height; a candle flame tops each candelabra.
        for (const p of fill(l, 'dining_table', b, { h: 1.8 })) fires.push({ x: p.x, y: topOf('dining_table', p) - 0.02, z: p.z, scale: 0.28, color: '#ffb347' });
        break;
      case 'tree':
        if (style.trees === 'pine') stand(l, 'spooky_pine', b.x, b.z, b.h + 0.8, rand() * Math.PI * 2);
        else stand(l, 'dead_tree', b.x, b.z, b.h + 0.7, rand() * Math.PI * 2);
        break;
      case 'water':
        fill(l, 'lily_pond', b, { yMul: 0.4, grid: [1, 1] });
        break;
      case 'log':
        fill(l, 'mossy_log', b, { h: 1.1, grid: [3, 1] });
        break;
      case 'rock': {
        const [mw, , md] = PROPS.boulder.size;
        const s = Math.min(b.w / mw, b.d / md) * 1.05;
        push(l, 'boulder', { x: b.x, z: b.z, rot: rand() * Math.PI * 2, s: [s, s, s] });
        break;
      }
      default: {
        // Crypts: long ones are rows of sarcophagi, little ones headstones, the rest small tombs.
        const long = Math.max(b.w, b.d) / Math.min(b.w, b.d) >= 1.6;
        if (Math.min(b.w, b.d) < 1.2) {
          const stone: PropName = i % 2 ? 'gravestone_cross' : 'gravestone_round';
          fill(l, stone, b, { grid: [1, 1] });
        } else if (long) {
          fill(l, 'crypt_sarcophagus', b, { h: b.h });
        } else {
          fill(l, 'tomb_small', b, { yMul: 0.85, grid: [1, 1] });
        }
      }
    }
  });

  const walls: PropLayout = {};
  if (style.wallModel) {
    const t = PERIMETER_THICKNESS;
    const len = half * 2 + t;
    const h = C.WALL_HEIGHT;
    wall(walls, style.wallModel, { x: 0, z: -half, w: len, d: t, h }, h, [0, 1]);
    wall(walls, style.wallModel, { x: 0, z: half, w: len, d: t, h }, h, [0, -1]);
    wall(walls, style.wallModel, { x: -half, z: 0, w: t, d: len, h }, h, [1, 0]);
    wall(walls, style.wallModel, { x: half, z: 0, w: t, d: len, h }, h, [-1, 0]);
  }
  return { props: l, walls, fires };
}

/** Torch spots along the inside of the perimeter, keeping clear of the corner bases. */
export function torchSpots(half: number, style: TorchStyle): { x: number; z: number; rot: number }[] {
  const out: { x: number; z: number; rot: number }[] = [];
  const inset = style === 'sconce' ? 0.75 : 1.4;
  const e = half - inset;
  for (let t = -half + 12; t <= half - 12; t += 11) {
    out.push({ x: t, z: -e, rot: 0 }, { x: t, z: e, rot: Math.PI }, { x: -e, z: t, rot: Math.PI / 2 }, { x: e, z: t, rot: -Math.PI / 2 });
  }
  return out;
}

/** Midpoints between torch spots along one side (free wall space for furniture and portraits). */
function torchGaps(half: number): number[] {
  const out: number[] = [];
  for (let t = -half + 12; t + 11 <= half - 12; t += 11) out.push(t + 5.5);
  return out;
}

/** A point `inset` inside side `side` (0 north, 1 south, 2 west, 3 east) at offset `t` along it. */
function onSide(half: number, side: number, t: number, inset: number): [number, number] {
  const e = half - inset;
  return side === 0 ? [t, -e] : side === 1 ? [t, e] : side === 2 ? [-e, t] : [e, t];
}

/** Random points along the inside of the perimeter, skipping the corner bases. */
function edgeScatter(half: number, inset: number, count: number, seed: number): { x: number; z: number; side: number; jitter: number }[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const side = i % 4;
    const [x, z] = onSide(half, side, (rand() * 2 - 1) * (half - 12), inset);
    return { x, z, side, jitter: (rand() - 0.5) * 0.8 };
  });
}

// --- decoration --------------------------------------------------------------------

/** Per-map set dressing (no collision). Overhead and animated pieces live in Scenery. */
export function dressScenery(mapId: string, half: number, torch: TorchStyle): Dressing {
  const l: PropLayout = {};
  const fires: FireSpot[] = [];
  // Lamp-style maps light the perimeter with lampposts instead of torch posts.
  if (torch === 'lamp') for (const t of torchSpots(half, 'lamp')) stand(l, 'lamppost', t.x, t.z, 3.2, t.rot);

  switch (mapId) {
    case 'graveyard': {
      for (const [i, g] of edgeScatter(half, 1.6, 20, 7).entries()) {
        stand(l, i % 3 === 0 ? 'gravestone_cross' : 'gravestone_round', g.x, g.z, 1.6, inward(g.x, g.z) + g.jitter * 0.4, 0, [0.05, g.jitter * 0.12]);
      }
      for (const [i, p] of edgeScatter(half, 1.7, 10, 99).entries()) stand(l, 'jack_o_lantern', p.x, p.z, 0.7 + (i % 3) * 0.14, inward(p.x, p.z) + p.jitter);
      for (const [i, p] of edgeScatter(half, 2.2, 4, 41).entries()) stand(l, 'bone_pile', p.x, p.z, 0.7, inward(p.x, p.z) + p.jitter + i);
      for (const p of edgeScatter(half, 2.4, 4, 57)) stand(l, 'coffin', p.x, p.z, 0.8, inward(p.x, p.z) + Math.PI / 2 + p.jitter);
      const d = half + 3.5;
      const trees: [number, number, number, number][] = [
        [-d, -d, 0.3, 1.4],
        [d, -d, 1.1, 1.2],
        [-d, d, 2.0, 1.3],
        [d, d, -0.6, 1.5],
        [-d - 6, -10, 0.9, 1.7],
        [d + 7, 6, 2.2, 1.9],
        [8, -d - 8, 1.4, 1.8],
        [-12, d + 7, 0.2, 1.6],
      ];
      for (const [x, z, rot, s] of trees) stand(l, 'dead_tree', x, z, 3.4 * s, rot);
      // Wrought-iron fence just outside the wall, with a gate in the middle of each side.
      const R = half + 1.9;
      for (let side = 0; side < 4; side++) {
        const front: [number, number] = side === 0 ? [0, 1] : side === 1 ? [0, -1] : side === 2 ? [1, 0] : [-1, 0];
        const strip = side < 2 ? { x: 0, z: side === 0 ? -R : R, w: R * 2, d: 0.5, h: 2.4 } : { x: side === 2 ? -R : R, z: 0, w: 0.5, d: R * 2, h: 2.4 };
        const segs = wall(l, 'iron_fence', strip, 2.4, front);
        const mid = segs[Math.floor(segs.length / 2)];
        l.iron_fence!.splice(l.iron_fence!.indexOf(mid), 1);
        push(l, 'iron_gate', { ...mid, s: [mid.s[0], 2.6 / PROPS.iron_gate.size[1], mid.s[2]] });
      }
      break;
    }
    case 'cornmaze': {
      for (const g of edgeScatter(half, 2, 8, 3)) stand(l, 'scarecrow', g.x, g.z, 2.7, inward(g.x, g.z) + g.jitter * 0.5);
      for (const [i, p] of edgeScatter(half, 1.5, 26, 17).entries()) {
        if (i % 3 === 0) stand(l, 'pumpkin_patch', p.x, p.z, 1.0, inward(p.x, p.z) + p.jitter);
        else stand(l, 'jack_o_lantern', p.x, p.z, 0.6 + ((i * 7) % 5) * 0.1, inward(p.x, p.z) + p.jitter);
      }
      // The farm beyond the corn.
      stand(l, 'barn', -half * 0.7, -half - 26, 12, 0.4);
      stand(l, 'windmill', half * 0.55, -half - 30, 15, -0.3);
      stand(l, 'wooden_cart', -half * 0.7 + 10, -half - 19, 2.6, 1.1);
      for (let k = 0; k < 3; k++) stand(l, 'hay_bale', -half * 0.7 - 9 + k * 2.4, -half - 18 + (k % 2), 1.4, 0.2 * k);
      break;
    }
    case 'mansion': {
      const gaps = torchGaps(half);
      for (let side = 0; side < 4; side++) {
        const rot = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
        gaps.forEach((t, k) => {
          // Portraits hang between the sconces; a clock and an armchair stand below some of them.
          const [px, pz] = onSide(half, side, t, PERIMETER_THICKNESS / 2 + 0.1);
          if (k % 2 === 0) stand(l, 'haunted_portrait', px, pz, 1.5, rot, 1.35);
          const [fx, fz] = onSide(half, side, t, PERIMETER_THICKNESS / 2 + 0.6);
          if (k === 1) stand(l, 'grandfather_clock', fx, fz, 2.7, rot);
          if (k === 3) stand(l, 'armchair', fx, fz, 1.4, rot);
        });
      }
      break;
    }
    case 'forest': {
      const rand = seeded(5);
      for (let i = 0; i < 180; i++) {
        const side = i % 4;
        const t = (rand() * 2 - 1) * (half + 14);
        const dd = half + 2.8 + rand() * 14;
        const [x, z] = side === 0 ? [t, -dd] : side === 1 ? [t, dd] : side === 2 ? [-dd, t] : [dd, t];
        stand(l, 'spooky_pine', x, z, 5 + rand() * 4, rand() * Math.PI * 2, 0, [(rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08]);
      }
      // Glowing mushroom ring around the pumpkin clearing.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        stand(l, 'mushrooms', Math.cos(a) * 3.8, Math.sin(a) * 3.8, 0.55 + (i % 3) * 0.18, facing(-Math.cos(a), -Math.sin(a)));
      }
      for (const [i, p] of edgeScatter(half, 2, 8, 23).entries()) stand(l, i % 2 ? 'tree_stump' : 'boulder', p.x, p.z, i % 2 ? 0.9 : 0.8, p.jitter * 4);
      for (const p of edgeScatter(half, 2.4, 4, 61)) stand(l, 'mossy_log', p.x, p.z, 0.9, inward(p.x, p.z) + Math.PI / 2 + p.jitter);
      stand(l, 'cauldron', -half + 4, 0, 1.4, Math.PI / 2);
      break;
    }
    case 'library': {
      const gaps = torchGaps(half);
      for (let side = 0; side < 4; side++) {
        const rot = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
        gaps.forEach((t, k) => {
          const [x, z] = onSide(half, side, t, PERIMETER_THICKNESS / 2 + 0.8);
          if (k === 0) stand(l, 'grandfather_clock', x, z, 2.7, rot);
          if (k === 1) stand(l, 'reading_desk', x, z, 1.4, rot);
          if (k === 2) stand(l, 'globe', x, z, 1.5, rot);
          if (k === 3) stand(l, 'armchair', x, z, 1.4, rot);
        });
      }
      break;
    }
  }
  return { props: l, fires };
}

/** Every model a map uses (for preloading). */
export function propsUsed(...dressings: Dressing[]): PropName[] {
  return [...new Set(dressings.flatMap((d) => [...Object.keys(d.props), ...Object.keys(d.walls ?? {})] as PropName[]))];
}

/**
 * Props placed by components rather than layouts: base portals (Arena), the
 * collectible spirits (Flames), the Mega-Spirit, Magic Pumpkin, Bone Toss and
 * Grave Grasp (Specials), and the chandeliers and floating books (Scenery).
 * Any map can need them.
 */
export const SET_PIECES: readonly PropName[] = [
  'portal_ghosts',
  'portal_zombies',
  'portal_skeletons',
  'portal_demons',
  'spirit',
  'mega_spirit',
  'magic_pumpkin',
  'bone_projectile',
  'grasp_hand',
  'chandelier',
  'floating_book',
];
