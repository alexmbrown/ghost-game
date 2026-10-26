// Rendering-independent simulation types.
// This module has zero dependency on React or three.js so the same simulation
// runs offline, on the multiplayer host, and headless in unit tests.

export type TeamId = 0 | 1 | 2 | 3;

export interface Vec2 {
  x: number;
  z: number;
}

/** How a player's movement is driven on the authoritative host. */
export type ControlMode =
  /** Local input on the host machine (host player / offline). */
  | 'input'
  /** Remote client reports its own predicted position; host validates it. */
  | 'remote'
  /** Host-side AI. */
  | 'bot';

export interface RosterEntry {
  id: string;
  name: string;
  team: TeamId;
  isBot: boolean;
  /** Character id (see characters.ts). One per faction today; 4/faction planned. */
  character: string;
}

export interface PlayerStats {
  banked: number;
  steals: number;
  stolenFrom: number;
  stuns: number;
  pickups: number;
}

export interface PlayerState {
  id: string;
  name: string;
  team: TeamId;
  character: string;
  control: ControlMode;
  /** True once a networked player has disconnected (kept for scoreboard). */
  left: boolean;

  pos: Vec2;
  /** Facing direction in radians (for rendering). */
  heading: number;
  moving: boolean;
  /** Number of spirit flames currently carried (the trail). */
  carrying: number;
  /** Breadcrumb history, head-first (index 0 is closest to the player). */
  trail: Vec2[];

  /** Total flames this player banked this round (drives power-up unlocks). */
  bankedTotal: number;
  /** Seconds left "ghosted" after a stun; 0 = active. */
  stunTimer: number;
  /** Brief stagger (can't move) after a bone hit. */
  staggerTimer: number;
  /** Speed burst after a successful steal. */
  burstTimer: number;
  /** Magic pumpkin: untouchable + stuns on contact. */
  pumpkinTimer: number;
  /** Can't be stolen from right after a steal (prevents ping-pong). */
  immuneTimer: number;
  buddyCooldown: number;

  ability: AbilityRuntime;

  /** Bumped whenever the host teleports this player (respawn); clients snap. */
  warp: number;
  /** Last position the host accepted from a remote client (validation). */
  lastAcceptAt: number;

  stats: PlayerStats;
  bot: BotMemory | null;
}

export interface AbilityRuntime {
  /** Seconds until usable again. */
  cooldown: number;
  /** Seconds the active effect has left (dash / rush). */
  active: number;
  /** Dash/projectile direction captured at activation. */
  dir: Vec2;
}

export type BotMode = 'idle' | 'flame' | 'bank' | 'pumpkin' | 'mega' | 'hunt' | 'ram' | 'wander';

export interface BotMemory {
  mode: BotMode;
  /** Entity the current goal tracks (player id or mega id). */
  refId: string | number | null;
  target: Vec2 | null;
  /** Re-plan timer. */
  think: number;
  /** Desired carry before heading home (varies per bot). */
  bankAt: number;
  /** Stuck detection. */
  lastPos: Vec2;
  stuckFor: number;
  detour: Vec2 | null;
  detourFor: number;
  /** Smoothed A* waypoints toward pathGoal (see core/nav.ts). */
  path: Vec2[] | null;
  pathIdx: number;
  pathGoal: Vec2 | null;
  pathAge: number;
}

export interface FlameState {
  id: number;
  pos: Vec2;
}

export interface MegaFlameState {
  id: number;
  pos: Vec2;
  vel: Vec2;
}

export interface PumpkinState {
  pos: Vec2;
  /** True when it is sitting on the map, ready to grab. */
  available: boolean;
  /** Seconds until it (re)appears. */
  respawnIn: number;
}

export interface ProjectileState {
  id: number;
  owner: string;
  team: TeamId;
  pos: Vec2;
  vel: Vec2;
  ttl: number;
}

export interface FieldState {
  id: number;
  owner: string;
  team: TeamId;
  pos: Vec2;
  radius: number;
  ttl: number;
}

export interface BaseState {
  team: TeamId;
  pos: Vec2;
  score: number;
  /** Inactive factions (no players) keep their base hidden. */
  active: boolean;
}

/** Axis-aligned box obstacle on the XZ plane. */
export interface Obstacle {
  min: Vec2;
  max: Vec2;
  /** Visual style hint for the renderer. */
  kind?: 'crypt' | 'mausoleum' | 'pillar' | 'hedge' | 'corn' | 'wall' | 'shelf' | 'table' | 'tree' | 'water' | 'log' | 'rock';
  /** Height in world units. Obstacles under 1 unit don't stop projectiles. */
  height?: number;
}

export type GamePhase = 'countdown' | 'playing' | 'ended';

/** Discrete things that happened this tick — drive audio, VFX, toasts and the feed. */
export type GameEvent =
  | { id: number; type: 'pickup'; player: string; x: number; z: number; mega?: boolean }
  | { id: number; type: 'bank'; player: string; team: TeamId; amount: number; x: number; z: number }
  | { id: number; type: 'steal'; attacker: string; victim: string; amount: number; x: number; z: number }
  | { id: number; type: 'buddy'; a: string; b: string; x: number; z: number }
  | { id: number; type: 'stun'; attacker: string; victim: string; dropped: number; x: number; z: number; cause: 'pumpkin' }
  | { id: number; type: 'knock'; attacker: string; victim: string; dropped: number; x: number; z: number }
  | { id: number; type: 'respawn'; player: string }
  | { id: number; type: 'power'; player: string; power: PowerId }
  | { id: number; type: 'ability'; player: string; ability: string; x: number; z: number }
  | { id: number; type: 'pumpkin'; player: string; x: number; z: number }
  | { id: number; type: 'pumpkinSpawn'; x: number; z: number }
  | { id: number; type: 'megaSpawn'; x: number; z: number }
  | { id: number; type: 'phase'; phase: GamePhase }
  | { id: number; type: 'hurry' }
  | { id: number; type: 'left'; player: string };

export type PowerId = 'speed' | 'magnet' | 'phase';

export interface GameState {
  phase: GamePhase;
  /** Countdown seconds left while phase === 'countdown'. */
  countdown: number;
  timeRemaining: number;
  roundSeconds: number;
  mapId: string;
  /** Arena spans [-arenaHalf, arenaHalf] on X and Z (per map). */
  arenaHalf: number;
  /** Loose-spirit budget for this arena size. */
  maxFlames: number;
  flameSpawnInterval: number;
  players: PlayerState[];
  flames: FlameState[];
  megas: MegaFlameState[];
  pumpkin: PumpkinState;
  projectiles: ProjectileState[];
  fields: FieldState[];
  bases: BaseState[];
  obstacles: Obstacle[];
  nextId: number;
  flameSpawnTimer: number;
  megaSpawnTimer: number;
  /** Bumped whenever the loose-flame set changes (lets the net layer skip resends). */
  flameVersion: number;
  hurried: boolean;
  /** Winning team once phase === 'ended'; null means a draw. */
  winner: TeamId | null;
  /** Sim time in seconds since construction. */
  time: number;
}

/** Per-frame movement intent for an input-driven player, in world space. */
export interface InputState {
  /** World-space desired direction (normalized or zero). */
  x: number;
  z: number;
  /** Facing heading (radians) — 3rd-person: faces where the camera looks. */
  aim?: number;
  /** Edge-triggered: ability pressed since last consumed. */
  ability?: boolean;
}
