// Tiny pub-sub so non-React code (the event router) can trigger 3D particle
// effects rendered by r3f/Vfx.tsx.

/** Sprite for the soft particles (sparkles are always mixed in): flame licks or smoke puffs instead of glow. */
export type VfxLook = 'flame' | 'smoke';

export type VfxEvent =
  /** Particles bursting outward. */
  | { kind: 'burst'; x: number; z: number; color: string; count: number; speed?: number; y?: number; look?: VfxLook }
  /** Expanding ground shockwave ring. */
  | { kind: 'ring'; x: number; z: number; color: string; radius: number }
  /** Particles flying from one point to another (steals, magnet pull). */
  | { kind: 'stream'; fromX: number; fromZ: number; toX: number; toZ: number; color: string; count: number; y?: number }
  /** A few slow, small wisps left behind a moving effect (dash, rush, pumpkin…). */
  | { kind: 'trail'; x: number; z: number; color: string; count: number; y?: number; spread?: number; rise?: number; size?: number; look?: VfxLook }
  /** Vertical pillar of light (banking). */
  | { kind: 'beam'; x: number; z: number; color: string; height: number };

type Listener = (e: VfxEvent) => void;
const listeners = new Set<Listener>();

export function emitVfx(e: VfxEvent): void {
  for (const l of listeners) l(e);
}

export function onVfx(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// --- one-shot character animations (hit reactions, ability casts) ----------

export type AnimCue = 'hit' | 'cast';
type AnimListener = (cue: AnimCue) => void;
const animListeners = new Map<string, Set<AnimListener>>();

export function emitAnim(playerId: string, cue: AnimCue): void {
  animListeners.get(playerId)?.forEach((l) => l(cue));
}

export function onAnim(playerId: string, l: AnimListener): () => void {
  let set = animListeners.get(playerId);
  if (!set) {
    set = new Set();
    animListeners.set(playerId, set);
  }
  set.add(l);
  return () => set!.delete(l);
}
