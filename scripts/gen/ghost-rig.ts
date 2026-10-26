// A small hand-made rig + animation set for the legless ghosts. Meshy only
// rigs bipeds, so the ghosts come back from Meshy as static meshes and get
// their skeleton, skin weights and clips here (scripts/gen/models.ts build).
//
// Skeleton (mesh faces +Z, Y up, base on the ground after `rigGhost`):
//   root ── body ─┬─ chest ─┬─ head
//                 │         ├─ armL (+X side)  └ armR (-X side)
//                 └─ hem0..hem5  (a ring near the bottom: the sheet / gown / tendrils)
//
// Weights come from the geometry itself: height bands decide body / chest /
// head, anything sticking out sideways past the body's typical radius at
// mid-height is an arm, and the bottom 40% follows the nearest two hem bones.
//
// Clips use the same names as the Meshy-rigged characters, so the game treats
// every character alike: idle, run, walk, cast, hit, stunned, victory, defeat, dance.

import type { Document, Node } from '@gltf-transform/core';
import { transformMesh } from '@gltf-transform/functions';

type V3 = [number, number, number];
type Q = [number, number, number, number];

const HEM_BONES = 6;
const FPS = 30;

// ---------- small math helpers ----------

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

function qMul(a: Q, b: Q): Q {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
function qAxis(axis: V3, angle: number): Q {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
/** Euler XYZ (radians) -> quaternion. */
function qEuler(x = 0, y = 0, z = 0): Q {
  return qMul(qMul(qAxis([0, 0, 1], z), qAxis([0, 1, 0], y)), qAxis([1, 0, 0], x));
}

// ---------- pose description ----------

/** One sampled pose: bone rotations (euler), root offset, body squash. */
interface Pose {
  root?: { y?: number; x?: number; ry?: number };
  body?: { rx?: number; ry?: number; rz?: number; squash?: number };
  chest?: { rx?: number; rz?: number };
  head?: { rx?: number; ry?: number; rz?: number };
  /**
   * Arm rotations are relative to the rest pose: arms held out ~30° below horizontal,
   * clear of the body (how the ghost concepts are posed). rz > 0 raises the left arm.
   */
  armL?: { ry?: number; rz?: number };
  armR?: { ry?: number; rz?: number };
  /** Per hem bone k: outward flutter (radians about the ring tangent) and backward trail. */
  hem?: (k: number) => { flutter: number; trail?: number };
}

interface ClipDef {
  name: string;
  duration: number;
  /** `t` in seconds, `w` = 2π / duration (loops repeat exactly), `h` = model height. */
  pose: (t: number, w: number, h: number) => Pose;
}

const flutter = (amp: number, speed: number, t: number) => (k: number) => ({ flutter: amp * Math.sin(speed * t + k * 1.1) });

export const GHOST_CLIPS: ClipDef[] = [
  {
    name: 'idle',
    duration: 2,
    pose: (t, w, h) => ({
      root: { y: 0.03 * h * Math.sin(w * t) },
      body: { rz: 0.04 * Math.sin(w * t) },
      chest: { rx: 0.03 * Math.sin(w * t + 1) },
      head: { rz: 0.06 * Math.sin(w * t + 0.5) },
      armL: { rz: -0.3 + 0.06 * Math.sin(w * t) },
      armR: { rz: -(-0.3 + 0.06 * Math.sin(w * t + 0.6)) },
      hem: flutter(0.12, 2 * w, t),
    }),
  },
  {
    name: 'run',
    duration: 0.8,
    pose: (t, w, h) => ({
      root: { y: 0.04 * h * Math.sin(2 * w * t) },
      body: { rx: 0.32 + 0.03 * Math.sin(2 * w * t), rz: 0.08 * Math.sin(w * t) },
      head: { rx: -0.15 },
      armL: { ry: 0.45 + 0.12 * Math.sin(w * t), rz: -0.15 },
      armR: { ry: -(0.45 + 0.12 * Math.sin(w * t + Math.PI)), rz: 0.15 },
      hem: (k) => ({ flutter: 0.25 * Math.sin(2 * w * t + k * 1.1), trail: 0.3 }),
    }),
  },
  {
    name: 'walk',
    duration: 1.2,
    pose: (t, w, h) => ({
      root: { y: 0.025 * h * Math.sin(2 * w * t) },
      body: { rx: 0.15 + 0.02 * Math.sin(2 * w * t), rz: 0.06 * Math.sin(w * t) },
      armL: { ry: 0.2 + 0.08 * Math.sin(w * t), rz: -0.25 },
      armR: { ry: -(0.2 + 0.08 * Math.sin(w * t + Math.PI)), rz: 0.25 },
      hem: (k) => ({ flutter: 0.15 * Math.sin(2 * w * t + k * 1.1), trail: 0.15 }),
    }),
  },
  {
    // Phase Dash / any ability: a full twirl with arms flung out and a stretch.
    name: 'cast',
    duration: 0.7,
    pose: (t, w) => {
      const k = t / (Math.PI * 2 / w);
      const s = Math.sin(Math.PI * k);
      return {
        root: { ry: ease(k) * Math.PI * 2 },
        body: { squash: 1 + 0.2 * s },
        armL: { rz: -0.3 + 0.75 * s },
        armR: { rz: -(-0.3 + 0.75 * s) },
        hem: (i) => ({ flutter: 0.35 * s * Math.sin(12 * k + i), trail: 0 }),
      };
    },
  },
  {
    name: 'hit',
    duration: 0.5,
    pose: (t, w) => {
      const k = t / (Math.PI * 2 / w);
      const s = Math.sin(Math.PI * k);
      return {
        body: { rz: 0.4 * Math.sin(7 * Math.PI * k) * (1 - k), squash: 1 - 0.15 * s },
        head: { rx: -0.3 * s },
        armL: { rz: -0.3 + 0.6 * s },
        armR: { rz: -(-0.3 + 0.6 * s) },
        hem: (i) => ({ flutter: 0.3 * s * Math.sin(20 * k + i) }),
      };
    },
  },
  {
    // Bonked by the Magic Pumpkin: dizzy head circles, slumped, arms limp.
    name: 'stunned',
    duration: 1.2,
    pose: (t, w) => ({
      body: { rz: 0.1 * Math.sin(w * t) },
      chest: { rx: 0.12 },
      head: { rx: 0.15 * Math.sin(w * t), rz: 0.15 * Math.cos(w * t) },
      armL: { rz: -0.6 },
      armR: { rz: 0.6 },
      hem: flutter(0.08, w, t),
    }),
  },
  {
    name: 'victory',
    duration: 1,
    pose: (t, w, h) => ({
      root: { y: 0.2 * h * (0.5 - 0.5 * Math.cos(w * t)) },
      body: { squash: 1 + 0.08 * Math.cos(w * t) },
      armL: { rz: 1.2 + 0.2 * Math.sin(2 * w * t) },
      armR: { rz: -(1.2 + 0.2 * Math.sin(2 * w * t + Math.PI)) },
      hem: (k) => ({ flutter: 0.2 * (0.5 - 0.5 * Math.cos(w * t)) + 0.08 * Math.sin(2 * w * t + k) }),
    }),
  },
  {
    // Played once and held on the last frame: a sad droop.
    name: 'defeat',
    duration: 2,
    pose: (t, _w, h) => {
      const p = ease(Math.min(1, t / 1.2));
      return {
        root: { y: -0.08 * h * p },
        body: { rx: 0.45 * p, squash: 1 - 0.08 * p },
        chest: { rx: 0.04 * p * Math.sin(t * 6) },
        head: { rx: 0.35 * p },
        armL: { rz: -0.3 - 0.4 * p },
        armR: { rz: 0.3 + 0.4 * p },
        hem: () => ({ flutter: -0.05 * p }),
      };
    },
  },
  {
    name: 'dance',
    duration: 1.6,
    pose: (t, w, h) => ({
      root: { x: 0.08 * h * Math.sin(w * t), ry: 0.3 * Math.sin(w * t) },
      body: { rz: 0.25 * Math.sin(w * t) },
      head: { rz: -0.15 * Math.sin(w * t) },
      armL: { rz: 0.15 + 0.45 * Math.sin(2 * w * t) },
      armR: { rz: -(0.15 + 0.45 * Math.sin(2 * w * t + Math.PI)) },
      hem: (k) => ({ flutter: 0.2 * Math.sin(2 * w * t - (k * Math.PI * 2) / HEM_BONES) }),
    }),
  },
];

// ---------- rig ----------

/**
 * Where a ghost's (left) arm is, as fractions of its height: x sideways (+X is
 * the character's left), y up from the base, z forward. The right arm mirrors it.
 * Ghost designs differ too much (mitten stubs, arms hanging beside a barrel body,
 * tiny arms among tendrils, hands clasped at the chest) to find arms
 * automatically, so each ghost states its own in the manifest (`params.arms`).
 */
export interface GhostArms {
  shoulder: V3;
  hand: V3;
  /** Capsule radius around the shoulder->hand line. */
  radius: number;
  /** The body's surface (|x|): nothing closer to the middle belongs to an arm. */
  minX: number;
  /**
   * How far from the shoulder->hand line the arm search may reach (fraction of height).
   * Defaults to 2.5 x radius; tighten it when a hand rests against a gown or body.
   */
  reach?: number;
}

/**
 * Turn a static ghost mesh into a skinned, animated one, in place: normalise it
 * to `height` (base on the ground, centred), build the skeleton, compute skin
 * weights, and add GHOST_CLIPS. `arms: null` = no arm motion (e.g. clasped hands).
 * Returns some stats for the build log.
 */
export function rigGhost(doc: Document, height: number, arms: GhostArms | null): { vertices: number; armShare: number; hemShare: number; armVerts: { L: number; R: number } } {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const meshNodes = root.listNodes().filter((n) => n.getMesh());
  if (meshNodes.length !== 1) throw new Error(`ghost rig expects one mesh node, found ${meshNodes.length}`);
  const meshNode = meshNodes[0];
  const mesh = meshNode.getMesh()!;

  // Bake the node transform, then normalise: base at y=0, centred, `height` tall.
  transformMesh(mesh, meshNode.getWorldMatrix());
  meshNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  const v: number[] = [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')!;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], v[k]);
        hi[k] = Math.max(hi[k], v[k]);
      }
    }
  }
  const s = height / (hi[1] - lo[1]);
  const cx = (lo[0] + hi[0]) / 2;
  const cz = (lo[2] + hi[2]) / 2;
  // prettier-ignore
  transformMesh(mesh, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cx * s, -lo[1] * s, -cz * s, 1]);
  const H = height;

  // Typical body radius per height band (median), to tell arms from body.
  const BANDS = 20;
  const radii: number[][] = Array.from({ length: BANDS }, () => []);
  const prims = mesh.listPrimitives();
  for (const prim of prims) {
    const pos = prim.getAttribute('POSITION')!;
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      const b = Math.min(BANDS - 1, Math.max(0, Math.floor((v[1] / H) * BANDS)));
      radii[b].push(Math.hypot(v[0], v[2]));
    }
  }
  const median = radii.map((r) => {
    if (!r.length) return 0;
    const sorted = [...r].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  });
  const bandMedian = (y: number) => median[Math.min(BANDS - 1, Math.max(0, Math.floor((y / H) * BANDS)))] || 1e-3;
  const shoulderR = bandMedian(0.5 * H);
  const hemR = Math.max(bandMedian(0.1 * H), 1e-3);

  // Arms: start at the hand and walk the mesh's own triangles outward, stopping at
  // the shoulder line (|x| = minX). Everything reached is the arm (the whole hand,
  // thumb and all, whatever its shape) and nothing on the body or hem, which only
  // connect back through the shoulder. A guessed shape (capsule) always left bits
  // of the hand behind. Weights blend over a thin band past the shoulder line and
  // are rigid beyond it, so the arm swings from the shoulder instead of bending.
  const toModel = (p: V3, sx: number): V3 => [sx * p[0] * H, p[1] * H, p[2] * H];
  const cut = (arms?.minX ?? 0) * H;
  const armMember = prims.map((prim) => new Uint8Array(prim.getAttribute('POSITION')!.getCount()));
  const armCount = { L: 0, R: 0 };
  if (arms) {
    prims.forEach((prim, pi) => {
      const pos = prim.getAttribute('POSITION')!;
      const count = pos.getCount();
      const P = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) P.set(pos.getElement(i, v), i * 3);
      // Weld by position: Meshy splits vertices along UV seams.
      const q = 1e-4 * H;
      const ids = new Map<string, number>();
      const weld = new Int32Array(count);
      for (let i = 0; i < count; i++) {
        const k = `${Math.round(P[i * 3] / q)},${Math.round(P[i * 3 + 1] / q)},${Math.round(P[i * 3 + 2] / q)}`;
        if (!ids.has(k)) ids.set(k, i);
        weld[i] = ids.get(k)!;
      }
      const members = new Map<number, number[]>();
      for (let i = 0; i < count; i++) members.set(weld[i], [...(members.get(weld[i]) ?? []), i]);
      const adj = new Map<number, Set<number>>();
      const link = (a: number, b: number) => {
        if (a === b) return;
        if (!adj.has(a)) adj.set(a, new Set());
        adj.get(a)!.add(b);
      };
      const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: count }, (_, i) => i);
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const [a, b, c] = [weld[idx[t]], weld[idx[t + 1]], weld[idx[t + 2]]];
        link(a, b);
        link(b, a);
        link(b, c);
        link(c, b);
        link(a, c);
        link(c, a);
      }
      for (const [side, sx] of [['L', 1], ['R', -1]] as const) {
        const hand = toModel(arms.hand, sx);
        const sh = toModel(arms.shoulder, sx);
        // Guard: stay near the arm, so a hand brushing hair or a gown doesn't flood into it.
        const reach = (arms.reach ?? 2.5 * arms.radius) * H;
        const nearArm = (i: number) => {
          const ab: V3 = [hand[0] - sh[0], hand[1] - sh[1], hand[2] - sh[2]];
          const ap: V3 = [P[i * 3] - sh[0], P[i * 3 + 1] - sh[1], P[i * 3 + 2] - sh[2]];
          const t = Math.min(1.5, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
          return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) <= reach;
        };
        let seed = -1;
        let best = Infinity;
        for (let i = 0; i < count; i++) {
          if (sx * P[i * 3] < cut) continue;
          const d = Math.hypot(P[i * 3] - hand[0], P[i * 3 + 1] - hand[1], P[i * 3 + 2] - hand[2]);
          if (d < best) {
            best = d;
            seed = weld[i];
          }
        }
        if (seed < 0) continue;
        const seen = new Set<number>([seed]);
        const queue = [seed];
        while (queue.length) {
          const cur = queue.pop()!;
          for (const nb of adj.get(cur) ?? []) {
            if (seen.has(nb) || sx * P[nb * 3] < cut || !nearArm(nb)) continue;
            seen.add(nb);
            queue.push(nb);
          }
        }
        for (const w of seen) for (const i of members.get(w) ?? []) armMember[pi][i] = sx > 0 ? 1 : 2;
        armCount[side] += seen.size;
      }
    });

    // The ghosts are posed symmetrically, so the two arms should come out about the
    // same size. If one side flooded much further (a hand resting on a gown), keep
    // only the part of it that mirrors the cleaner side's arm.
    const small = Math.min(armCount.L, armCount.R);
    if (small > 0 && Math.max(armCount.L, armCount.R) > small * 1.25) {
      const clean = armCount.L <= armCount.R ? 1 : 2;
      // Within a fraction of the arm's own thickness of a mirrored clean-arm vertex.
      const eps = 0.6 * arms.radius * H;
      const key = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
      const grid = new Map<string, V3[]>();
      prims.forEach((prim, pi) => {
        const pos = prim.getAttribute('POSITION')!;
        for (let i = 0; i < pos.getCount(); i++) {
          if (armMember[pi][i] !== clean) continue;
          const [x, y, z] = pos.getElement(i, v);
          const k = key(Math.floor(-x / eps), Math.floor(y / eps), Math.floor(z / eps)); // mirrored onto the other side
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push([-x, y, z]);
        }
      });
      const nearMirror = (x: number, y: number, z: number) => {
        const [cx, cy, cz] = [Math.floor(x / eps), Math.floor(y / eps), Math.floor(z / eps)];
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++)
              for (const p of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) if (Math.hypot(p[0] - x, p[1] - y, p[2] - z) <= eps) return true;
        return false;
      };
      let kept = 0;
      prims.forEach((prim, pi) => {
        const pos = prim.getAttribute('POSITION')!;
        for (let i = 0; i < pos.getCount(); i++) {
          if (!armMember[pi][i] || armMember[pi][i] === clean) continue;
          const [x, y, z] = pos.getElement(i, v);
          if (nearMirror(x, y, z)) kept++;
          else armMember[pi][i] = 0;
        }
      });
      armCount[clean === 1 ? 'R' : 'L'] = kept;
    }
  }
  /** Rigid arm weight for vertex i of primitive pi (0..1). */
  const armWeight = (pi: number, i: number, x: number) => (armMember[pi][i] ? smooth(cut, cut + 0.03 * H, Math.abs(x)) : 0);

  // Skeleton (translations only; bind pose has no rotations).
  const node = (name: string, t: V3, parent?: Node) => {
    const n = doc.createNode(name).setTranslation(t);
    if (parent) parent.addChild(n);
    return n;
  };
  const rootJ = node('ghost_root', [0, 0, 0]);
  const body = node('body', [0, 0.3 * H, 0], rootJ);
  const chest = node('chest', [0, 0.25 * H, 0], body);
  const head = node('head', [0, 0.2 * H, 0], chest);
  // Arm joints sit at the shoulders (chest is at 0.55 H).
  const shoulder = (side: 'L' | 'R'): V3 => {
    const sx = side === 'L' ? 1 : -1;
    if (!arms) return [sx * shoulderR, -0.05 * H, 0];
    const s = toModel(arms.shoulder, sx);
    return [s[0], s[1] - 0.55 * H, s[2]];
  };
  const armL = node('armL', shoulder('L'), chest);
  const armR = node('armR', shoulder('R'), chest);
  const hems: Node[] = [];
  for (let k = 0; k < HEM_BONES; k++) {
    const a = (k / HEM_BONES) * Math.PI * 2;
    hems.push(node(`hem${k}`, [Math.cos(a) * hemR * 0.6, -0.18 * H, Math.sin(a) * hemR * 0.6], body));
  }
  scene.addChild(rootJ);
  const joints = [rootJ, body, chest, head, armL, armR, ...hems];
  const J = { body: 1, chest: 2, head: 3, armL: 4, armR: 5, hem0: 6 };

  // Inverse bind matrices: joints only translate, so each is a pure -translation.
  const world = (n: Node): V3 => {
    const t = n.getTranslation();
    const p = n.getParentNode();
    if (!p) return [t[0], t[1], t[2]];
    const pw = world(p);
    return [pw[0] + t[0], pw[1] + t[1], pw[2] + t[2]];
  };
  const ibm = new Float32Array(joints.length * 16);
  joints.forEach((j, i) => {
    const w = world(j);
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1], i * 16);
  });
  const buffer = root.listBuffers()[0] ?? doc.createBuffer();
  const skin = doc.createSkin('ghost').setSkeleton(rootJ).setInverseBindMatrices(doc.createAccessor('ghost_ibm').setType('MAT4').setArray(ibm).setBuffer(buffer));
  joints.forEach((j) => skin.addJoint(j));
  meshNode.setSkin(skin);

  // Skin weights.
  let total = 0;
  let armSum = 0;
  let hemSum = 0;
  for (const [pi, prim] of prims.entries()) {
    const pos = prim.getAttribute('POSITION')!;
    const n = pos.getCount();
    const jointsArr = new Uint16Array(n * 4);
    const weightsArr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos.getElement(i, v);
      const [x, y, z] = v;
      const h = y / H;
      const r = Math.hypot(x, z);
      const arm = armWeight(pi, i, x);
      const hem = (1 - smooth(0.1, 0.4, h)) * smooth(0.1, 0.4, r / hemR);
      const headW = smooth(0.55, 0.75, h);
      const chestFrac = smooth(0.35, 0.6, h);

      const w = new Map<number, number>();
      const add = (j: number, x0: number) => x0 > 1e-4 && w.set(j, (w.get(j) ?? 0) + x0);
      add(x > 0 ? J.armL : J.armR, arm);
      const rest = 1 - arm;
      const angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
      const f = (angle / (Math.PI * 2)) * HEM_BONES;
      const i0 = Math.floor(f) % HEM_BONES;
      const i1 = (i0 + 1) % HEM_BONES;
      add(J.hem0 + i0, rest * hem * (1 - (f - Math.floor(f))));
      add(J.hem0 + i1, rest * hem * (f - Math.floor(f)));
      const core = rest * (1 - hem);
      add(J.head, core * headW);
      add(J.chest, core * (1 - headW) * chestFrac);
      add(J.body, core * (1 - headW) * (1 - chestFrac));

      const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((acc, [, x0]) => acc + x0, 0) || 1;
      top.forEach(([j, x0], k) => {
        jointsArr[i * 4 + k] = j;
        weightsArr[i * 4 + k] = x0 / sum;
      });
      if (!top.length) {
        jointsArr[i * 4] = J.body;
        weightsArr[i * 4] = 1;
      }
      total++;
      armSum += arm;
      hemSum += rest * hem;
    }
    prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(jointsArr).setBuffer(buffer));
    prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weightsArr).setBuffer(buffer));
  }

  // Clips.
  // Clip arm angles assume arms resting ~25° below horizontal. Ghosts whose arms rest
  // higher or lower get an offset so every ghost reaches the same poses (idle ~42° down,
  // victory ~27° up); the result is clamped so long arms don't over-stretch.
  const restAngle = arms ? Math.atan2(arms.hand[1] - arms.shoulder[1], arms.hand[0] - arms.shoulder[0]) : -REST;
  const armOffset = -REST - restAngle;
  for (const clip of GHOST_CLIPS) addClip(doc, buffer, clip, H, { rootJ, body, chest, head, armL, armR, hems }, armOffset);
  return { vertices: total, armShare: armSum / total, hemShare: hemSum / total, armVerts: armCount };
}

