import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

import * as C from '@/game/core/constants';
import { FACTIONS } from '@/game/core/factions';
import { FX } from '@/game/core/movement';
import { onAnim } from '@/game/fx/bus';
import type { ViewPlayer } from '@/game/session/types';
import { modelFor } from './creatureModels';
import { Fire, type FireSpot } from './fx/Fire';
import { runeTexture } from './fx/fxTextures';

const RUSH_FLAMES: FireSpot[] = [
  { x: 0.55, y: 0.1, z: 0, scale: 1.5, color: '#ff5a1f' },
  { x: -0.55, y: 0.1, z: 0, scale: 1.5, color: '#ff5a1f' },
  { x: 0, y: 0.1, z: 0.55, scale: 1.3, color: '#ffb02a' },
  { x: 0, y: 0.1, z: -0.55, scale: 1.7, color: '#ff3a1a' },
];

interface Props {
  player: ViewPlayer;
  /** Round over: winners celebrate, everyone else sulks. */
  outcome: 'victory' | 'defeat' | null;
  /** Team-colored ring on the ground (off where something else marks the spot, e.g. menu pedestals). */
  groundRing?: boolean;
}

const RAINBOW = new THREE.Color();

/** Ghost hem flutter: vertices between `bottom` and `top` (mesh-local Y) ripple. */
interface HemWiggle {
  time: { value: number };
  top: number;
  bottom: number;
}

const HEM_VERTEX = /* glsl */ `#include <begin_vertex>
  float hem = 1.0 - smoothstep(uHem.x, uHem.y, position.y);
  float amp = 0.035 * (uHem.y - uHem.x) * hem;
  transformed.x += sin(uHemTime * 6.0 + position.z * 9.0 + position.x * 3.0) * amp;
  transformed.z += cos(uHemTime * 5.0 + position.x * 9.0) * amp;
  transformed.y += sin(uHemTime * 7.0 + position.x * 7.0 + position.z * 5.0) * amp * 0.6;`;

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/**
 * Team-colored Fresnel rim light: keeps characters readable against the night
 * scene and gives the stylized "cartoon" silhouette. Injected into the
 * standard material so lighting, skinning and emissive effects still work.
 * Static floaters also get a rippling hem (`wiggle`) in the vertex shader.
 */
