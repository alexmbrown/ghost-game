// Keeps hands out of heads. Meshy's animation library is made for realistic
// proportions; on these big-headed cartoon characters the hands pass through
// the skull (head holds, cheers, throws). For every key of every clip we run
// forward kinematics, test elbow / wrist / fingertip against a sphere fitted to
// the head, and swing the upper arm away from the head just far enough to clear
// it. Frames where nothing penetrates are left untouched.

import type { Document, Node, AnimationChannel, AnimationSampler } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';

type Path = 'translation' | 'rotation' | 'scale';

interface Track {
  sampler: AnimationSampler;
  path: Path;
}

/** Linear (slerp for rotations) / step sampling of one channel at time t. */
function sample(tr: Track, t: number, out: number[]): number[] {
  const input = tr.sampler.getInput()!.getArray()!;
  const output = tr.sampler.getOutput()!.getArray()!;
  const n = tr.path === 'rotation' ? 4 : 3;
  const last = input.length - 1;
  let i = 0;
  if (t <= input[0]) i = 0;
  else if (t >= input[last]) i = last;
  else while (i < last && input[i + 1] < t) i++;
  const j = Math.min(i + 1, last);
  const span = input[j] - input[i];
  const k = span > 0 && tr.sampler.getInterpolation() !== 'STEP' ? Math.min(1, Math.max(0, (t - input[i]) / span)) : 0;
  if (n === 4) {
    const a = new Quaternion(output[i * 4], output[i * 4 + 1], output[i * 4 + 2], output[i * 4 + 3]);
    const b = new Quaternion(output[j * 4], output[j * 4 + 1], output[j * 4 + 2], output[j * 4 + 3]);
    a.slerp(b, k);
    out[0] = a.x;
    out[1] = a.y;
    out[2] = a.z;
    out[3] = a.w;
  } else {
    for (let c = 0; c < 3; c++) out[c] = output[i * 3 + c] * (1 - k) + output[j * 3 + c] * k;
  }
  return out;
}

const find = (doc: Document, re: RegExp) => doc.getRoot().listNodes().find((n) => re.test(n.getName()));

export interface HeadFixStats {
  clips: number;
  framesFixed: number;
  maxDegrees: number;
}

/**
 * Push arms out of the head in every clip. Needs Mixamo-style bone names
 * (Head, LeftArm/LeftForeArm/LeftHand, Right...), which Meshy's rig uses.
 */