interface Bones {
  rootJ: Node;
  body: Node;
  chest: Node;
  head: Node;
  armL: Node;
  armR: Node;
  hems: Node[];
}

/** The rest pose the clip arm angles are written for: arms 25° below horizontal. */
const REST = (25 * Math.PI) / 180;
const ARM_MIN = -1.0;
const ARM_MAX = 1.3;
const lift = (rz: number | undefined, offset: number) => Math.min(ARM_MAX, Math.max(ARM_MIN, (rz ?? 0) + offset));

function addClip(doc: Document, buffer: ReturnType<Document['createBuffer']>, clip: ClipDef, H: number, b: Bones, armOffset: number): void {
  const frames = Math.round(clip.duration * FPS) + 1;
  const w = (Math.PI * 2) / clip.duration;
  const times = new Float32Array(frames);
  type Path = 'rotation' | 'translation' | 'scale';
  const tracks = new Map<string, { node: Node; path: Path; data: Float32Array<ArrayBuffer> }>();
  const track = (node: Node, path: Path) => {
    const key = `${node.getName()}:${path}`;
    let tr = tracks.get(key);
    if (!tr) {
      tr = { node, path, data: new Float32Array(frames * (path === 'rotation' ? 4 : 3)) };
      tracks.set(key, tr);
    }
    return tr;
  };
  const rest = (n: Node) => n.getTranslation();

  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / FPS);
    times[f] = t;
    const p = clip.pose(t, w, H);
    const r0 = rest(b.rootJ);
    track(b.rootJ, 'translation').data.set([r0[0] + (p.root?.x ?? 0), r0[1] + (p.root?.y ?? 0), r0[2]], f * 3);
    track(b.rootJ, 'rotation').data.set(qEuler(0, p.root?.ry ?? 0, 0), f * 4);
    track(b.body, 'rotation').data.set(qEuler(p.body?.rx, p.body?.ry, p.body?.rz), f * 4);
    const sq = p.body?.squash ?? 1;
    track(b.body, 'scale').data.set([1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)], f * 3);
    track(b.chest, 'rotation').data.set(qEuler(p.chest?.rx, 0, p.chest?.rz), f * 4);
    track(b.head, 'rotation').data.set(qEuler(p.head?.rx, p.head?.ry, p.head?.rz), f * 4);
    // Clips give the right arm as the mirror of the left (rz negated).
    track(b.armL, 'rotation').data.set(qEuler(0, p.armL?.ry, lift(p.armL?.rz, armOffset)), f * 4);
    track(b.armR, 'rotation').data.set(qEuler(0, p.armR?.ry, -lift(-(p.armR?.rz ?? 0), armOffset)), f * 4);
    b.hems.forEach((hem, k) => {
      const a = (k / HEM_BONES) * Math.PI * 2;
      const tangent: V3 = [-Math.sin(a), 0, Math.cos(a)];
      const { flutter: fl, trail = 0 } = p.hem?.(k) ?? { flutter: 0 };
      // Positive flutter swings the hanging hem outward; trail swings it backward (-Z).
      track(hem, 'rotation').data.set(qMul(qAxis([1, 0, 0], trail), qAxis(tangent, -fl)), f * 4);
    });
  }

  const anim = doc.createAnimation(clip.name);
  const input = doc.createAccessor(`${clip.name}_t`).setType('SCALAR').setArray(times).setBuffer(buffer);
  for (const { node: target, ...tr } of tracks.values()) {
    const output = doc
      .createAccessor()
      .setType(tr.path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(tr.data)
      .setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(tr.path).setSampler(sampler));
  }
}
