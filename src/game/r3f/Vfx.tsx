import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { onVfx, type VfxEvent } from '@/game/fx/bus';
import { glowTexture } from './fx/fxTextures';
import { useAssetTexture } from './mapAssets';

const MAX_PARTICLES = 1400;
const MAX_RINGS = 16;
const MAX_BEAMS = 6;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  /** Gravity multiplier (trails float, bursts fall). */
  grav: number;
  /** Stream particles home in on a target. */
  tx?: number;
  tz?: number;
  /** Sprite: soft glow, sparkle, flame lick or smoke puff. */
  look: Look;
}

type Look = 'glow' | 'spark' | 'flame' | 'smoke';
const LOOKS: Look[] = ['glow', 'spark', 'flame', 'smoke'];

interface Ring {
  x: number;
  z: number;
  life: number;
  max: number;
  radius: number;
  color: THREE.Color;
}

interface Beam {
  x: number;
  z: number;
  life: number;
  max: number;
  height: number;
  color: THREE.Color;
}

/**
 * Pooled particles (soft glows, sparkles, flame licks and smoke puffs; the last
 * three are generated sprites: public/textures/vfx_*.webp), shockwave rings and
 * light beams. Sprites are white on black and drawn additively in the particle's color.
 */
export function Vfx({ enabled }: { enabled: boolean }) {
  const parts = useRef<Particle[]>([]);
  const rings = useRef<Ring[]>([]);
  const beams = useRef<Beam[]>([]);
  const meshes = useRef<Record<Look, THREE.InstancedMesh | null>>({ glow: null, spark: null, flame: null, smoke: null });
  const ringMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const beamMeshes = useRef<(THREE.Mesh | null)[]>([]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const sparkle = useAssetTexture('vfx_sparkle', 1, 1, 'clamp');
  const flame = useAssetTexture('vfx_flame', 1, 1, 'clamp');
  const smoke = useAssetTexture('vfx_smoke', 1, 1, 'clamp');
  const res = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const mk = (map: THREE.Texture) =>
      new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mats: Record<Look, THREE.MeshBasicMaterial> = { glow: mk(glowTexture()), spark: mk(sparkle), flame: mk(flame), smoke: mk(smoke) };
    // The sparkle art rings its star with a halo, and a burst of rings reads as bubbles: fade each
    // sparkle out from its centre so the star stays bright and the ring is only a faint glow.
    mats.spark.alphaMap = glowTexture();
    return { quad, mats };
  }, [sparkle, flame, smoke]);
  useEffect(
    () => () => {
      res.quad.dispose();
      for (const m of Object.values(res.mats)) m.dispose();
    },
    [res],
  );

  useEffect(() => {
    if (!enabled) return;
    return onVfx((e: VfxEvent) => {
      const list = parts.current;
      if (e.kind === 'ring') {
        if (rings.current.length >= MAX_RINGS) rings.current.shift();
        rings.current.push({ x: e.x, z: e.z, life: 0, max: 0.6, radius: e.radius, color: new THREE.Color(e.color) });
        return;
      }
      if (e.kind === 'beam') {
        if (beams.current.length >= MAX_BEAMS) beams.current.shift();
        beams.current.push({ x: e.x, z: e.z, life: 0, max: 0.9, height: e.height, color: new THREE.Color(e.color) });
        return;
      }
      col.set(e.color);
      if (e.kind === 'burst') {
        const speed = e.speed ?? 4;
        for (let i = 0; i < e.count && list.length < MAX_PARTICLES; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = speed * (0.4 + Math.random() * 0.6);
          list.push({
            x: e.x,
            y: e.y ?? 0.6,
            z: e.z,
            vx: Math.cos(a) * s,
            vy: 2 + Math.random() * speed,
            vz: Math.sin(a) * s,
            life: 0,
            max: 0.5 + Math.random() * 0.6,
            size: 0.35 + Math.random() * 0.45,
            r: col.r,
            g: col.g,
            b: col.b,
            grav: e.look === 'smoke' ? 0.25 : 1,
            look: i % 3 === 0 ? 'spark' : (e.look ?? 'glow'),
          });
        }
      } else if (e.kind === 'stream') {
        for (let i = 0; i < e.count && list.length < MAX_PARTICLES; i++) {
          list.push({
            x: e.fromX + (Math.random() - 0.5) * 1.5,
            y: e.y ?? 0.6,
            z: e.fromZ + (Math.random() - 0.5) * 1.5,
            vx: (Math.random() - 0.5) * 4,
            vy: 4 + Math.random() * 3,
            vz: (Math.random() - 0.5) * 4,
            life: -i * 0.015,
            max: 0.7,
            size: 0.55,
            r: col.r,
            g: col.g,
            b: col.b,
            grav: 1,
            tx: e.toX,
            tz: e.toZ,
            look: i % 2 === 0 ? 'spark' : 'glow',
          });
        }
      } else if (e.kind === 'trail') {
        const spread = e.spread ?? 0.6;
        for (let i = 0; i < e.count && list.length < MAX_PARTICLES; i++) {
          list.push({
            x: e.x + (Math.random() - 0.5) * spread,
            y: (e.y ?? 0.8) + (Math.random() - 0.5) * spread,
            z: e.z + (Math.random() - 0.5) * spread,
            vx: (Math.random() - 0.5) * 0.6,
            vy: e.rise ?? 0.8,
            vz: (Math.random() - 0.5) * 0.6,
            life: 0,
            max: 0.45 + Math.random() * 0.35,
            size: (e.size ?? 0.5) * (0.7 + Math.random() * 0.6),
            r: col.r,
            g: col.g,
            b: col.b,
            grav: -0.1,
            look: Math.random() < (e.look ? 0.15 : 0.3) ? 'spark' : (e.look ?? 'glow'),
          });
        }
      }
    });
  }, [enabled, col]);

  useFrame((rs, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const ms = meshes.current;
    if (!ms.glow || !ms.spark || !ms.flame || !ms.smoke) return;
    const camQ = rs.camera.quaternion;
    const list = parts.current;
    const n: Record<Look, number> = { glow: 0, spark: 0, flame: 0, smoke: 0 };
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.max) {
        // Swap-remove (order doesn't matter for additive sprites): splice shifted
        // every later particle, quadratic when a big burst dies at once.
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      if (p.life < 0) continue;
      if (p.tx !== undefined && p.tz !== undefined) {
        const k = Math.min(1, dt * 7);
        p.vx += ((p.tx - p.x) * 6 - p.vx) * k;
        p.vz += ((p.tz - p.z) * 6 - p.vz) * k;
        p.vy -= 9 * dt;
      } else {
        p.vy -= 9.5 * p.grav * dt;
        p.vx *= 1 - dt * 1.5;
        p.vz *= 1 - dt * 1.5;
      }
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      const fade = 1 - p.life / p.max;
      dummy.position.set(p.x, p.y, p.z);
      dummy.quaternion.copy(camQ);
      // Smoke billows out as it fades; everything else shrinks away.
      const grow = p.look === 'smoke' ? 0.7 + (1 - fade) * 1.1 : 0.35 + fade * 0.65;
      dummy.scale.setScalar(p.size * grow * (p.look === 'spark' ? 1.6 : p.look === 'flame' ? 1.4 : 1));
      dummy.updateMatrix();
      col.setRGB(p.r * fade, p.g * fade, p.b * fade);
      const m = ms[p.look]!;
      m.setMatrixAt(n[p.look], dummy.matrix);
      m.setColorAt(n[p.look], col);
      n[p.look]++;
    }
    for (const look of LOOKS) {
      const m = ms[look]!;
      m.count = n[look];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    const rl = rings.current;
    for (let i = rl.length - 1; i >= 0; i--) {
      rl[i].life += dt;
      if (rl[i].life >= rl[i].max) rl.splice(i, 1);
    }
    for (let i = 0; i < MAX_RINGS; i++) {
      const rm = ringMeshes.current[i];
      if (!rm) continue;
      const r = rl[i];
      rm.visible = !!r;
      if (!r) continue;
      const k = r.life / r.max;
      rm.position.set(r.x, 0.08, r.z);
      rm.scale.setScalar(0.2 + k * r.radius);
      const mat = rm.material as THREE.MeshBasicMaterial;
      mat.color.copy(r.color);
      mat.opacity = (1 - k) * 0.85;
    }

    const bl = beams.current;
    for (let i = bl.length - 1; i >= 0; i--) {
      bl[i].life += dt;
      if (bl[i].life >= bl[i].max) bl.splice(i, 1);
    }
    for (let i = 0; i < MAX_BEAMS; i++) {
      const bm = beamMeshes.current[i];
      if (!bm) continue;
      const b = bl[i];
      bm.visible = !!b;
      if (!b) continue;
      const k = b.life / b.max;
      const grow = Math.min(1, k * 5);
      bm.position.set(b.x, (b.height * grow) / 2, b.z);
      bm.scale.set(1.2 + k * 1.5, b.height * grow, 1.2 + k * 1.5);
      const mat = bm.material as THREE.MeshBasicMaterial;
      mat.color.copy(b.color);
      mat.opacity = (1 - k) * 0.55;
    }
  });

  const initColors = (m: THREE.InstancedMesh | null) => {
    if (m && !m.instanceColor) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3).fill(1), 3);
    }
  };

  return (
    <group>
      {LOOKS.map((look) => (
        <instancedMesh
          key={look}
          ref={(m) => {
            meshes.current[look] = m;
            initColors(m);
          }}
          args={[res.quad, res.mats[look], MAX_PARTICLES]}
          frustumCulled={false}
        />
      ))}
      {Array.from({ length: MAX_RINGS }, (_, i) => (
        <mesh
          key={i}
          visible={false}
          rotation-x={-Math.PI / 2}
          ref={(r) => {
            ringMeshes.current[i] = r;
          }}
        >
          <ringGeometry args={[0.85, 1, 48]} />
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
      {Array.from({ length: MAX_BEAMS }, (_, i) => (
        <mesh
          key={`b${i}`}
          visible={false}
          ref={(r) => {
            beamMeshes.current[i] = r;
          }}
        >
          <cylinderGeometry args={[0.6, 1, 1, 24, 1, true]} />
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
}
