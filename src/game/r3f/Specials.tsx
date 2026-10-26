import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';

import { FACTIONS, MEGA_FLAME_COLOR } from '@/game/core/factions';
import type { ViewState } from '@/game/session/types';
import { makeSpiritMaterial, SPIRIT_TIME, useSpiritModel } from './spirit';
import { MagicCircle } from './fx/Atmosphere';
import { runeTexture } from './fx/fxTextures';
import { PROPS } from './props/catalog';
import { PropMesh } from './props/PropSet';

const PROJECTILE_POOL = 12;
const FIELD_POOL = 8;
const BONE_LENGTH = 1.15;
/** Lifts the bone model so it spins about its middle. */
const BONE_CENTER = (BONE_LENGTH / PROPS.bone_projectile.size[0]) * PROPS.bone_projectile.size[1] * 0.5;

interface Props {
  view: RefObject<ViewState | null>;
  yaw: RefObject<number>;
}

/** Mega-Flame, Magic Pumpkin, Bone Toss projectiles and Grave Grasp fields. */
export function Specials({ view, yaw }: Props) {
  return (
    <group>
      <MegaFlame view={view} yaw={yaw} />
      <MagicPumpkin view={view} />
      <Bones view={view} />
      <Fields view={view} />
    </group>
  );
}

function MegaFlame({ view, yaw }: Props) {
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const mega = useSpiritModel('mega_spirit', 0.9);
  const megaMat = useMemo(() => makeSpiritMaterial(mega, { color: MEGA_FLAME_COLOR, mood: 'nervous', seed: 0.37 }), [mega]);
  useEffect(() => () => megaMat.dispose(), [megaMat]);
  // Smooth state: how scared it is, where it's glancing, and running phases (so speeding
  // up when scared never makes the wobble jump).
  const mood = useRef({ panic: 0, glance: 0, target: 0, nextGlance: 0, bob: 0, pulse: 0, shiver: 0 });
  useFrame((rs, delta) => {
    const v = view.current;
    const g = group.current;
    const l = light.current;
    if (!v || !g || !l) return;
    const m = v.megas[0];
    g.visible = !!m;
    // The light stays in the scene (just dark) so the light count, and every lit
    // shader, never changes when a Mega-Spirit comes and goes.
    l.intensity = 0;
    if (!m) return;
    const dt = Math.min(delta, 0.1);
    const t = rs.clock.elapsedTime;
    SPIRIT_TIME.value = t;
    // A nervous wreck: it shivers, glances about, and panics as someone gets close.
    let near = Infinity;
    for (const p of v.players) if (!p.left) near = Math.min(near, Math.hypot(p.x - m.x, p.z - m.z));
    const s = mood.current;
    s.panic += (Math.max(0, Math.min(1, 1 - (near - 3) / 7)) - s.panic) * (1 - Math.exp(-dt * 3));
    if (t >= s.nextGlance) {
      s.target = (Math.random() * 2 - 1) * (0.35 + s.panic * 0.3);
      s.nextGlance = t + 0.5 + Math.random() * (1.2 - s.panic * 0.7);
    }
    s.glance += (s.target - s.glance) * (1 - Math.exp(-dt * 7));
    s.bob += dt * (5 + s.panic * 4);
    s.pulse += dt * (7 + s.panic * 6);
    s.shiver += dt * 13;
    g.position.set(m.x, 1.1 + Math.sin(s.bob) * 0.15, m.z);
    g.rotation.set(0, (yaw.current ?? 0) + s.glance, Math.sin(t * 2.3) * 0.06 + Math.sin(s.shiver) * 0.035 * (0.4 + s.panic));
    g.scale.setScalar(1 + Math.sin(s.pulse) * 0.05);
    l.position.set(m.x, 1.1, m.z);
    l.intensity = 6 + Math.sin(t * 10) * 1.5;
  }, -1);
  return (
    <>
      <group ref={group} visible={false}>
        {/* The Mega-Spirit model wears its own worried face. */}
        <mesh geometry={mega.geometry} material={megaMat} />
      </group>
      <pointLight ref={light} color={MEGA_FLAME_COLOR} intensity={0} distance={10} decay={2} />
    </>
  );
}

