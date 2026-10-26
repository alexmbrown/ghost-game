import { useGLTF } from '@react-three/drei';

import { CHARACTERS } from '@/game/core/characters';

// Per-CHARACTER 3D model config (character ids from core/characters.ts).
//
// Every character is a low-poly Meshy model built by `npm run gen:models`
// (assets/manifest.json: model.char.*). Characters with legs are rigged and
// animated by Meshy; the legless ghosts get a local rig (scripts/gen/ghost-rig.ts).
// All share the clip names below.
//
// Base path keeps model URLs correct under a GitHub Pages sub-path build.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export interface CreatureClips {
  idle: string;
  move: string;
  /** Slowed movement (Grave Grasp); falls back to `move` played slower. */
  walk?: string;
  /** Looped while staggered (pumpkin bonk); falls back to a wobble. */
  stunned?: string;
  /** One-shots (optional — skipped if the model lacks them). */
  hit?: string;
  cast?: string;
  victory?: string;
  defeat?: string;
}

export interface CreatureModel {
  url: string;
  /** Uniform scale applied to the model. */
  scale: number;
  /** Height offset (flyers hover above the ground). */
  yOffset: number;
  /** Extra Y rotation so the model's front matches the player heading. */
  rotationOffset: number;
  /** Flyers bob in the air. */
  floats: boolean;
  /**
   * Rigged models name their clips. Static models (the legless ghosts, which
   * Meshy can't rig) have none and are animated procedurally by Creature.
   */
  clips?: CreatureClips;
}

/** Clip names every generated character shares (Meshy-rigged and ghost-rigged alike). */
const CLIPS: CreatureClips = {
  idle: 'idle',
  move: 'run',
  walk: 'walk',
  stunned: 'stunned',
  hit: 'hit',
  cast: 'cast',
  victory: 'victory',
  defeat: 'defeat',
};

/** A generated character: 1.4 m tall, base on the ground (Meshy rig height / ghost rig). */
const rigged = (slug: string): CreatureModel => ({
  url: `${BASE}/models/characters/${slug}.glb`,
  // Scaled to the ~2.5 world units the arena, camera and hit radius are tuned for.
  scale: 1.8,
  yOffset: 0,
  rotationOffset: 0,
  floats: false,
  clips: CLIPS,
});
/** Legless ghosts hover a little above the ground. */
const ghost = (slug: string): CreatureModel => ({ ...rigged(slug), yOffset: 0.35, floats: true });

/** Every character's model, including ones not yet playable (core/characters.ts decides that). */
export const CREATURE_MODELS: Record<string, CreatureModel> = {
  // Ghosts
  boo: ghost('boo'),
  wisp: ghost('wisp'),
  clank: ghost('clank'),
  wailey: ghost('wailey'),
  // Zombies
  shambles: rigged('shambles'),
  wraps: rigged('wraps'),
  bolt: rigged('bolt'),
  muncher: rigged('muncher'),
  // Skeletons
  rattles: rigged('rattles'),
  calico: rigged('calico'),
  bonesworth: rigged('bonesworth'),
  calavera: rigged('calavera'),
  // Demons
  scorch: rigged('scorch'),
  horns: rigged('horns'),
  gargle: rigged('gargle'),
  hex: rigged('hex'),
};

export function modelFor(character: string): CreatureModel {
  return CREATURE_MODELS[character] ?? CREATURE_MODELS.boo;
}

/** Models of the playable characters (~0.2-0.9 MB each). */
export const PLAYABLE_MODEL_URLS = [
  ...new Set(
    Object.values(CHARACTERS)
      .filter((c) => c.available)
      .map((c) => modelFor(c.id).url),
  ),
];

/** Warm the cache so models are ready before the match starts (client only). */
export function preloadCreatureModels(): void {
  PLAYABLE_MODEL_URLS.forEach((u) => useGLTF.preload(u));
}
