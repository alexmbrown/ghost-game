// The renderer-facing contract. A GameSession turns either a local engine
// (offline / online host) or a stream of host snapshots (online client) into a
// smooth, interpolated ViewState the three.js layer reads every frame.

import type { BaseState, FlameState, GameEvent, GamePhase, Obstacle, PlayerStats, TeamId, Vec2 } from '../core/types';

export interface ViewPlayer {
  id: string;
  name: string;
  team: TeamId;
  character: string;
  isBot: boolean;
  isLocal: boolean;
  /** Interpolated render position / heading. */
  x: number;
  z: number;
  heading: number;
  moving: boolean;
  carrying: number;
  /** FX bitflags (see core/movement.ts). */
  flags: number;
  bankedTotal: number;
  abilityCooldown: number;
  left: boolean;
  /** Visual trail recorded from rendered positions (head-first). */
  trail: Vec2[];
  stats: PlayerStats;
}

export interface ViewMega {
  id: number;
  x: number;
  z: number;
}

export interface ViewProjectile {
  id: number;
  x: number;
  z: number;
  team: TeamId;
}

export interface ViewField {
  id: number;
  x: number;
  z: number;
  radius: number;
  team: TeamId;
  ttl: number;
}

export interface ViewState {
  phase: GamePhase;
  countdown: number;
  timeRemaining: number;
  roundSeconds: number;
  scores: [number, number, number, number];
  winner: TeamId | null;
  mapId: string;
  arenaHalf: number;
  players: ViewPlayer[];
  flames: readonly FlameState[];
  megas: ViewMega[];
  pumpkin: { x: number; z: number; available: boolean };
  projectiles: ViewProjectile[];
  fields: ViewField[];
  bases: readonly BaseState[];
  obstacles: readonly Obstacle[];
  localId: string;
}

/** Per-frame local intent from the renderer (camera-relative already resolved). */
export interface LocalInput {
  x: number;
  z: number;
  aim: number;
}

export interface NetStats {
  rttMs: number | null;
  snapshotHz: number;
  peers: number;
}

export interface GameSession {
  readonly localId: string;
  readonly online: boolean;
  readonly isHost: boolean;
  readonly view: ViewState;
  /** Advance simulation/prediction to wall-clock `nowMs` (driven by Ticker). */
  tick(nowMs: number): void;
  /** Refresh the interpolated view for rendering at `nowMs` (driven by rAF). */
  updateView(nowMs: number): void;
  setInput(input: LocalInput): void;
  /** Edge-triggered ability press. */
  pressAbility(): void;
  /** Events since the last drain — audio, VFX, toasts. */
  drainEvents(): GameEvent[];
  dispose(): void;
}

/** Events older than this are dropped instead of replayed (e.g. after a hidden tab resumes). */
export const EVENT_MAX_AGE_MS = 1500;

export function freshEvents(list: { ev: GameEvent; at: number }[], now = performance.now()): GameEvent[] {
  const out: GameEvent[] = [];
  for (const e of list) if (now - e.at <= EVENT_MAX_AGE_MS) out.push(e.ev);
  return out;
}
