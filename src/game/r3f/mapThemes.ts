import type { SoundId } from '@/game/audio/sounds';
import type { HeightFogSettings } from './fx/HeightFog';
import type { PropName } from './props/catalog';
import type { TorchStyle } from './props/layout';

// Visual + audio identity per map (gameplay geometry lives in core/maps.ts).

export interface MapTheme {
  background: string;
  fog: { color: string; near: number; far: number };
  /** Sky gradient stops, zenith -> horizon (the dome above the panorama). */
  sky: [string, string, string, string, string];
  /**
   * Painted panorama (public/textures/<texture>.webp) wrapped around the arena,
   * with its own moon. `horizon` is where the land meets the sky, as a fraction
   * of the image height from the bottom; `turn` spins it so the moon faces the menu.
   */
  skyArt?: { texture: string; horizon: number; turn: number };
  ground: {
    /** public/textures/<texture>.webp, tiling. */
    texture: string;
    /** World units per texture tile. */
    tile: number;
    /** Multiplies the texture (keeps the bright painted tiles at night levels). */
    tint: string;
  };
  /**
   * Perimeter wall: built from a prop model, or boxes wearing a tiling texture
   * (wallpaper and book spines get a wood wainscot/trim in `trim`).
   */
  walls: { body: string; trim: string; model?: PropName; texture?: 'stone_wall' | 'wallpaper_damask' | 'bookshelf_spines' };
  /** How 'tree' obstacles render. */
  trees: 'dead' | 'pine';
  /** Atmosphere: ground fog (screen effect), floating motes, perimeter lights. */
  fx: { groundFog: HeightFogSettings; motes: string; torch: TorchStyle; torchColor: string };
  hemi: { sky: string; ground: string; intensity: number };
  ambient: { color: string; intensity: number };
  sun: { color: string; intensity: number };
  moon: { color: string; halo: string; position: [number, number, number]; size: number };
  music: SoundId;
  ambience: SoundId;
}

