'use client';

// Live 3D backdrop for the main menu and lobby: one pedestal per faction on a
// turntable, set in the map you've picked. Changing team turns the wheel (the
// short way round) to that faction, so characters travel along the circle
// and never pass through each other; changing character within a team swaps
// the figure on its pedestal. Purely presentational — no simulation.

import { Float, useProgress } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { startTransition, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { defaultCharacter } from '@/game/core/characters';
import { FACTIONS, FLAME_COLOR } from '@/game/core/factions';
import type { TeamId } from '@/game/core/types';
import { makeViewPlayer } from '@/game/session/common';
import type { ViewPlayer } from '@/game/session/types';
import { useAppStore } from '@/game/state/store';
import { Backdrop } from './Backdrop';
import { Creature } from './Creature';
import { makeSpiritMaterial, SPIRIT_TIME, useSpiritModel } from './spirit';
import { useAssetTexture } from './mapAssets';
import { themeFor, type MapTheme } from './mapThemes';
import { PostFX } from './PostFX';
import type { PropName } from './props/catalog';
import { PropMesh } from './props/PropSet';
import { useAdaptiveDpr } from './useAdaptiveDpr';

/** A pedestal per faction, a quarter turn apart. */
const STEP = (Math.PI * 2) / FACTIONS.length;
const RADIUS = 3.2;
/** The front pedestal sits here; the wheel turns about a point behind it. */
const FRONT_Z = 1;
const CENTER_Z = FRONT_Z - RADIUS;

export default function MenuScene({
  team,
  character,
  mapId,
  active = true,
}: {
  team: TeamId;
  character: string;
  mapId: string;
  active?: boolean;
}) {
  const quality = useAppStore((s) => s.settings.quality);
  const high = quality === 'high';
  const ready = useLoaded();
  const adaptive = useAdaptiveDpr(high);
  return (
    <div className={`menu-scene${ready ? ' is-ready' : ''}`} aria-hidden>
      <Canvas
        frameloop={active ? 'always' : 'never'}
        shadows={high}
        dpr={adaptive.dpr}
        camera={{ position: [0, 3, 12.5], fov: 34, near: 0.1, far: 200 }}
        gl={{ antialias: !high, powerPreference: 'high-performance' }}
      >
        {adaptive.monitor}
        <Scene team={team} character={character} mapId={mapId} />
        {high && <PostFX />}
      </Canvas>
    </div>
  );
}

/** True once the models queued so far have loaded (or after a few seconds regardless). */
function useLoaded(): boolean {
  const { active, loaded, total } = useProgress();
  const done = !active && loaded >= total;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    // A beat after the last model lands so the heroes are mounted before the fade.
    const t = setTimeout(() => setReady(true), done ? 200 : 8000);
    return () => clearTimeout(t);
  }, [done, ready]);
  return ready;
}

function Scene({ team, character, mapId }: { team: TeamId; character: string; mapId: string }) {
  // Dev-only debugging handle (stripped from production builds).
  const { gl, scene, camera, advance } = useThree();
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__menu = { gl, scene, camera, advance };
  }, [gl, scene, camera, advance]);

  // Switch maps as a transition: the old set stays up until the new one has loaded.
  const [shownMap, setShownMap] = useState(mapId);
  useEffect(() => {
    if (mapId !== shownMap) startTransition(() => setShownMap(mapId));
  }, [mapId, shownMap]);
  const theme = themeFor(shownMap);

  const look = useRef(new THREE.Vector3(0, 1.2, -0.5));
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  useFrame((rs, dt) => {
    // Gentle parallax.
    const k = 1 - Math.exp(-dt * 3);
    const cam = rs.camera;
    cam.position.x += (pointer.current.x * 0.9 - cam.position.x) * k;
    cam.position.y += (3 - pointer.current.y * 0.35 - cam.position.y) * k;
    cam.lookAt(look.current);
  });

  return (
    <group>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.fog.color, 14, 52]} />
      <hemisphereLight args={[theme.hemi.sky, theme.hemi.ground, 0.75]} />
      <ambientLight intensity={0.35} color={theme.ambient.color} />
      <directionalLight position={[-6, 10, 6]} intensity={1.1} color={theme.sun.color} castShadow shadow-mapSize={[1024, 1024]} />
      <spotLight position={[0, 7, 6]} angle={0.42} penumbra={0.8} intensity={60} color="#fff2dd" castShadow />
      {/* The front pedestal's faction glow (up and in front, so pale ghosts don't wash out). */}
      <pointLight position={[0, 3, FRONT_Z + 2.4]} color={FACTIONS[team].color} intensity={10} distance={8} decay={2} />

      <Suspense fallback={null}>
        <Backdrop theme={theme} />
        <Ground theme={theme} />
        <Decor mapId={shownMap} />
      </Suspense>

      <Suspense fallback={null}>
        <Wheel team={team} character={character} />
      </Suspense>

      <Suspense fallback={null}>
        <FloatingFlames />
      </Suspense>
    </group>
  );
}

