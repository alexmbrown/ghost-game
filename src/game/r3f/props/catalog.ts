// Every Meshy prop model (assets/manifest.json: model.prop.*, built by
// `npm run gen:models` into public/models/props/<name>.glb).
//
// Conventions shared by all of them: the front faces +Z, wall-like pieces run
// along X, and the renderer re-centers each model on X/Z with its base at y = 0.
// `size` is the model's bounding box [x, y, z] in its own units; layouts use it
// to fit models to obstacle footprints without loading them first
// (props.test.ts checks it against the GLB files).

export interface PropDef {
  size: readonly [number, number, number];
  /**
   * Texels brighter than `threshold` (0..1 luminance) glow at `intensity`
   * (lantern glass, carved pumpkin faces, potion, magic swirls).
   */
  glow?: { threshold: number; intensity: number };
}

export const PROPS = {
  arena_wall: { size: [1.9, 1.14, 0.5] },
  armchair: { size: [1.61, 1.89, 1.43] },
  barn: { size: [1.87, 1.9, 1.56] },
  bone_pile: { size: [1.89, 1.39, 1.41] },
  bone_projectile: { size: [1.9, 0.99, 0.58] },
  bookshelf: { size: [1.38, 1.9, 0.57] },
  boulder: { size: [1.89, 1.23, 1.58] },
  cauldron: { size: [1.89, 1.71, 1.62], glow: { threshold: 0.66, intensity: 1.6 } },
  chandelier: { size: [1.89, 1.4, 1.7], glow: { threshold: 0.8, intensity: 2.2 } },
  coffin: { size: [1.9, 0.91, 1.24] },
  corn_wall: { size: [1.9, 1.35, 0.66] },
  crypt_sarcophagus: { size: [1.9, 1.0, 1.15], glow: { threshold: 0.56, intensity: 1.4 } },
  dead_tree: { size: [1.8, 1.9, 1.49] },
  dining_table: { size: [1.9, 1.17, 0.84] },
  floating_book: { size: [1.9, 0.65, 1.14], glow: { threshold: 0.8, intensity: 0.5 } },
  globe: { size: [1.46, 1.89, 1.34] },
  grandfather_clock: { size: [0.94, 1.9, 0.6] },
  grasp_hand: { size: [1.57, 1.9, 1.58] },
  gravestone_cross: { size: [1.66, 1.9, 0.94] },
  gravestone_round: { size: [1.63, 1.9, 0.9] },
  haunted_portrait: { size: [1.54, 1.9, 0.17] },
  hay_bale: { size: [1.9, 1.24, 1.34] },
  iron_fence: { size: [1.9, 1.66, 0.38] },
  iron_gate: { size: [1.9, 1.83, 0.36] },
  jack_o_lantern: { size: [1.89, 1.7, 1.88], glow: { threshold: 0.72, intensity: 2.4 } },
  lamppost: { size: [0.59, 1.9, 0.89], glow: { threshold: 0.6, intensity: 3 } },
  lily_pond: { size: [1.9, 0.48, 1.82], glow: { threshold: 0.7, intensity: 0.6 } },
  magic_pumpkin: { size: [1.9, 1.79, 1.88], glow: { threshold: 0.42, intensity: 1.4 } },
  mansion_wall: { size: [1.9, 1.22, 0.4], glow: { threshold: 0.84, intensity: 2.2 } },
  mossy_log: { size: [1.9, 1.12, 1.59], glow: { threshold: 0.72, intensity: 1.2 } },
  mushrooms: { size: [1.89, 1.88, 1.74], glow: { threshold: 0.7, intensity: 1.4 } },
  portal_demons: { size: [1.9, 1.22, 1.9], glow: { threshold: 0.62, intensity: 1.6 } },
  portal_ghosts: { size: [1.9, 0.61, 1.9], glow: { threshold: 0.66, intensity: 1.4 } },
  portal_skeletons: { size: [1.9, 1.44, 1.72], glow: { threshold: 0.76, intensity: 0.9 } },
  portal_zombies: { size: [1.89, 0.77, 1.89], glow: { threshold: 0.66, intensity: 1.4 } },
  pumpkin_patch: { size: [1.89, 1.31, 1.78] },
  reading_desk: { size: [1.9, 1.74, 1.33], glow: { threshold: 0.86, intensity: 1.2 } },
  scarecrow: { size: [1.3, 1.89, 0.85] },
  shrine_pillar: { size: [0.95, 1.83, 0.96] },
  spirit: { size: [1.21, 1.89, 1.22] },
  mega_spirit: { size: [1.3, 1.9, 1.39] },
  spooky_pine: { size: [1.26, 1.9, 1.18] },
  tomb_small: { size: [1.37, 1.9, 1.34] },
  tree_stump: { size: [1.89, 0.99, 1.71] },
  windmill: { size: [1.34, 1.9, 1.06] },
  wooden_cart: { size: [1.89, 1.68, 1.18] },
} as const satisfies Record<string, PropDef>;

export type PropName = keyof typeof PROPS;

export const PROP_NAMES = Object.keys(PROPS) as PropName[];

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function propUrl(name: PropName): string {
  return `${BASE}/models/props/${name}.glb`;
}
