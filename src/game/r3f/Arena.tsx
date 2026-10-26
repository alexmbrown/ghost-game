import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

import * as C from '@/game/core/constants';
import { FACTIONS } from '@/game/core/factions';
import type { BaseState, TeamId } from '@/game/core/types';
import { useAssetTexture } from './mapAssets';
import type { MapTheme } from './mapThemes';
import type { PropName } from './props/catalog';
import { PERIMETER_THICKNESS, type Dressing } from './props/layout';
import { PropMesh, Props } from './props/PropSet';

interface Props {
  bases: readonly BaseState[];
  theme: MapTheme;
  half: number;
  /** Obstacle and perimeter models fitted to the collision boxes (props/layout.ts). */
  dressing: Dressing;
  shadows: boolean;
}

/** Floor, perimeter walls, obstacles and the active team portals. */
export function Arena({ bases, theme, half, dressing, shadows }: Props) {
  return (
    <group>
      <Ground theme={theme} half={half} />
      {theme.walls.texture && <TexturedWalls theme={theme} half={half} texture={theme.walls.texture} />}
      <Props layout={dressing.props} shadows={shadows} />
      {dressing.walls && <Props layout={dressing.walls} shadows={false} />}
      {bases
        .filter((b) => b.active)
        .map((b) => (
          <Portal key={b.team} base={b} />
        ))}
    </group>
  );
}

function Ground({ theme, half }: { theme: MapTheme; half: number }) {
  const size = half * 2;
  const tex = useAssetTexture(theme.ground.texture, size / theme.ground.tile);
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial map={tex} color={theme.ground.tint} roughness={1} metalness={0} />
    </mesh>
  );
}

/** World units per tile of each wall texture. */
const WALL_TILE: Record<NonNullable<MapTheme['walls']['texture']>, number> = {
  stone_wall: 3,
  wallpaper_damask: 2,
  bookshelf_spines: 3,
};

/** Perimeter walls as boxes wearing a tiling texture (maps without a wall model). */
function TexturedWalls({ theme, half, texture }: { theme: MapTheme; half: number; texture: NonNullable<MapTheme['walls']['texture']> }) {
  const t = PERIMETER_THICKNESS;
  const h = C.WALL_HEIGHT;
  const len = half * 2 + t;
  // Wallpaper sits above a wood wainscot; stone and book spines run full height.
  const wainscot = texture === 'wallpaper_damask' ? 1.1 : 0;
  const tile = WALL_TILE[texture];
  const tex = useAssetTexture(texture, len / tile, (h - wainscot) / tile);
  const sides: { pos: [number, number]; size: [number, number] }[] = [
    { pos: [0, -half], size: [len, t] },
    { pos: [0, half], size: [len, t] },
    { pos: [-half, 0], size: [t, len] },
    { pos: [half, 0], size: [t, len] },
  ];
  return (
    <group>
      {sides.map(({ pos: [x, z], size: [w, d] }, i) => (
        <group key={i} position={[x, 0, z]}>
          {wainscot > 0 && (
            <mesh position-y={wainscot / 2} castShadow receiveShadow>
              <boxGeometry args={[w + 0.06, wainscot, d + 0.06]} />
              <meshStandardMaterial color={theme.walls.trim} roughness={0.8} />
            </mesh>
          )}
          <mesh position-y={wainscot + (h - wainscot) / 2} castShadow receiveShadow>
            <boxGeometry args={[w, h - wainscot, d]} />
            <meshStandardMaterial map={tex} color={texture === 'stone_wall' ? '#b8b4c8' : '#ffffff'} roughness={0.95} />
          </mesh>
          <mesh position-y={h + 0.06}>
            <boxGeometry args={[w + 0.12, 0.18, d + 0.12]} />
            <meshStandardMaterial color={theme.walls.trim} roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const PORTALS: Record<TeamId, { model: PropName; yMul: number }> = {
  0: { model: 'portal_ghosts', yMul: 0.45 },
  1: { model: 'portal_zombies', yMul: 0.4 },
  // The bone arch stays fairly tall (you bank by walking under it) but low enough not to wall off the spawn view.
  2: { model: 'portal_skeletons', yMul: 0.6 },
  3: { model: 'portal_demons', yMul: 0.38 },
};

function Portal({ base }: { base: BaseState }) {
  const f = FACTIONS[base.team];
  const R = C.BASE_RADIUS;
  const outer = useRef<THREE.MeshBasicMaterial>(null);
  const inner = useRef<THREE.MeshBasicMaterial>(null);
  const look = PORTALS[base.team];
  useFrame((rs) => {
    // Fade the light pillar when the camera is close so it never blocks the view.
    const dist = Math.hypot(rs.camera.position.x - base.pos.x, rs.camera.position.z - base.pos.z);
    const k = THREE.MathUtils.clamp((dist - 5) / 12, 0.12, 1);
    if (outer.current) outer.current.opacity = 0.09 * k;
    if (inner.current) inner.current.opacity = 0.22 * k;
  });
  return (
    <group position={[base.pos.x, 0, base.pos.z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
        <circleGeometry args={[R, 44]} />
        <meshStandardMaterial color={f.color} emissive={f.color} emissiveIntensity={1} transparent opacity={0.4} />
      </mesh>
      {/* The faction's portal, facing the arena center. */}
      <PropMesh
        name={look.model}
        width={R * 2 + 0.2}
        yMul={look.yMul}
        rotation-y={Math.atan2(-base.pos.x, -base.pos.z)}
        position-y={0.02}
      />
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <ringGeometry args={[C.BASE_BLOCK_RADIUS - 0.08, C.BASE_BLOCK_RADIUS + 0.05, 48]} />
        <meshBasicMaterial color={f.color} transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh position-y={2.6}>
        <cylinderGeometry args={[R * 0.4, R * 0.5, 5.2, 32, 1, true]} />
        <meshBasicMaterial
          ref={outer}
          color={f.color}
          transparent
          opacity={0.09}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh position-y={2.6}>
        <cylinderGeometry args={[0.32, 0.32, 5.2, 16, 1, true]} />
        <meshBasicMaterial
          ref={inner}
          color={f.accent}
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <pointLight position={[0, 2.6, 0]} color={f.color} intensity={7} distance={18} decay={2} />
    </group>
  );
}