function Ground({ theme }: { theme: MapTheme }) {
  const tex = useAssetTexture(theme.ground.texture, 80 / theme.ground.tile);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[40, 64]} />
      <meshStandardMaterial map={tex} color={theme.ground.tint} roughness={1} />
    </mesh>
  );
}

/** Shortest signed turn from angle a to angle b. */
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * The four factions on pedestals around a turntable. Your faction turns to the
 * front and its pedestal shows the character you picked; the others show their heroes.
 */
function Wheel({ team, character }: { team: TeamId; character: string }) {
  const stone = useAssetTexture('stone_wall', 3, 0.3);
  const players = useMemo<ViewPlayer[]>(
    () =>
      FACTIONS.map((f) =>
        makeViewPlayer(
          { id: `menu-${f.id}`, name: f.name, team: f.id, isBot: true, character: f.id === team ? character : defaultCharacter(f.id) },
          '',
          0,
          0,
          0,
        ),
      ),
    [team, character],
  );
  const angle = useRef(-team * STEP);
  const slots = useRef<(THREE.Group | null)[]>([]);
  const figures = useRef<(THREE.Group | null)[]>([]);
  const glows = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  // A pedestal that changes hands pops its new character in.
  const shown = useRef(players.map((p) => p.character));
  useEffect(() => {
    players.forEach((p, i) => {
      if (shown.current[i] === p.character) return;
      shown.current[i] = p.character;
      figures.current[i]?.scale.setScalar(0.35);
    });
  }, [players]);

  useFrame((rs, dt) => {
    // Ease toward your faction's pedestal along the shorter way round.
    angle.current += turn(angle.current, -team * STEP) * (1 - Math.exp(-dt * 4));
    const t = rs.clock.elapsedTime;
    players.forEach((_, i) => {
      const g = slots.current[i];
      if (!g) return;
      const a = i * STEP + angle.current;
      g.position.set(RADIUS * Math.sin(a), 0, CENTER_Z + RADIUS * Math.cos(a));
      // Face out from the wheel (so the front one faces the camera), with a little idle sway.
      g.rotation.y = a + Math.sin(t * 0.6 + i) * 0.12;
      const front = i === team;
      const s = front ? 1.15 : 0.9;
      g.scale.setScalar(g.scale.x + (s - g.scale.x) * (1 - Math.exp(-dt * 5)));
      const fig = figures.current[i];
      if (fig) fig.scale.setScalar(fig.scale.x + (1 - fig.scale.x) * (1 - Math.exp(-dt * 8)));
      const glow = glows.current[i];
      if (glow) glow.opacity = (front ? 0.8 : 0.32) + Math.sin(t * 3 + i) * 0.08;
    });
  });

  return (
    <group>
      {players.map((p, i) => (
        <group
          key={p.id}
          scale={0.9}
          ref={(g) => {
            slots.current[i] = g;
          }}
        >
          <mesh position-y={-0.05} receiveShadow castShadow>
            <cylinderGeometry args={[0.95, 1.08, 0.2, 32]} />
            <meshStandardMaterial map={stone} color="#8a84a8" roughness={0.9} />
          </mesh>
          {/* Lifted off the stone and offset in depth, so it can't flicker against it. */}
          <mesh rotation-x={-Math.PI / 2} position-y={0.075}>
            <ringGeometry args={[0.76, 0.95, 48]} />
            <meshBasicMaterial
              ref={(m) => {
                glows.current[i] = m;
              }}
              color={FACTIONS[p.team].color}
              transparent
              depthWrite={false}
              polygonOffset
              polygonOffsetFactor={-2}
              polygonOffsetUnits={-2}
              toneMapped={false}
            />
          </mesh>
          <group
            ref={(g) => {
              figures.current[i] = g;
            }}
          >
            <Suspense fallback={null}>
              <Creature key={p.character} player={p} outcome={i === team ? 'victory' : null} groundRing={false} />
            </Suspense>
          </group>
        </group>
      ))}
    </group>
  );
}

