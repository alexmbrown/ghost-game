import { recordTrail } from '../core/movement';
import type { GameState, RosterEntry } from '../core/types';
import type { ViewPlayer, ViewState } from './types';

export function makeViewPlayer(r: RosterEntry, localId: string, x: number, z: number, heading: number): ViewPlayer {
  return {
    id: r.id,
    name: r.name,
    team: r.team,
    character: r.character,
    isBot: r.isBot,
    isLocal: r.id === localId,
    x,
    z,
    heading,
    moving: false,
    carrying: 0,
    flags: 0,
    bankedTotal: 0,
    abilityCooldown: 0,
    left: false,
    trail: [{ x, z }],
    stats: { banked: 0, steals: 0, stolenFrom: 0, stuns: 0, pickups: 0 },
  };
}

/** Initial ViewState mirroring a freshly constructed engine. */
export function makeView(state: GameState, roster: readonly RosterEntry[], localId: string): ViewState {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  return {
    phase: state.phase,
    countdown: state.countdown,
    timeRemaining: state.timeRemaining,
    roundSeconds: state.roundSeconds,
    scores: [0, 0, 0, 0],
    winner: null,
    mapId: state.mapId,
    arenaHalf: state.arenaHalf,
    players: roster.map((r) => {
      const p = byId.get(r.id)!;
      return makeViewPlayer(r, localId, p.pos.x, p.pos.z, p.heading);
    }),
    flames: state.flames,
    megas: [],
    pumpkin: { x: state.pumpkin.pos.x, z: state.pumpkin.pos.z, available: state.pumpkin.available },
    projectiles: [],
    fields: [],
    bases: state.bases,
    obstacles: state.obstacles,
    localId,
  };
}

/** Grow the visual trail from the rendered position (cheap, smooth, net-free). */
export function updateViewTrail(vp: ViewPlayer, hidden: boolean): void {
  if (hidden) {
    vp.trail.length = 0;
    return;
  }
  recordTrail(vp.trail, vp);
}