export function keepHandsOutOfHead(doc: Document, margin = 1): HeadFixStats | null {
  const root = doc.getRoot();
  const head = find(doc, /^head$/i);
  const skinNode = root.listNodes().find((n) => n.getSkin());
  if (!head || !skinNode) return null;
  const skin = skinNode.getSkin()!;
  const joints = skin.listJoints();
  const ibmArr = skin.getInverseBindMatrices()!.getArray()!;
  const ibm = (j: number) => new Matrix4().fromArray(Array.from(ibmArr.slice(j * 16, j * 16 + 16)));

  // Head sphere in mesh (bind) space: vertices mostly weighted to the head chain.
  const headSet = new Set<number>();
  joints.forEach((j, i) => {
    for (let n: Node | null = j; n; n = n.getParentNode()) {
      if (n === head) {
        headSet.add(i);
        break;
      }
    }
  });
  const pts: Vector3[] = [];
  for (const prim of skinNode.getMesh()!.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')!;
    const jo = prim.getAttribute('JOINTS_0')!;
    const we = prim.getAttribute('WEIGHTS_0')!;
    const p: number[] = [];
    const js: number[] = [];
    const ws: number[] = [];
    for (let i = 0; i < pos.getCount(); i++) {
      jo.getElement(i, js);
      we.getElement(i, ws);
      let w = 0;
      for (let k = 0; k < 4; k++) if (headSet.has(js[k])) w += ws[k];
      if (w >= 0.5) pts.push(new Vector3(...pos.getElement(i, p)));
    }
  }
  if (pts.length < 20) return null;
  // Fit an ellipsoid in the head bone's own space (wide skulls are far from spheres):
  // per axis it spans the 2nd..98th percentile of the head's vertices (ignores stray
  // hat-brim / plume vertices but covers the whole skull).
  const headIbm = ibm(joints.indexOf(head));
  const local = pts.map((v) => v.clone().applyMatrix4(headIbm));
  const span = (xs: number[]) => {
    xs.sort((a, b) => a - b);
    return [xs[Math.floor(xs.length * 0.02)], xs[Math.floor(xs.length * 0.98)]];
  };
  const [x0, x1] = span(local.map((v) => v.x));
  const [y0, y1] = span(local.map((v) => v.y));
  const [z0, z1] = span(local.map((v) => v.z));
  const center = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const radii = new Vector3((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  /** < 1 when a ball of radius `pad` at p (head-bone space) overlaps the head ellipsoid. */
  const inside = (p: Vector3, pad: number) =>
    Math.hypot((p.x - center.x) / (radii.x + pad), (p.y - center.y) / (radii.y + pad), (p.z - center.z) / (radii.z + pad));
  const STEP = Math.PI / 180;
  const MAX = (70 * Math.PI) / 180;

  const stats: HeadFixStats = { clips: 0, framesFixed: 0, maxDegrees: 0 };
  for (const anim of root.listAnimations()) {
    const tracks = new Map<Node, Partial<Record<Path, Track>>>();
    for (const ch of anim.listChannels() as AnimationChannel[]) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath() as Path;
      if (!node || !ch.getSampler() || !['translation', 'rotation', 'scale'].includes(path)) continue;
      tracks.set(node, { ...(tracks.get(node) ?? {}), [path]: { sampler: ch.getSampler()!, path } });
    }

    // Local matrix of a node at time t (animated where a track exists, rest pose otherwise),
    // with optional rotation overrides for nodes we are correcting.
    const tmp: number[] = [];
    const localAt = (n: Node, t: number, over: Map<Node, Quaternion>) => {
      const tr = tracks.get(n);
      const pos = tr?.translation ? new Vector3(...sample(tr.translation, t, tmp).slice(0, 3)) : new Vector3(...n.getTranslation());
      const rot = over.get(n) ?? (tr?.rotation ? new Quaternion(...sample(tr.rotation, t, tmp).slice(0, 4)) : new Quaternion(...n.getRotation()));
      const scl = tr?.scale ? new Vector3(...sample(tr.scale, t, tmp).slice(0, 3)) : new Vector3(...n.getScale());
      return new Matrix4().compose(pos, rot, scl);
    };
    const worldAt = (n: Node, t: number, over: Map<Node, Quaternion>): Matrix4 => {
      const p = n.getParentNode();
      const local = localAt(n, t, over);
      return p ? worldAt(p, t, over).multiply(local) : local;
    };

    let fixedHere = 0;
    for (const side of ['Left', 'Right']) {
      const arm = find(doc, new RegExp(`^${side}Arm$`));
      const fore = find(doc, new RegExp(`^${side}ForeArm$`));
      const hand = find(doc, new RegExp(`^${side}Hand$`));
      const armTrack = arm && tracks.get(arm)?.rotation;
      if (!arm || !fore || !hand || !armTrack) continue;
      const times = armTrack.sampler.getInput()!.getArray()!;
      const out = armTrack.sampler.getOutput()!.getArray()!;
      const newRot = new Float32Array(out.length);
      newRot.set(out);
      let sideFixed = 0;
      /** Per-key correction, as a rotation pre-multiplied onto the arm's local rotation. */
      const corr: Quaternion[] = [];
      const angleOf = (q: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));

      for (let f = 0; f < times.length; f++) {
        const t = times[f];
        const over = new Map<Node, Quaternion>();
        const original = new Quaternion(out[f * 4], out[f * 4 + 1], out[f * 4 + 2], out[f * 4 + 3]);
        over.set(arm, original.clone());
        let total = 0;
        while (total < MAX) {
          const headW = worldAt(head, t, over);
          const toHeadSpace = headW.clone().invert();
          const armW = worldAt(arm, t, over);
          const shoulder = new Vector3().setFromMatrixPosition(armW);
          const elbow = new Vector3().setFromMatrixPosition(worldAt(fore, t, over));
          const handW = worldAt(hand, t, over);
          const wrist = new Vector3().setFromMatrixPosition(handW);
          const forearm = wrist.distanceTo(elbow);
          // Fingers run along the hand bone's +Y (Mixamo convention).
          const tip = wrist.clone().addScaledVector(new Vector3().setFromMatrixColumn(handW, 1).normalize(), forearm * 0.6);
          const mid = elbow.clone().lerp(wrist, 0.5);
          // Arm/hand thickness, in head-space units.
          const pad = elbow.clone().applyMatrix4(toHeadSpace).distanceTo(wrist.clone().applyMatrix4(toHeadSpace)) * 0.45;
          // The deepest point inside the (padded) head ellipsoid.
          let worst: Vector3 | null = null;
          let deepest = margin;
          for (const pt of [elbow, mid, wrist, tip]) {
            const d = inside(pt.clone().applyMatrix4(toHeadSpace), pad);
            if (d < deepest) {
              deepest = d;
              worst = pt;
            }
          }
          if (!worst) break;
          const headCenter = center.clone().applyMatrix4(headW);
          const toPt = worst.clone().sub(shoulder);
          const toHead = headCenter.sub(shoulder);
          const axis = new Vector3().crossVectors(toHead, toPt);
          if (axis.lengthSq() < 1e-12) axis.set(0, 0, 1);
          axis.normalize();
          // Swing the upper arm away from the head a few degrees at a time.
          const angle = STEP;
          total += angle;
          // World-space delta -> arm's local rotation: L' = Wp^-1 * D * Wp * L.
          const parentRot = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(worldAt(arm.getParentNode()!, t, over)));
          const delta = new Quaternion().setFromAxisAngle(axis, angle);
          const local = parentRot.clone().invert().multiply(delta).multiply(parentRot).multiply(over.get(arm)!);
          over.set(arm, local.normalize());
        }
        // corrected = C * original  =>  C = corrected * original^-1
        corr.push(over.get(arm)!.clone().multiply(original.clone().invert()));
        if (total > 0) stats.maxDegrees = Math.max(stats.maxDegrees, (total * 180) / Math.PI);
      }

      // Ease corrections in and out: take the strongest correction within ±2 keys
      // (so a peak is never under-corrected), then average over ±2 keys.
      const W = 2;
      const dilated = corr.map((_, f) => {
        let best = corr[f];
        for (let k = Math.max(0, f - W); k <= Math.min(corr.length - 1, f + W); k++) if (angleOf(corr[k]) > angleOf(best)) best = corr[k];
        return best;
      });
      for (let f = 0; f < corr.length; f++) {
        const acc = new Quaternion(0, 0, 0, 0);
        for (let k = Math.max(0, f - W); k <= Math.min(corr.length - 1, f + W); k++) {
          const q = dilated[k];
          const s = q.w * acc.w + q.x * acc.x + q.y * acc.y + q.z * acc.z < 0 ? -1 : 1;
          acc.set(acc.x + q.x * s, acc.y + q.y * s, acc.z + q.z * s, acc.w + q.w * s);
        }
        const c = acc.normalize();
        if (angleOf(c) < 1e-4) continue;
        const original = new Quaternion(out[f * 4], out[f * 4 + 1], out[f * 4 + 2], out[f * 4 + 3]);
        const q = c.multiply(original).normalize();
        newRot.set([q.x, q.y, q.z, q.w], f * 4);
        sideFixed++;
      }
      if (sideFixed) armTrack.sampler.getOutput()!.setArray(newRot);
      fixedHere += sideFixed;
    }
    if (fixedHere) {
      stats.clips++;
      stats.framesFixed += fixedHere;
    }
  }
  return stats;
}