interface DecorItem {
  name: PropName;
  /** Position (x, z), height in world units, yaw; `y` lifts it off the ground. */
  at: [number, number];
  h: number;
  rot?: number;
  y?: number;
  float?: boolean;
}

/**
 * Each map's set dressing around (never on) the wheel: everything sits well
 * clear of the turntable (radius ~4.3 around (0, CENTER_Z)).
 */
const DECOR: Record<string, DecorItem[]> = {
  graveyard: [
    { name: 'gravestone_round', at: [-7.6, 0.2], h: 1.7, rot: 0.5 },
    { name: 'gravestone_cross', at: [8, -0.6], h: 1.8, rot: -0.4 },
    { name: 'gravestone_round', at: [-9.5, -6], h: 1.8, rot: 0.9 },
    { name: 'gravestone_cross', at: [9.4, -8.5], h: 1.9, rot: -0.9 },
    { name: 'jack_o_lantern', at: [-6.6, 2.6], h: 0.9, rot: 0.6 },
    { name: 'jack_o_lantern', at: [6.9, 2.2], h: 0.7, rot: -0.6 },
    { name: 'lamppost', at: [-10.5, -2.5], h: 3.4, rot: 1.2 },
    { name: 'lamppost', at: [10.8, -3.5], h: 3.4, rot: -1.2 },
    { name: 'dead_tree', at: [-8.5, -14], h: 5.5, rot: 0.4 },
    { name: 'dead_tree', at: [9.5, -15], h: 6, rot: 2 },
    { name: 'tomb_small', at: [-4.5, -16.5], h: 3.6, rot: 0.3 },
    { name: 'tomb_small', at: [4.8, -16], h: 3.2, rot: -0.3 },
  ],
  cornmaze: [
    { name: 'hay_bale', at: [-7.8, 0.4], h: 1.3, rot: 0.3 },
    { name: 'hay_bale', at: [8.2, -0.2], h: 1.2, rot: -0.5 },
    { name: 'pumpkin_patch', at: [-6.9, 2.6], h: 1, rot: 0.4 },
    { name: 'jack_o_lantern', at: [6.9, 2.4], h: 0.8, rot: -0.5 },
    { name: 'scarecrow', at: [-9.5, -5], h: 2.8, rot: 0.9 },
    { name: 'scarecrow', at: [9.8, -7], h: 2.8, rot: -0.9 },
    { name: 'corn_wall', at: [-6.5, -14.5], h: 3.2, rot: 0.35 },
    { name: 'corn_wall', at: [0, -16.5], h: 3.4, rot: 0 },
    { name: 'corn_wall', at: [6.5, -14.5], h: 3.2, rot: -0.35 },
    { name: 'wooden_cart', at: [11, -12], h: 2.4, rot: -0.8 },
    { name: 'windmill', at: [-15, -24], h: 13, rot: 0.5 },
    { name: 'barn', at: [17, -27], h: 10, rot: -0.6 },
  ],
  mansion: [
    { name: 'grandfather_clock', at: [-8, -1], h: 2.7, rot: 0.7 },
    { name: 'armchair', at: [8, -0.5], h: 1.4, rot: -0.7 },
    { name: 'armchair', at: [-9.5, -7], h: 1.4, rot: 1.1 },
    { name: 'dining_table', at: [9.8, -8], h: 1.7, rot: -1.2 },
    { name: 'mansion_wall', at: [-7.2, -15.5], h: 3.4, rot: 0.35 },
    { name: 'mansion_wall', at: [0, -17], h: 3.4, rot: 0 },
    { name: 'mansion_wall', at: [7.2, -15.5], h: 3.4, rot: -0.35 },
    { name: 'haunted_portrait', at: [0, -16.6], h: 1.6, y: 1.5 },
    { name: 'chandelier', at: [0, -7], h: 1.6, y: 6.2, float: true },
  ],
  forest: [
    { name: 'spooky_pine', at: [-8.5, -2], h: 6, rot: 0.3 },
    { name: 'spooky_pine', at: [9, -1], h: 6.5, rot: 1.2 },
    { name: 'spooky_pine', at: [-11, -9], h: 7, rot: 2 },
    { name: 'spooky_pine', at: [11, -11], h: 7.5, rot: 0.7 },
    { name: 'spooky_pine', at: [-5.5, -15.5], h: 8, rot: 1 },
    { name: 'spooky_pine', at: [5, -16.5], h: 7, rot: 2.5 },
    { name: 'spooky_pine', at: [0, -19.5], h: 9, rot: 0.2 },
    { name: 'mushrooms', at: [-6.8, 2.4], h: 0.9, rot: 0.5 },
    { name: 'mushrooms', at: [7, 2.1], h: 0.7, rot: -0.5 },
    { name: 'tree_stump', at: [9, -5.5], h: 1, rot: 0.3 },
    { name: 'boulder', at: [-9.8, -4.5], h: 1.2, rot: 0.8 },
    { name: 'mossy_log', at: [-7.8, -12], h: 1, rot: 0.6 },
  ],
  library: [
    { name: 'globe', at: [-7.6, 0.6], h: 1.5, rot: 0.6 },
    { name: 'reading_desk', at: [8.2, -0.4], h: 1.5, rot: -0.6 },
    { name: 'armchair', at: [-9.4, -4.5], h: 1.4, rot: 1 },
    { name: 'grandfather_clock', at: [10, -4], h: 2.7, rot: -1 },
    { name: 'bookshelf', at: [-11, -8], h: 3.6, rot: 0.9 },
    { name: 'bookshelf', at: [-7.8, -12.6], h: 3.6, rot: 0.55 },
    { name: 'bookshelf', at: [-2.7, -15.2], h: 3.6, rot: 0.17 },
    { name: 'bookshelf', at: [2.7, -15.2], h: 3.6, rot: -0.17 },
    { name: 'bookshelf', at: [7.8, -12.6], h: 3.6, rot: -0.55 },
    { name: 'bookshelf', at: [11, -8], h: 3.6, rot: -0.9 },
    { name: 'floating_book', at: [-6, -3], h: 0.35, y: 4.2, rot: 0.4, float: true },
    { name: 'floating_book', at: [6.5, -5], h: 0.35, y: 4.8, rot: 2.1, float: true },
    { name: 'floating_book', at: [-3, -11], h: 0.35, y: 5.4, rot: 1.2, float: true },
    { name: 'chandelier', at: [0, -7], h: 1.6, y: 6.2, float: true },
  ],
};