export const MAP_THEMES: Record<string, MapTheme> = {
  graveyard: {
    background: '#0a0913',
    fog: { color: '#160f2b', near: 44, far: 130 },
    sky: ['#05040c', '#120f26', '#241a47', '#3c2766', '#1a1430'],
    skyArt: { texture: 'sky_graveyard', horizon: 0.37, turn: 1.57 },
    ground: { texture: 'ground_graveyard', tile: 9, tint: '#8f8aa8' },
    walls: { body: '#15132a', trim: '#2a2747', model: 'arena_wall' },
    trees: 'dead',
    fx: { groundFog: { color: '#6a62a0', density: 0.25, falloff: 0.7, max: 0.62 }, motes: '#c9b6ff', torch: 'lamp', torchColor: '#9b6cff' },
    hemi: { sky: '#2a3566', ground: '#0a0a14', intensity: 0.55 },
    ambient: { color: '#9fb0e0', intensity: 0.3 },
    sun: { color: '#bcd0ff', intensity: 0.95 },
    moon: { color: '#dfe9ff', halo: '#9bb6ff', position: [-46, 62, -70], size: 7 },
    music: 'music.match.graveyard',
    ambience: 'amb.graveyard',
  },
  cornmaze: {
    background: '#0b0d12',
    fog: { color: '#1d1626', near: 40, far: 120 },
    sky: ['#06070d', '#121729', '#2a2340', '#5a3a3a', '#2b1d1f'],
    skyArt: { texture: 'sky_cornmaze', horizon: 0.07, turn: 0 },
    ground: { texture: 'ground_cornfield', tile: 8, tint: '#8a8070' },
    walls: { body: '#2a1c12', trim: '#4a3220', model: 'corn_wall' },
    trees: 'dead',
    fx: { groundFog: { color: '#7a6a5a', density: 0.16, falloff: 0.75, max: 0.5 }, motes: '#ffd27a', torch: 'post', torchColor: '#ff8a2a' },
    hemi: { sky: '#3a3060', ground: '#120c08', intensity: 0.5 },
    ambient: { color: '#e0b890', intensity: 0.26 },
    sun: { color: '#ffd2a0', intensity: 0.85 },
    moon: { color: '#ffd59a', halo: '#ff9a4a', position: [54, 40, -78], size: 10 },
    music: 'music.match.cornmaze',
    ambience: 'amb.cornmaze',
  },
  mansion: {
    background: '#0c0a14',
    fog: { color: '#1a1024', near: 40, far: 115 },
    sky: ['#05040a', '#140f22', '#2a1a3a', '#3a2440', '#1a1020'],
    // Roofless manor: the castle-and-moon night shows over the walls.
    skyArt: { texture: 'sky_graveyard', horizon: 0.37, turn: 1.2 },
    ground: { texture: 'wood_planks', tile: 6, tint: '#9a8a90' },
    walls: { body: '#3d2a4f', trim: '#5a3b22', texture: 'wallpaper_damask' },
    trees: 'dead',
    fx: { groundFog: { color: '#5e527a', density: 0.08, falloff: 0.9, max: 0.35 }, motes: '#e9d5ff', torch: 'sconce', torchColor: '#ffa03a' },
    hemi: { sky: '#4a3a6a', ground: '#120a06', intensity: 0.5 },
    ambient: { color: '#e8c8a0', intensity: 0.34 },
    sun: { color: '#c8b8ff', intensity: 0.75 },
    moon: { color: '#efe6ff', halo: '#b39cff', position: [40, 60, -70], size: 8 },
    music: 'music.match.mansion',
    ambience: 'amb.mansion',
  },
  forest: {
    background: '#060b0c',
    fog: { color: '#0d1a1a', near: 38, far: 125 },
    sky: ['#030608', '#0a1418', '#12262a', '#1d3a38', '#0c1a1a'],
    skyArt: { texture: 'sky_forest', horizon: 0.22, turn: 0 },
    ground: { texture: 'ground_forest', tile: 9, tint: '#8aa094' },
    walls: { body: '#1c2a1a', trim: '#2c3f26', texture: 'stone_wall' },
    trees: 'pine',
    fx: { groundFog: { color: '#4b7d76', density: 0.28, falloff: 0.65, max: 0.66 }, motes: '#d9ff8a', torch: 'post', torchColor: '#7ef0c8' },
    hemi: { sky: '#2a4a4a', ground: '#050a08', intensity: 0.5 },
    ambient: { color: '#9fe0c0', intensity: 0.28 },
    sun: { color: '#b8e8ff', intensity: 0.8 },
    moon: { color: '#e8fff0', halo: '#8fd8c0', position: [-50, 58, 60], size: 9 },
    music: 'music.match.forest',
    ambience: 'amb.forest',
  },
  library: {
    background: '#0d0a08',
    fog: { color: '#1a120c', near: 36, far: 105 },
    sky: ['#060408', '#120c14', '#24182a', '#3a2430', '#140c10'],
    ground: { texture: 'cobblestone', tile: 5, tint: '#a08a7a' },
    walls: { body: '#3a2414', trim: '#5a3a1e', texture: 'bookshelf_spines' },
    trees: 'dead',
    fx: { groundFog: { color: '#6e5e4c', density: 0.08, falloff: 0.9, max: 0.32 }, motes: '#ffe2a8', torch: 'sconce', torchColor: '#ffb04a' },
    hemi: { sky: '#5a4060', ground: '#140a06', intensity: 0.5 },
    ambient: { color: '#ffd8a8', intensity: 0.36 },
    sun: { color: '#ffe0b0', intensity: 0.6 },
    moon: { color: '#ffe8c8', halo: '#ffb070', position: [-40, 62, -72], size: 7 },
    music: 'music.match.library',
    ambience: 'amb.library',
  },
};

export function themeFor(mapId: string): MapTheme {
  return MAP_THEMES[mapId] ?? MAP_THEMES.graveyard;
}
