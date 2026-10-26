import { Stars } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { useAssetTexture } from './mapAssets';
import type { MapTheme } from './mapThemes';
import { makeSkyTexture } from './textures';

const DOME_RADIUS = 140;
const PANO_RADIUS = 110;
/** Where the painted horizon sits (world Y). */
const HORIZON_Y = 4;
/** The panorama repeats (mirrored) this many times around the arena. */
const WRAPS = 2;

/** Night sky: gradient dome + stars, then a painted panorama or a glowing moon (per map theme). */
export function Backdrop({ theme }: { theme: MapTheme }) {
  const skyTex = useMemo(() => makeSkyTexture(theme.sky), [theme]);
  useEffect(() => () => skyTex.dispose(), [skyTex]);
  const { moon } = theme;

  return (
    <group>
      {/* gradient sky dome (unaffected by fog so the horizon reads cleanly) */}
      <mesh scale={[-1, 1, 1]}>
        <sphereGeometry args={[DOME_RADIUS, 32, 16]} />
        <meshBasicMaterial map={skyTex} side={THREE.BackSide} fog={false} depthWrite={false} />
      </mesh>

      <Stars radius={120} depth={40} count={1400} factor={4} saturation={0} fade speed={0.6} />

      {theme.skyArt ? (
        <Panorama art={theme.skyArt} />
      ) : (
        <>
          <mesh position={moon.position}>
            <sphereGeometry args={[moon.size, 24, 24]} />
            <meshBasicMaterial color={moon.color} fog={false} toneMapped={false} />
          </mesh>
          <mesh position={moon.position}>
            <sphereGeometry args={[moon.size * 1.3, 24, 24]} />
            <meshBasicMaterial color={moon.halo} transparent opacity={0.18} fog={false} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

/** Vertical fade so the panorama's top edge melts into the dome. */
function fadeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#000'); // top (alphaMap reads green: black = clear)
  g.addColorStop(0.22, '#fff');
  g.addColorStop(1, '#fff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 64);
  return new THREE.CanvasTexture(c);
}

/** The painted sky strip wrapped around the arena on an open cylinder, its horizon at eye level. */
function Panorama({ art }: { art: NonNullable<MapTheme['skyArt']> }) {
  const tex = useAssetTexture(art.texture, WRAPS, 1, 'mirror', 'clamp');
  const fade = useMemo(() => fadeTexture(), []);
  useEffect(() => () => fade.dispose(), [fade]);
  const img = tex.image as { width: number; height: number };
  // Keep the painting's proportions: each wrap spans 1/WRAPS of the circumference.
  const height = (2 * Math.PI * PANO_RADIUS) / WRAPS / (img.width / img.height);
  const bottom = HORIZON_Y - art.horizon * height;
  return (
    <mesh position-y={bottom + height / 2} rotation-y={art.turn} scale={[-1, 1, 1]}>
      <cylinderGeometry args={[PANO_RADIUS, PANO_RADIUS, height, 96, 1, true]} />
      <meshBasicMaterial map={tex} alphaMap={fade} transparent side={THREE.BackSide} fog={false} toneMapped={false} />
    </mesh>
  );
}