function MagicPumpkin({ view }: { view: RefObject<ViewState | null> }) {
  const group = useRef<THREE.Group>(null);
  const circle = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame((rs) => {
    const v = view.current;
    const g = group.current;
    if (!v || !g) return;
    g.visible = v.pumpkin.available;
    // Always in the scene (dark while hidden): see MegaFlame.
    if (light.current) {
      light.current.intensity = v.pumpkin.available ? 9 : 0;
      light.current.position.set(v.pumpkin.x, 1.4, v.pumpkin.z);
    }
    if (circle.current) {
      circle.current.visible = v.pumpkin.available;
      circle.current.position.set(v.pumpkin.x, 0, v.pumpkin.z);
    }
    if (!g.visible) return;
    const t = rs.clock.elapsedTime;
    g.position.set(v.pumpkin.x, 0.4 + Math.sin(t * 2.2) * 0.25, v.pumpkin.z);
    g.rotation.y = t * 0.9;
  }, -1);
  return (
    <>
      <group ref={circle} visible={false}>
        <MagicCircle radius={2.8} color="#ff9a2a" speed={0.6} opacity={0.75} y={0.07} />
      </group>
      <group ref={group} visible={false}>
        <PropMesh name="magic_pumpkin" height={1.7} />
      </group>
      <pointLight ref={light} color="#ff8c1a" intensity={0} distance={12} decay={2} />
    </>
  );
}

function Bones({ view }: { view: RefObject<ViewState | null> }) {
  const meshes = useRef<(THREE.Group | null)[]>([]);
  useFrame((rs) => {
    const v = view.current;
    if (!v) return;
    const t = rs.clock.elapsedTime;
    for (let i = 0; i < PROJECTILE_POOL; i++) {
      const g = meshes.current[i];
      if (!g) continue;
      const p = v.projectiles[i];
      g.visible = !!p;
      if (!p) continue;
      g.position.set(p.x, 1.1, p.z);
      // Thrown end over end, flat like a boomerang.
      g.rotation.set(0, t * 18, 0);
    }
  }, -1);
  return (
    <group>
      {Array.from({ length: PROJECTILE_POOL }, (_, i) => (
        <group
          key={i}
          visible={false}
          ref={(g) => {
            meshes.current[i] = g;
          }}
        >
          <PropMesh name="bone_projectile" width={BONE_LENGTH} position-y={-BONE_CENTER} shadows={false} />
        </group>
      ))}
    </group>
  );
}

function Fields({ view }: { view: RefObject<ViewState | null> }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  useFrame((rs) => {
    const v = view.current;
    if (!v) return;
    const t = rs.clock.elapsedTime;
    for (let i = 0; i < FIELD_POOL; i++) {
      const g = groups.current[i];
      if (!g) continue;
      const f = v.fields[i];
      g.visible = !!f;
      if (!f) continue;
      g.position.set(f.x, 0, f.z);
      g.scale.setScalar(f.radius);
      const disc = g.children[0] as THREE.Mesh;
      const mat = disc.material as THREE.MeshBasicMaterial;
      mat.color.set(FACTIONS[f.team].color);
      mat.opacity = Math.min(0.32, f.ttl * 0.4) * (0.85 + Math.sin(t * 6) * 0.15);
      // grasping hands burst up out of the ground and sink back; runes (last child) spin
      for (let k = 2; k < g.children.length - 1; k++) {
        const hand = g.children[k];
        hand.position.y = (-0.45 + Math.max(0, Math.sin(t * 5 + k * 1.7)) * 0.45) / f.radius;
      }
      const rune = g.children[g.children.length - 1];
      rune.rotation.z = -t * 0.8;
    }
  }, -1);
  const handAngles = useMemo(() => Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2), []);
  return (
    <group>
      {Array.from({ length: FIELD_POOL }, (_, i) => (
        <group
          key={i}
          visible={false}
          ref={(g) => {
            groups.current[i] = g;
          }}
        >
          <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
            <circleGeometry args={[1, 40]} />
            <meshBasicMaterial transparent opacity={0.3} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.06}>
            <ringGeometry args={[0.94, 1, 48]} />
            <meshBasicMaterial color="#4ade80" toneMapped={false} />
          </mesh>
          {/* Field scale is its radius, so the hands are sized in fractions of it. */}
          {handAngles.map((a, k) => (
            <PropMesh
              key={k}
              name="grasp_hand"
              height={0.17}
              position={[Math.cos(a) * (0.35 + (k % 3) * 0.2), 0, Math.sin(a) * (0.35 + (k % 3) * 0.2)]}
              rotation-y={Math.atan2(Math.cos(a), Math.sin(a))}
              shadows={false}
            />
          ))}
          <mesh rotation-x={-Math.PI / 2} position-y={0.07}>
            <planeGeometry args={[2, 2]} />
            <meshBasicMaterial
              map={runeTexture()}
              color="#a3e635"
              transparent
              opacity={0.75}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
