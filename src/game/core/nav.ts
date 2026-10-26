// Grid navigation for bots: A* over a 1-unit walkability grid built from the
// map's obstacles (inflated by the player radius), plus string-pulling so
// bots walk straight lines between corners instead of cell-by-cell.

import * as C from './constants';
import { segmentHitsBox } from './math';
import type { BaseState, Obstacle, TeamId, Vec2 } from './types';

const SQRT2 = Math.SQRT2;
const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

export class NavGrid {
  readonly size: number;
  private readonly blocked: Uint8Array;
  private readonly losObstacles: readonly Obstacle[];
  private readonly blockedBases: readonly Vec2[];
  // Scratch buffers reused across searches.
  private readonly g: Float32Array;
  private readonly came: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;

  constructor(
    readonly half: number,
    obstacles: readonly Obstacle[],
    bases: readonly BaseState[],
    team: TeamId,
    readonly cell = 1,
  ) {
    this.size = Math.ceil((half * 2) / cell);
    const n = this.size * this.size;
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.losObstacles = obstacles;
    this.blockedBases = bases.filter((b) => b.active && b.team !== team).map((b) => b.pos);

    const pad = C.PLAYER_RADIUS + 0.1;
    const baseR = C.BASE_BLOCK_RADIUS + C.PLAYER_RADIUS * 0.5 + 0.2;
    for (let i = 0; i < this.size; i++) {
      for (let j = 0; j < this.size; j++) {
        const x = -half + (i + 0.5) * cell;
        const z = -half + (j + 0.5) * cell;
        let block = Math.abs(x) > half - pad || Math.abs(z) > half - pad;
        for (const o of obstacles) {
          if (block) break;
          if (x > o.min.x - pad && x < o.max.x + pad && z > o.min.z - pad && z < o.max.z + pad) block = true;
        }
        for (const b of this.blockedBases) {
          if (block) break;
          if (Math.hypot(x - b.x, z - b.z) < baseR) block = true;
        }
        this.blocked[i * this.size + j] = block ? 1 : 0;
      }
    }
  }

  private cellOf(p: Vec2): [number, number] {
    const i = Math.min(this.size - 1, Math.max(0, Math.floor((p.x + this.half) / this.cell)));
    const j = Math.min(this.size - 1, Math.max(0, Math.floor((p.z + this.half) / this.cell)));
    return [i, j];
  }

  private center(idx: number): Vec2 {
    const i = Math.floor(idx / this.size);
    const j = idx % this.size;
    return { x: -this.half + (i + 0.5) * this.cell, z: -this.half + (j + 0.5) * this.cell };
  }

  isBlockedAt(p: Vec2): boolean {
    const [i, j] = this.cellOf(p);
    return this.blocked[i * this.size + j] === 1;
  }

  /** Nearest walkable cell (spiral search) — targets/players can sit at cell edges. */
  private nearestOpen(i: number, j: number): number {
    if (!this.blocked[i * this.size + j]) return i * this.size + j;
    for (let r = 1; r < 6; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dj = -r; dj <= r; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= this.size || b >= this.size) continue;
          if (!this.blocked[a * this.size + b]) return a * this.size + b;
        }
      }
    }
    return -1;
  }

  /** Straight line clear of (inflated) obstacles and enemy bases? */
  clearLine(a: Vec2, b: Vec2): boolean {
    const pad = C.PLAYER_RADIUS * 0.95;
    for (const o of this.losObstacles) if (segmentHitsBox(a, b, o, pad)) return false;
    const r = C.BASE_BLOCK_RADIUS + C.PLAYER_RADIUS * 0.5;
    for (const c of this.blockedBases) {
      // distance from base center to segment
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / len2));
      if (Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z) < r) return false;
    }
    return true;
  }

  /**
   * A* from `from` to `to`; returns smoothed waypoints (excluding the start),
   * ending at `to`. Null if unreachable.
   */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    if (this.clearLine(from, to)) return [{ ...to }];
    const [si, sj] = this.cellOf(from);
    const [gi, gj] = this.cellOf(to);
    const start = this.nearestOpen(si, sj);
    const goal = this.nearestOpen(gi, gj);
    if (start < 0 || goal < 0) return null;

    const gen = ++this.gen;
    const size = this.size;
    const goalC = this.center(goal);
    const h = (idx: number) => {
      const dx = Math.abs(Math.floor(idx / size) - Math.floor(goal / size));
      const dz = Math.abs((idx % size) - (goal % size));
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * this.cell;
    };

    // Binary heap of [f, idx].
    const heapF: number[] = [];
    const heapI: number[] = [];
    const push = (f: number, idx: number) => {
      let k = heapF.length;
      heapF.push(f);
      heapI.push(idx);
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapF[p] <= f) break;
        heapF[k] = heapF[p];
        heapI[k] = heapI[p];
        k = p;
      }
      heapF[k] = f;
      heapI[k] = idx;
    };
    const pop = (): number => {
      const top = heapI[0];
      const lastF = heapF.pop()!;
      const lastI = heapI.pop()!;
      if (heapF.length) {
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          if (l >= heapF.length) break;
          const r = l + 1;
          const c = r < heapF.length && heapF[r] < heapF[l] ? r : l;
          if (heapF[c] >= lastF) break;
          heapF[k] = heapF[c];
          heapI[k] = heapI[c];
          k = c;
        }
        heapF[k] = lastF;
        heapI[k] = lastI;
      }
      return top;
    };

    this.stamp[start] = gen;
    this.g[start] = 0;
    this.came[start] = -1;
    push(h(start), start);
    let found = false;
    let expansions = 0;
    while (heapF.length && expansions < 20000) {
      const cur = pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      expansions++;
      if (cur === goal) {
        found = true;
        break;
      }
      const ci = Math.floor(cur / size);
      const cj = cur % size;
      for (const [di, dj, cost] of NEIGHBORS) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
        const nidx = ni * size + nj;
        if (this.blocked[nidx] || this.closed[nidx] === gen) continue;
        // No corner cutting on diagonals.
        if (di && dj && (this.blocked[ci * size + nj] || this.blocked[ni * size + cj])) continue;
        const ng = this.g[cur] + cost * this.cell;
        if (this.stamp[nidx] !== gen || ng < this.g[nidx]) {
          this.stamp[nidx] = gen;
          this.g[nidx] = ng;
          this.came[nidx] = cur;
          push(ng + h(nidx), nidx);
        }
      }
    }
    if (!found) return null;

    const cells: Vec2[] = [];
    for (let c = goal; c !== -1 && c !== start; c = this.came[c]) cells.push(this.center(c));
    cells.reverse();
    cells.push(this.clearLine(goalC, to) ? { ...to } : goalC);

    // String pulling: keep only the waypoints needed to stay in line of sight.
    const out: Vec2[] = [];
    let anchor = from;
    let i = 0;
    while (i < cells.length) {
      let far = i;
      for (let k = Math.min(cells.length - 1, i + 24); k > i; k--) {
        if (this.clearLine(anchor, cells[k])) {
          far = k;
          break;
        }
      }
      out.push(cells[far]);
      anchor = cells[far];
      i = far + 1;
    }
    return out;
  }
}
