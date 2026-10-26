import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';

import * as C from '@/game/core/constants';
import { FACTIONS, FLAME_COLOR } from '@/game/core/factions';
import { forEachSpirit } from '@/game/core/movement';
import type { ViewState } from '@/game/session/types';
import { glowTexture } from './fx/fxTextures';
import { makeSpiritMaterial, SPIRIT_TIME, spiritSeed, useSpiritModel } from './spirit';

const MAX_CARRIED_RENDER = 1600;
const MAX_PER_PLAYER = 120;

interface Props {
  view: RefObject<ViewState | null>;
  yaw: RefObject<number>;
}

export function Flames({ view, yaw }: Props) {
  const loose = useRef<THREE.InstancedMesh>(null);
  const carried = useRef<THREE.InstancedMesh>(null);
  const looseSpirit = useSpiritModel('spirit', 0.34);
  const carriedSpirit = useSpiritModel('spirit', 0.27);

  const res = useMemo(() => {
    // Loose spirits look about calmly; carried ones are happy (tinted per team by instance color).
    const looseMat = makeSpiritMaterial(looseSpirit, { color: FLAME_COLOR, mood: 'calm', instanced: true });
    const carriedMat = makeSpiritMaterial(carriedSpirit, { color: '#ffffff', mood: 'happy', instanced: true });
    // Each spirit's own flicker/blink phase, stable while it lives.
    looseSpirit.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(C.MAX_LOOSE_FLAMES), 1));
    carriedSpirit.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARRIED_RENDER), 1));
    // Soft additive halos (camera-facing) make spirits read as lights in the dark.
    const haloGeo = new THREE.PlaneGeometry(1, 1);
    const haloMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      color: FLAME_COLOR,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const haloTeamMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    return { looseMat, carriedMat, haloGeo, haloMat, haloTeamMat };
  }, [looseSpirit, carriedSpirit]);

  useEffect(
    () => () => {
      Object.values(res).forEach((r) => r.dispose());
    },
    [res],
  );

  const looseHalo = useRef<THREE.InstancedMesh>(null);
  const carriedHalo = useRef<THREE.InstancedMesh | null>(null);
  const halo = useMemo(() => new THREE.Object3D(), []);
  const dummy = useMemo(() => {
    const o = new THREE.Object3D();
    o.rotation.order = 'YXZ';
    return o;
  }, []);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  /** Smoothed render positions of loose spirits, by id. */
  const looseRendered = useRef(new Map<number, { x: number; z: number }>());
  const looseSeen = useRef(new Set<number>());
  /** Smoothed render positions per player (spirits glide instead of snapping). */
  const smooth = useRef(new Map<string, { xs: Float32Array; zs: Float32Array; n: number }>());
  const head = useMemo(() => ({ x: 0, z: 0 }), []);

  useFrame((rs, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const v = view.current;
    if (!v) return;
    const t = rs.clock.elapsedTime;
    SPIRIT_TIME.value = t;
    const face = yaw.current ?? 0;
    const fwdX = Math.sin(face);
    const fwdZ = Math.cos(face);
    halo.quaternion.copy(rs.camera.quaternion);

    // Loose spirits: bob, sway, pulse, and perk up when someone comes close:
    // they hop on the spot and lean toward them ("pick me!"). Rendered
    // positions ease toward the sim positions so spirits pulled by a magnet
    // glide (snapshots arrive at 20 Hz).
    const lm = loose.current;
    if (lm) {
      const seeds = lm.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute;
      const n = Math.min(v.flames.length, C.MAX_LOOSE_FLAMES);
      const ease = 1 - Math.exp(-dt * 16);
      const seen = looseSeen.current;
      seen.clear();
      for (let i = 0; i < n; i++) {
        const f = v.flames[i];
        let r = looseRendered.current.get(f.id);
        if (!r) {
          r = { x: f.pos.x, z: f.pos.z };
          looseRendered.current.set(f.id, r);
        } else {
          r.x += (f.pos.x - r.x) * ease;
          r.z += (f.pos.z - r.z) * ease;
        }
        seen.add(f.id);
        // Nearest player within reach makes the spirit excited.
        let near = Infinity;
        let nx = 0;
        let nz = 0;
        for (const p of v.players) {
          if (p.left) continue;
          const d = Math.hypot(p.x - r.x, p.z - r.z);
          if (d < near) {
            near = d;
            nx = (p.x - r.x) / (d || 1);
            nz = (p.z - r.z) / (d || 1);
          }
        }
        const excite = Math.max(0, Math.min(1, 1 - (near - 2.5) / 5));
        const hop = Math.abs(Math.sin(t * 9 + f.id)) * 0.38 * excite;
        dummy.position.set(r.x, 0.55 + Math.sin(t * 3 + f.id) * 0.12 + hop, r.z);
        // Face the camera; tilt toward the player (YXZ: lean in the spirit's own frame).
        const lean = 0.35 * excite;
        dummy.rotation.set((nx * fwdX + nz * fwdZ) * lean, face + Math.sin(t * 2 + f.id) * 0.25, -(nx * fwdZ - nz * fwdX) * lean + Math.sin(t * 4 + f.id) * 0.08);
        const pulse = 1 + Math.sin(t * 5 + f.id) * 0.08;
        const squash = 1 + Math.sin(t * 18 + f.id * 2) * 0.1 * excite;
        dummy.scale.set(pulse / Math.sqrt(squash), pulse * squash, pulse / Math.sqrt(squash));
        dummy.updateMatrix();
        lm.setMatrixAt(i, dummy.matrix);
        seeds.setX(i, spiritSeed(f.id));
        halo.position.copy(dummy.position);
        halo.position.y += 0.1;
        halo.scale.setScalar(1.9 + Math.sin(t * 4 + f.id) * 0.25);
        halo.updateMatrix();
        looseHalo.current?.setMatrixAt(i, halo.matrix);
      }
      lm.count = n;
      seeds.needsUpdate = true;
      if (looseHalo.current) {
        looseHalo.current.count = n;
        looseHalo.current.instanceMatrix.needsUpdate = true;
      }
      lm.instanceMatrix.needsUpdate = true;
      if (looseRendered.current.size > n + 32) {
        for (const id of looseRendered.current.keys()) if (!seen.has(id)) looseRendered.current.delete(id);
      }
    }

    // Carried spirits: evenly spaced along each player's trail (by arc length,
    // measured from the rendered head), glowing in team color and happily
    // bouncing in a wave down the line.
    const cm = carried.current;
    if (cm) {
      const seeds = cm.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute;
      let pi = 0;
      let idx = 0;
      const follow = 1 - Math.exp(-dt * 24);
      for (const p of v.players) {
        if (p.left || p.carrying <= 0) {
          smooth.current.delete(p.id);
          continue;
        }
        let st = smooth.current.get(p.id);
        if (!st) {
          st = { xs: new Float32Array(MAX_PER_PLAYER), zs: new Float32Array(MAX_PER_PLAYER), n: 0 };
          smooth.current.set(p.id, st);
        }
        const s = st;
        const owner = pi++ * 131;
        tmpColor.set(FACTIONS[p.team].color);
        head.x = p.x;
        head.z = p.z;
        const n = Math.min(p.carrying, MAX_PER_PLAYER);
        s.n = forEachSpirit(p.trail, head, n, (k, x, z) => {
          if (idx >= MAX_CARRIED_RENDER) return true;
          if (k >= s.n || Math.abs(x - s.xs[k]) + Math.abs(z - s.zs[k]) > 6) {
            s.xs[k] = x; // new spirit (or teleport): start in place
            s.zs[k] = z;
          } else {
            s.xs[k] += (x - s.xs[k]) * follow;
            s.zs[k] += (z - s.zs[k]) * follow;
          }
          const wave = t * 6 - k * 0.6;
          dummy.position.set(s.xs[k], 0.5 + Math.abs(Math.sin(wave)) * 0.2, s.zs[k]);
          dummy.rotation.set(0, face, Math.sin(t * 5 - k * 0.5) * 0.12);
          // Squash a little at the bottom of each bounce.
          const squash = 1 + Math.cos(wave * 2) * 0.08;
          dummy.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
          dummy.updateMatrix();
          cm.setMatrixAt(idx, dummy.matrix);
          seeds.setX(idx, spiritSeed(owner + k));
          cm.setColorAt(idx, tmpColor);
          const ch = carriedHalo.current;
          if (ch) {
            halo.position.copy(dummy.position);
            halo.position.y += 0.08;
            halo.scale.setScalar(1.35);
            halo.updateMatrix();
            ch.setMatrixAt(idx, halo.matrix);
            ch.setColorAt(idx, tmpColor);
          }
          idx++;
        });
      }
      cm.count = idx;
      seeds.needsUpdate = true;
      const ch = carriedHalo.current;
      if (ch) {
        ch.count = idx;
        ch.instanceMatrix.needsUpdate = true;
        if (ch.instanceColor) ch.instanceColor.needsUpdate = true;
      }
      cm.instanceMatrix.needsUpdate = true;
      if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
    }
  }, -1);

  return (
    <group>
      <instancedMesh ref={loose} args={[looseSpirit.geometry, res.looseMat, C.MAX_LOOSE_FLAMES]} frustumCulled={false} />
      <instancedMesh
        ref={(m) => {
          carried.current = m;
          if (m && !m.instanceColor) {
            m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARRIED_RENDER * 3).fill(1), 3);
          }
        }}
        args={[carriedSpirit.geometry, res.carriedMat, MAX_CARRIED_RENDER]}
        frustumCulled={false}
      />
      <instancedMesh ref={looseHalo} args={[res.haloGeo, res.haloMat, C.MAX_LOOSE_FLAMES]} frustumCulled={false} />
      <instancedMesh
        ref={(m) => {
          carriedHalo.current = m;
          if (m && !m.instanceColor) {
            m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARRIED_RENDER * 3).fill(1), 3);
          }
        }}
        args={[res.haloGeo, res.haloTeamMat, MAX_CARRIED_RENDER]}
        frustumCulled={false}
      />
    </group>
  );
}