function Decor({ mapId }: { mapId: string }) {
  return (
    <group>
      {(DECOR[mapId] ?? DECOR.graveyard).map((d, i) => {
        const piece = <PropMesh name={d.name} height={d.h} position={[d.at[0], d.y ?? 0, d.at[1]]} rotation-y={d.rot ?? 0} />;
        return d.float ? (
          <Float key={i} speed={1.2 + (i % 3) * 0.3} floatIntensity={0.8} rotationIntensity={0.15}>
            {piece}
          </Float>
        ) : (
          <group key={i}>{piece}</group>
        );
      })}
    </group>
  );
}

/** A few spirits bobbing above the heroes' heads. */
function FloatingFlames() {
  const spirit = useSpiritModel('spirit', 0.22);
  // One material per spirit so each flickers and blinks on its own rhythm.
  const mats = useMemo(() => Array.from({ length: 7 }, (_, i) => makeSpiritMaterial(spirit, { color: FLAME_COLOR, mood: 'happy', seed: i * 0.137 })), [spirit]);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  useFrame((rs) => {
    SPIRIT_TIME.value = rs.clock.elapsedTime;
  });
  const spots: [number, number, number][] = [
    [-3.6, 3.4, 0.4],
    [3.4, 3.8, 0.2],
    [-1.6, 4.4, -2.4],
    [1.9, 4.1, -2.8],
    [-5.8, 3.6, -2],
    [5.9, 3.3, -1.6],
    [0, 4.8, -3.6],
  ];
  return (
    <group>
      {spots.map((p, i) => (
        <Float key={i} speed={1.6 + i * 0.2} floatIntensity={1.4} rotationIntensity={0.4} position={p}>
          <mesh geometry={spirit.geometry} material={mats[i]} />
        </Float>
      ))}
    </group>
  );
}
