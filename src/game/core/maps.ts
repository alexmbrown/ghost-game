// Map layouts (gameplay geometry only — visuals live in r3f/mapThemes.ts).
// Every map is a square arena with a team base in each corner and is mirrored
// across both axes, so all four teams get the same routes.

import type { Obstacle, TeamId, Vec2 } from './types';

export interface MapDef {
  id: string;
  name: string;
  description: string;
  /** Arena spans [-half, half] on X and Z. */
  half: number;
  obstacles: Obstacle[];
  bases: Record<TeamId, Vec2>;
  /** Where the Magic Pumpkin appears. */
  pumpkin: Vec2;
  /** Candidate spawn points for Mega-Spirits. */
  megaSpawns: Vec2[];
}

type Kind = NonNullable<Obstacle['kind']>;

function box(cx: number, cz: number, hx: number, hz: number, kind: Kind, height = 2): Obstacle {
  return { min: { x: cx - hx, z: cz - hz }, max: { x: cx + hx, z: cz + hz }, kind, height };
}

/** Mirror boxes from one quadrant into all four (fair for 4 teams). Boxes on an axis dedupe. */
function mirror4(...list: Obstacle[]): Obstacle[] {
  const out: Obstacle[] = [];
  const seen = new Set<string>();
  for (const o of list) {
    const cx = (o.min.x + o.max.x) / 2;
    const cz = (o.min.z + o.max.z) / 2;
    const hx = (o.max.x - o.min.x) / 2;
    const hz = (o.max.z - o.min.z) / 2;
    for (const [sx, sz] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const key = `${(cx * sx).toFixed(2)},${(cz * sz).toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(box(cx * sx, cz * sz, hx, hz, o.kind ?? 'crypt', o.height ?? 2));
    }
  }
  return out;
}

/** Both orientations of a box across the diagonal (x<->z), mirrored into all quadrants. */
function mirror8(...list: Obstacle[]): Obstacle[] {
  const swapped = list.map((o) => ({
    ...o,
    min: { x: o.min.z, z: o.min.x },
    max: { x: o.max.z, z: o.max.x },
  }));
  return mirror4(...list, ...swapped);
}

function cornerBases(half: number, inset: number): Record<TeamId, Vec2> {
  const b = half - inset;
  return { 0: { x: -b, z: -b }, 1: { x: b, z: -b }, 2: { x: -b, z: b }, 3: { x: b, z: b } };
}

const axis = (d: number): Vec2[] => [
  { x: 0, z: -d },
  { x: 0, z: d },
  { x: -d, z: 0 },
  { x: d, z: 0 },
];

export const MAPS: Record<string, MapDef> = {
  graveyard: {
    id: 'graveyard',
    name: 'Moonlit Graveyard',
    description: 'Crypt rows, mausoleums and a pillared shrine where the Magic Pumpkin sleeps.',
    half: 40,
    obstacles: [
      ...mirror4(box(5, 5, 1.2, 1.2, 'pillar', 3)),
      ...mirror8(box(17, 0, 4, 1.6, 'crypt', 2)),
      ...mirror4(box(17, 17, 2.6, 2.6, 'mausoleum', 3.4)),
      ...mirror8(box(25, 14, 1.3, 1.3, 'crypt', 2.2)),
      ...mirror8(box(31, 0, 1.3, 5, 'crypt', 2)),
      ...mirror8(box(9, 26, 0.7, 0.35, 'crypt', 1.4)),
      ...mirror8(box(30, 22, 0.8, 0.8, 'tree', 3.5)),
    ],
    bases: cornerBases(40, 7),
    pumpkin: { x: 0, z: 0 },
    megaSpawns: axis(26),
  },

  cornmaze: {
    id: 'cornmaze',
    name: 'Corn Maze',
    description: 'Three rings of tall corn with gaps in odd places. Watch the corners.',
    half: 42,
    obstacles: [
      ...mirror8(box(6.25, 9, 3.75, 0.7, 'corn', 2.8)),
      ...mirror8(box(9.5, 19, 5.5, 0.7, 'corn', 2.8)),
      ...mirror8(box(8, 28, 5, 0.7, 'corn', 2.8)),
      ...mirror8(box(21, 28, 2.5, 0.7, 'corn', 2.8)),
      ...mirror8(box(0, 36, 4, 0.7, 'corn', 2.8)),
      ...mirror8(box(29, 35, 1.8, 1, 'hedge', 1.4)),
    ],
    bases: cornerBases(42, 7),
    pumpkin: { x: 0, z: 0 },
    megaSpawns: [
      { x: -14, z: -14 },
      { x: 14, z: -14 },
      { x: -14, z: 14 },
      { x: 14, z: 14 },
    ],
  },

  mansion: {
    id: 'mansion',
    name: 'Haunted Mansion',
    description: 'A roofless manor: a ballroom ringed by a gallery, with doors on every side.',
    half: 38,
    obstacles: [
      // ballroom walls (doorways in the middle of each side)
      ...mirror8(box(6.25, 10, 3.75, 0.4, 'wall', 3.2)),
      // gallery walls (central doors)
      ...mirror8(box(12.5, 21, 8.5, 0.4, 'wall', 3.2)),
      // ballroom pillars
      ...mirror4(box(6.2, 6.2, 0.8, 0.8, 'pillar', 3.2)),
      // gallery furniture
      ...mirror4(box(15.5, 15.5, 1.4, 1.4, 'table', 1)),
      // outer rooms: tables and bookshelves against the walls
      ...mirror8(box(30, 14, 2.2, 1, 'table', 1)),
      ...mirror8(box(36.6, 20, 0.7, 3, 'shelf', 3.4)),
    ],
    bases: cornerBases(38, 7),
    pumpkin: { x: 0, z: 0 },
    megaSpawns: axis(15.5),
  },

  forest: {
    id: 'forest',
    name: 'Spooky Forest',
    description: 'Wide woods with lily ponds, fallen logs and a mushroom ring at the heart.',
    half: 44,
    obstacles: [
      ...mirror4(box(15, 15, 3.6, 3.6, 'water', 0.2)),
      ...mirror8(box(0, 22, 4.5, 0.7, 'log', 0.9)),
      ...mirror4(box(6, 6, 1, 1, 'rock', 1.2)),
      ...mirror8(
        box(7, 28, 0.9, 0.9, 'tree', 5),
        box(12, 34, 0.9, 0.9, 'tree', 5),
        box(25, 23, 0.9, 0.9, 'tree', 5),
        box(4, 18, 0.9, 0.9, 'tree', 5),
        box(20, 38, 0.9, 0.9, 'tree', 5),
      ),
      ...mirror4(box(30, 30, 0.9, 0.9, 'tree', 5)),
    ],
    bases: cornerBases(44, 7),
    pumpkin: { x: 0, z: 0 },
    megaSpawns: axis(31),
  },

  library: {
    id: 'library',
    name: 'Haunted Library',
    description: 'Towering bookshelf aisles around a candle-lit reading room.',
    half: 36,
    obstacles: [
      ...mirror8(box(0, 5.5, 2.2, 0.9, 'table', 1)),
      ...mirror8(box(9.5, 13, 4.5, 0.6, 'shelf', 3.6), box(9.5, 18, 4.5, 0.6, 'shelf', 3.6)),
      ...mirror8(box(13, 34, 5, 0.6, 'shelf', 3.6)),
      ...mirror8(box(19, 24, 1.6, 1, 'table', 1)),
      ...mirror4(box(9, 9, 0.9, 0.9, 'pillar', 3.6)),
    ],
    bases: cornerBases(36, 7),
    pumpkin: { x: 0, z: 0 },
    megaSpawns: axis(25),
  },
};

export const MAP_IDS = Object.keys(MAPS);
export const DEFAULT_MAP = 'graveyard';

export function getMap(id: string): MapDef {
  return MAPS[id] ?? MAPS[DEFAULT_MAP];
}

/** Loose-spirit budget scales with arena area (34 spirits per 56x56 of floor). */
export function spiritBudget(half: number): { max: number; initial: number; interval: number } {
  const area = (half / 28) ** 2;
  const max = Math.round(34 * area);
  return { max, initial: Math.round(max * 0.45), interval: 0.5 / area };
}
