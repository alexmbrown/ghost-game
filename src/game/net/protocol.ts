// Wire protocol between the host (authoritative) and clients.
//
// Topology is a star: the host runs the GameEngine; clients predict their own
// movement, report it at 30 Hz, and render everyone else from 20 Hz snapshots.
// Trystero gives us one ordered, reliable data channel per peer, so messages
// arrive in order and never need resend logic.

import type { BotDifficulty } from '../core/constants';
import type { GameEngine } from '../core/engine';
import type { GameEvent, RosterEntry, TeamId } from '../core/types';

export const PROTOCOL_VERSION = 1;
/** Unique Trystero namespace for this game (changing it splits the player base). */
export const APP_ID = 'ghoul-duel-3d';

// --- lobby -----------------------------------------------------------------

export interface LobbyPlayer {
  id: string;
  name: string;
  team: TeamId;
  /** Chosen character; absent (or not of `team`) means the team's hero. */
  character?: string;
}

export interface LobbySettings {
  mapId: string;
  roundSeconds: number;
  /** Fill every active team up to this many players with bots (0 = no bots). */
  botFill: number;
  botDifficulty: BotDifficulty;
  /** Factions in play (2–4). */
  teams: TeamId[];
}

export type LobbyPhase = 'lobby' | 'match';

export interface LobbyState {
  hostId: string;
  players: LobbyPlayer[];
  settings: LobbySettings;
  phase: LobbyPhase;
  matchId: number;
}

export interface Hello {
  v: number;
  name: string;
  host: boolean;
}

export type LobbyRequest = { type: 'team'; team: TeamId } | { type: 'name'; name: string } | { type: 'character'; character: string };

export interface Kick {
  reason: 'full' | 'version' | 'host-left' | 'kicked';
}

export interface MatchStart {
  matchId: number;
  roster: RosterEntry[];
  mapId: string;
  roundSeconds: number;
}

// --- in-match ----------------------------------------------------------------

/** Client -> host self-report: [x*100, z*100, heading*1000, moving, warp, clientTimeMs]. */
export type PosReport = [number, number, number, 0 | 1, number, number];

/** Client -> host ability press: [aimHeading*1000]. */
export type AbilityPress = [number];

/** Per-roster-slot player state. Indices match MatchStart.roster. */
export type PlayerSnap = [
  x: number, // *100
  z: number, // *100
  heading: number, // *1000
  carrying: number,
  flags: number, // FX bits + SNAP_LEFT
  warp: number,
  moving: 0 | 1,
  cooldown: number, // ability cooldown *10
  banked: number,
];

export const SNAP_LEFT = 1 << 14;

export interface Snapshot {
  /** Host sim time in ms (interpolation timeline). */
  t: number;
  m: number;
  ph: 0 | 1 | 2;
  cd: number; // countdown *10
  tr: number; // time remaining *10
  sc: [number, number, number, number];
  w: number; // winner team, -1 = none/draw
  p: PlayerSnap[];
  /** Flames flat [id, x*100, z*100, ...] — only when changed (see fv). */
  f?: number[];
  fv: number;
  mg: number[]; // megas [id, x*100, z*100, ...]
  pk: [number, number, 0 | 1];
  pr: number[]; // projectiles [id, x*100, z*100, team, ...]
  fl: number[]; // fields [id, x*100, z*100, radius*10, team, ttl*10, ...]
  ev: GameEvent[];
  /** Final per-slot stats once the round ends: [banked, steals, stolenFrom, stuns, pickups]. */
  st?: number[][];
}

const q = (v: number, s: number) => Math.round(v * s);

/** Build a snapshot from engine state. `flameVersionSent` lets us skip unchanged flame lists. */
export function encodeSnapshot(
  engine: GameEngine,
  matchId: number,
  roster: readonly RosterEntry[],
  events: GameEvent[],
  includeFlames: boolean,
): Snapshot {
  const s = engine.state;
  const byId = new Map(s.players.map((p) => [p.id, p]));
  const p: PlayerSnap[] = roster.map((r) => {
    const pl = byId.get(r.id);
    if (!pl) return [0, 0, 0, 0, SNAP_LEFT, 0, 0, 0, 0];
    return [
      q(pl.pos.x, 100),
      q(pl.pos.z, 100),
      q(pl.heading, 1000),
      pl.carrying,
      engine.flagsFor(pl) | (pl.left ? SNAP_LEFT : 0),
      pl.warp,
      pl.moving ? 1 : 0,
      q(pl.ability.cooldown, 10),
      pl.bankedTotal,
    ];
  });

  const snap: Snapshot = {
    t: Math.round(s.time * 1000),
    m: matchId,
    ph: s.phase === 'countdown' ? 0 : s.phase === 'playing' ? 1 : 2,
    cd: q(s.countdown, 10),
    tr: q(s.timeRemaining, 10),
    sc: [s.bases[0].score, s.bases[1].score, s.bases[2].score, s.bases[3].score],
    w: s.winner ?? -1,
    p,
    fv: s.flameVersion,
    mg: s.megas.flatMap((m) => [m.id, q(m.pos.x, 100), q(m.pos.z, 100)]),
    pk: [q(s.pumpkin.pos.x, 100), q(s.pumpkin.pos.z, 100), s.pumpkin.available ? 1 : 0],
    pr: s.projectiles.flatMap((pr) => [pr.id, q(pr.pos.x, 100), q(pr.pos.z, 100), pr.team]),
    fl: s.fields.flatMap((f) => [f.id, q(f.pos.x, 100), q(f.pos.z, 100), q(f.radius, 10), f.team, q(f.ttl, 10)]),
    ev: events,
  };
  if (includeFlames) snap.f = s.flames.flatMap((f) => [f.id, q(f.pos.x, 100), q(f.pos.z, 100)]);
  if (s.phase === 'ended') {
    snap.st = roster.map((r) => {
      const st = byId.get(r.id)?.stats;
      return st ? [st.banked, st.steals, st.stolenFrom, st.stuns, st.pickups] : [0, 0, 0, 0, 0];
    });
  }
  return snap;
}

/** Iterate a flat array in fixed-size records. */
export function* records(flat: readonly number[] | undefined, size: number): Generator<number[]> {
  if (!flat) return;
  for (let i = 0; i + size <= flat.length; i += size) yield flat.slice(i, i + size);
}

// --- validation of untrusted input -------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parsePosReport(data: unknown): PosReport | null {
  if (!Array.isArray(data) || data.length < 5 || data.length > 6 || !data.every(isNum)) return null;
  const [x, z, h, m, w, t = -1] = data as number[];
  if (Math.abs(x) > 1e5 || Math.abs(z) > 1e5) return null;
  return [x, z, h, m ? 1 : 0, w, t];
}

export function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return 'Ghoul';
  // Strip control characters; keep it short so the UI never overflows.
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return clean || 'Ghoul';
}

export function isTeamId(v: unknown): v is TeamId {
  return v === 0 || v === 1 || v === 2 || v === 3;
}