function addRimLight(mat: THREE.MeshStandardMaterial, color: string, strength: number, wiggle?: HemWiggle): void {
  const rimColor = new THREE.Color(color);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
    shader.uniforms.rimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimDot = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
        totalEmissiveRadiance += rimColor * pow(rimDot, 2.2) * rimStrength;`,
      );
    if (wiggle) {
      shader.uniforms.uHemTime = wiggle.time;
      shader.uniforms.uHem = { value: new THREE.Vector2(wiggle.bottom, wiggle.top) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uHemTime;\nuniform vec2 uHem;')
        .replace('#include <begin_vertex>', HEM_VERTEX);
    }
  };
  // Uniform values are per material, so every rim material can share one program.
  mat.customProgramCacheKey = () => (wiggle ? 'creature-rim-hem' : 'creature-rim');
}

/**
 * One animated character. The OUTER group's transform (position/heading/
 * visibility) is driven by GameWorld; here we clone the model per player,
 * blend idle/move clips, play one-shot reactions (hit, ability cast), and show
 * status effects (dash ghosting, pumpkin rainbow, rush fire, slow, stagger).
 */
export function Creature({ player, outcome, groundRing = true }: Props) {
  const cfg = modelFor(player.character);
  const faction = FACTIONS[player.team];
  const { scene, animations } = useGLTF(cfg.url);
  /** No clips: animated in code (float, lean, waddle, squash, hem ripple). */
  const procedural = !cfg.clips;
  const hemTime = useMemo(() => ({ value: 0 }), []);

  // Clone hierarchy AND materials so per-player effects don't bleed across players.
  const { model, materials } = useMemo(() => {
    const m = cloneSkeleton(scene);
    const mats: THREE.MeshStandardMaterial[] = [];
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Skinned meshes cache a bind-pose bounding sphere; with these 100x-scaled
      // armatures it's offset, so frustum culling hid characters that were on
      // screen. ≤16 characters, so skipping the cull test is free.
      mesh.frustumCulled = false;
      const src = mesh.material as THREE.Material | THREE.Material[];
      let wiggle: HemWiggle | undefined;
      if (procedural && cfg.floats) {
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox!;
        wiggle = { time: hemTime, bottom: bb.min.y, top: bb.min.y + (bb.max.y - bb.min.y) * 0.4 };
      }
      const clone = (mat: THREE.Material) => {
        const c = mat.clone() as THREE.MeshStandardMaterial;
        // Always in the transparent pass (identical at full opacity) so ghosting on a
        // dash only changes opacity/depth writes: flipping `transparent` at runtime
        // built new shader variants and froze the frame (~0.4 s) the first time.
        c.transparent = true;
        addRimLight(c, faction.color, player.isLocal ? 0.9 : 0.65, wiggle);
        mats.push(c);
        return c;
      };
      mesh.material = Array.isArray(src) ? src.map(clone) : clone(src);
    });
    return { model: m, materials: mats };
  }, [scene, faction.color, player.isLocal, procedural, cfg.floats, hemTime]);
  const baseEmissive = useMemo(() => materials.map((m) => (m.emissive ? m.emissive.clone() : new THREE.Color(0))), [materials]);

  const animRoot = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, animRoot);
  const wasTransparent = useRef(false);
  const base = useRef<string | null>(null);
  const oneShotUntil = useRef(0);

  const bob = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  /** Procedural motion for clip-less models. */
  const proc = useRef<THREE.Group>(null);
  const shot = useRef<{ cue: 'hit' | 'cast'; start: number } | null>(null);
  const lean = useRef(0);
  const ring = useRef<THREE.Mesh>(null);
  const aura = useRef<THREE.Mesh>(null);
  const fire = useRef<THREE.Group>(null);
  const magnet = useRef<THREE.Mesh>(null);

  useEffect(() => {
    return () => {
      materials.forEach((m) => m.dispose());
    };
  }, [materials]);

  // Base loop: idle/move, or victory/defeat once the round is over.
  const setBase = (clip: string | undefined, loop = true) => {
    if (!clip || base.current === clip) return;
    const next = actions[clip];
    if (!next) return;
    const prev = base.current ? actions[base.current] : null;
    next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.fadeIn(0.2).play();
    prev?.fadeOut(0.2);
    base.current = clip;
  };

  useEffect(() => {
    base.current = null;
    setBase(cfg.clips?.idle);
    return () => {
      Object.values(actions).forEach((a) => a?.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, cfg.clips?.idle]);

  useEffect(() => {
    if (!outcome) return;
    setBase(outcome === 'victory' ? cfg.clips?.victory : cfg.clips?.defeat, outcome === 'victory');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  // One-shot reactions layered over the base loop.
  useEffect(() => {
    return onAnim(player.id, (cue) => {
      if (procedural) {
        shot.current = { cue, start: performance.now() };
        return;
      }
      const clip = cue === 'hit' ? cfg.clips?.hit : cfg.clips?.cast;
      const a = clip ? actions[clip] : null;
      if (!a) return;
      a.reset().setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = false;
      a.setEffectiveWeight(1);
      a.fadeIn(0.08).play();
      const dur = a.getClip().duration;
      oneShotUntil.current = performance.now() + dur * 1000 * 0.85;
      if (base.current) actions[base.current]?.fadeOut(0.08);
      const back = base.current;
      setTimeout(() => {
        a.fadeOut(0.2);
        if (back) actions[back]?.reset().fadeIn(0.2).play();
      }, dur * 1000 * 0.85);
    });
  }, [actions, cfg.clips?.cast, cfg.clips?.hit, player.id, procedural]);

  useFrame((rs, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = rs.clock.elapsedTime;
    const f = player.flags;
    const fast = f & (FX.DASH | FX.RUSH) ? 1.6 : f & (FX.BURST | FX.SPEED) ? 1.25 : f & FX.SLOWED ? 0.6 : 1;

    const stunClip = f & FX.STAGGER ? cfg.clips?.stunned : undefined;
    const slowClip = f & FX.SLOWED ? cfg.clips?.walk : undefined;
    if (!outcome && performance.now() > oneShotUntil.current) {
      setBase(stunClip ?? (player.moving ? (slowClip ?? cfg.clips?.move) : cfg.clips?.idle));
    }
    // Speed up run cycles with movement speed effects.
    if (base.current && base.current === cfg.clips?.move && actions[base.current]) {
      actions[base.current]!.timeScale = fast;
    }

    if (procedural && proc.current) {
      const moving = player.moving && !outcome;
      // Lean into movement (models face +Z, so +X rotation tips forward); slump on defeat.
      const want = moving ? 0.22 * fast : outcome === 'defeat' ? 0.35 : 0;
      lean.current += (want - lean.current) * Math.min(1, dt * 6);
      let ry = 0;
      let rz = moving ? Math.sin(t * 8 * fast) * 0.09 : Math.sin(t * 1.6) * 0.05;
      let sy = 1 + Math.sin(t * (moving ? 8 * fast : 3)) * (moving ? 0.04 : 0.025);
      let lift = 0;
      if (outcome === 'victory') {
        lift = Math.abs(Math.sin(t * 5)) * 0.5;
        ry = t * 2;
        sy = 1 + Math.sin(t * 10) * 0.06;
      } else if (outcome === 'defeat') {
        sy = 0.92;
        rz = Math.sin(t * 0.8) * 0.04;
      }
      // One-shots: a shake when hit, a twirl when casting.
      const s = shot.current;
      if (s) {
        const k = (performance.now() - s.start) / (s.cue === 'hit' ? 500 : 650);
        if (k >= 1) shot.current = null;
        else if (s.cue === 'hit') {
          rz += Math.sin(k * Math.PI * 7) * 0.4 * (1 - k);
          sy *= 1 - 0.15 * Math.sin(k * Math.PI);
        } else {
          ry += easeInOut(k) * Math.PI * 2;
          sy *= 1 + 0.2 * Math.sin(k * Math.PI);
        }
      }
      proc.current.rotation.set(lean.current, ry, rz);
      const sxz = 1 / Math.sqrt(sy);
      proc.current.scale.set(sxz, sy, sxz);
      proc.current.position.y = lift;
      hemTime.value += dt * (moving ? 1.8 * fast : 1);
    }

    if (bob.current) {
      bob.current.position.y = cfg.yOffset + (cfg.floats ? Math.sin(t * 2 + player.x * 0.3) * 0.12 : 0);
    }
    if (tilt.current) {
      // Stagger wobble (models without a stunned clip).
      tilt.current.rotation.z = f & FX.STAGGER && !stunClip ? Math.sin(t * 30) * 0.25 : 0;
    }

    // Materials: dash = ghosted, phase power = slightly see-through, pumpkin = rainbow glow, rush = hellfire.
    const opacity = f & FX.DASH ? 0.3 : f & FX.PHASE ? 0.75 : 1;
    const pumpkin = (f & FX.PUMPKIN) !== 0;
    const rush = (f & FX.RUSH) !== 0;
    if (pumpkin) RAINBOW.setHSL((t * 0.8) % 1, 1, 0.5);
    const transparent = opacity < 1;
    const toggled = transparent !== wasTransparent.current;
    wasTransparent.current = transparent;
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (toggled) m.depthWrite = !transparent;
      m.opacity = opacity;
      if (!m.emissive) continue;
      if (pumpkin) m.emissive.copy(RAINBOW).multiplyScalar(0.6);
      else if (rush) m.emissive.setRGB(0.9, 0.25, 0.05);
      else m.emissive.copy(baseEmissive[i]);
    }

    if (ring.current) {
      const mat = ring.current.material as THREE.MeshBasicMaterial;
      mat.color.set(f & FX.SLOWED ? '#4ade80' : player.isLocal ? faction.accent : faction.color);
    }
    if (aura.current) {
      const mat = aura.current.material as THREE.MeshBasicMaterial;
      const on = f & (FX.BURST | FX.PUMPKIN | FX.SPEED);
      mat.opacity = on ? 0.3 + Math.sin(t * 8) * 0.12 : 0;
      if (pumpkin) mat.color.copy(RAINBOW);
      else mat.color.set(f & FX.BURST ? '#ffffff' : '#ffd27a');
      aura.current.scale.setScalar(f & FX.BURST ? 1 + Math.sin(t * 16) * 0.08 : 1);
    }
    if (fire.current) fire.current.visible = rush;
    if (magnet.current) {
      magnet.current.visible = (f & FX.MAGNET) !== 0;
      magnet.current.rotation.z = -t * 0.5;
    }
  });

  return (
    <group>
      <group ref={bob}>
        <group ref={tilt}>
          <group ref={proc}>
            <group ref={animRoot} scale={cfg.scale} rotation-y={cfg.rotationOffset}>
              <primitive object={model} />
            </group>
          </group>
        </group>
      </group>

      {/* team-colored ground ring (local player gets a brighter, thicker ring); offset in depth
          so it never flickers against whatever it lies on (portal floors, pedestals) */}
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.05} visible={groundRing}>
        <ringGeometry args={[C.PLAYER_RADIUS + 0.15, C.PLAYER_RADIUS + (player.isLocal ? 0.5 : 0.36), 36]} />
        <meshBasicMaterial
          transparent
          opacity={player.isLocal ? 0.95 : 0.6}
          toneMapped={false}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      {/* status aura: steal burst / speed power / pumpkin */}
      <mesh ref={aura} rotation-x={-Math.PI / 2} position-y={0.06}>
        <ringGeometry args={[C.PLAYER_RADIUS + 0.6, C.PLAYER_RADIUS + 1.1, 32]} />
        <meshBasicMaterial color="#ffd27a" transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>

      {/* hellfire rush flames */}
      <group ref={fire} visible={false}>
        <Fire spots={RUSH_FLAMES} />
      </group>

      {/* magnet power: faint rune circle showing the pull radius */}
      <mesh ref={magnet} rotation-x={-Math.PI / 2} position-y={0.04} visible={false}>
        <planeGeometry args={[C.MAGNET_PULL_RADIUS * 2, C.MAGNET_PULL_RADIUS * 2]} />
        <meshBasicMaterial
          map={runeTexture()}
          color="#b48cff"
          transparent
          opacity={player.isLocal ? 0.22 : 0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
