import { useTexture } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { getMap } from '@/game/core/maps';
import type { Obstacle } from '@/game/core/types';
import { themeFor, type MapTheme } from './mapThemes';
import { preloadProps } from './props/PropSet';
import { dressArena, dressScenery, propsUsed, SET_PIECES, type Dressing } from './props/layout';

// Generated textures (public/textures/<name>.webp, assets/manifest.json: tex.*)
// and each map's set dressing.

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const textureUrl = (name: string) => `${BASE}/textures/${name}.webp`;

type Wrap = 'repeat' | 'mirror' | 'clamp';
const WRAP: Record<Wrap, THREE.Wrapping> = {
  repeat: THREE.RepeatWrapping,
  mirror: THREE.MirroredRepeatWrapping,
  clamp: THREE.ClampToEdgeWrapping,
};

/** A generated texture with its own tiling (suspends while loading; clones share the image). */
export function useAssetTexture(name: string, repeatX = 1, repeatY = repeatX, wrapS: Wrap = 'repeat', wrapT: Wrap = wrapS): THREE.Texture {
  const base = useTexture(textureUrl(name));
  const tex = useMemo(() => {
    const t = base.clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = WRAP[wrapS];
    t.wrapT = WRAP[wrapT];
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }, [base, repeatX, repeatY, wrapS, wrapT]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/** Obstacles, perimeter and decoration models for a map, plus their flames. */
export function dressMap(mapId: string, obstacles: readonly Obstacle[], half: number, theme: MapTheme): { arena: Dressing; scenery: Dressing } {
  return {
    arena: dressArena(obstacles, half, { trees: theme.trees, wallModel: theme.walls.model }),
    scenery: dressScenery(mapId, half, theme.fx.torch),
  };
}

/** Every texture a map draws. */
function texturesFor(theme: MapTheme, mapId: string): string[] {
  const out = [theme.ground.texture, 'vfx_sparkle', 'vfx_flame', 'vfx_smoke'];
  if (theme.skyArt) out.push(theme.skyArt.texture);
  if (theme.walls.texture) out.push(theme.walls.texture);
  if (mapId === 'cornmaze') out.push('corn_card');
  return out;
}

const preloaded = new Set<string>();

/** Start fetching a map's models and textures (e.g. as soon as it's picked in the menu). */
export function preloadMap(mapId: string): void {
  if (preloaded.has(mapId) || typeof window === 'undefined') return;
  preloaded.add(mapId);
  const map = getMap(mapId);
  const theme = themeFor(mapId);
  const d = dressMap(mapId, map.obstacles, map.half, theme);
  preloadProps([...propsUsed(d.arena, d.scenery), ...SET_PIECES]);
  for (const t of texturesFor(theme, mapId)) useTexture.preload(textureUrl(t));
}
