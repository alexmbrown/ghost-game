// Authoritative, rendering-independent game simulation.
//
// The engine owns the full GameState and advances it with step(dt). It knows
// nothing about React, three.js or networking: the same code runs offline vs
// bots, on the multiplayer host (as the source of truth), and headless in tests.
//
// Rules follow Google's Great Ghoul Duel, extended to 4 factions:
//  - collect flames -> they trail behind you -> bank them at your base
//  - touching a rival's carried flame steals it AND everything behind it
//  - touching a teammate's trail gives you both a Buddy Bonus
//  - Mega-Flames run away and are worth 10; the Magic Pumpkin makes you
//    unstealable and stuns rivals who touch you
//  - banking unlocks per-player powers (speed -> magnet -> phase)
//  - each faction has an active ability (the hero-shooter twist)

import { botThink } from './bots';
import { ABILITIES, abilityFor } from './characters';
import * as C from './constants';
import { getMap, spiritBudget } from './maps';
import { NavGrid } from './nav';
import { clamp, dist, dist2, makeRng, normalize } from './math';
import {
  FX,
  forEachSpirit,
  dirToHeading,
  headingToDir,
  insideObstacle,
  isPhasing,
  recordTrail,
  resolveCollisions,
  speedFromFlags,
  stepMovement,
} from './movement';
import type {
  BaseState,
  FieldState,
  GameEvent,
  GameState,
  InputState,
  PlayerState,
  PowerId,
  RosterEntry,
  TeamId,
  Vec2,
} from './types';

export interface EngineOptions {
  roster: RosterEntry[];
  mapId?: string;
  roundSeconds?: number;
  countdownSeconds?: number;
  seed?: number;
  botDifficulty?: C.BotDifficulty;
  /** Non-bot players whose movement is reported by a remote client. */
  remoteIds?: readonly string[];
}

/** Position report from a remote client (validated before it is accepted). */
export interface RemoteReport {
  x: number;
  z: number;
  heading: number;
  moving: boolean;
  /** The warp counter the client has applied; stale reports are ignored. */
  warp: number;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventInput = DistributiveOmit<GameEvent, 'id'>;

export class GameEngine {
  state: GameState;
  readonly rng: () => number;
  readonly botDifficulty: C.BotDifficulty;

  private inputs = new Map<string, InputState>();
  private pendingRemote = new Map<string, RemoteReport>();
  private pendingAbility = new Map<string, number>(); // id -> aim heading
  private events: GameEvent[] = [];
  private nextEventId = 1;
  /** Obstacles tall enough to stop projectiles (ponds/logs don't). */
  private tallObstacles: GameState['obstacles'] = [];

  constructor(opts: EngineOptions) {
    this.rng = makeRng(opts.seed ?? (Math.random() * 2 ** 32) >>> 0);
    this.botDifficulty = opts.botDifficulty ?? 'normal';
    this.state = this.createInitialState(opts);
    this.tallObstacles = this.state.obstacles.filter((o) => (o.height ?? 2) >= 1);
  }

  // --- setup -------------------------------------------------------------

  private createInitialState(opts: EngineOptions): GameState {
    const map = getMap(opts.mapId ?? 'graveyard');
    const remote = new Set(opts.remoteIds ?? []);
    const presentTeams = new Set(opts.roster.map((r) => r.team));

    const bases: BaseState[] = ([0, 1, 2, 3] as TeamId[]).map((team) => ({
      team,
      pos: { ...map.bases[team] },
      score: 0,
      active: presentTeams.has(team),
    }));

    const roundSeconds = opts.roundSeconds ?? C.DEFAULT_ROUND_SECONDS;
    const budget = spiritBudget(map.half);
    const state: GameState = {
      phase: 'countdown',
      countdown: opts.countdownSeconds ?? C.COUNTDOWN_SECONDS,
      timeRemaining: roundSeconds,
      roundSeconds,
      mapId: map.id,
      arenaHalf: map.half,
      maxFlames: budget.max,
      flameSpawnInterval: budget.interval,
      players: [],
      flames: [],
      megas: [],
      pumpkin: { pos: { ...map.pumpkin }, available: false, respawnIn: C.PUMPKIN_FIRST_SPAWN },
      projectiles: [],
      fields: [],
      bases,
      obstacles: map.obstacles.map((o) => ({ ...o, min: { ...o.min }, max: { ...o.max } })),
      nextId: 1,
      flameSpawnTimer: 0,
      megaSpawnTimer: C.MEGA_FIRST_SPAWN,
      flameVersion: 0,
      hurried: false,
      winner: null,
      time: 0,
    };

    // Spread teammates around their base so they don't stack.
    const perTeamIndex = new Map<TeamId, number>();
    for (const r of opts.roster) {
      const i = perTeamIndex.get(r.team) ?? 0;
      perTeamIndex.set(r.team, i + 1);
      const control = r.isBot ? 'bot' : remote.has(r.id) ? 'remote' : 'input';
      state.players.push(this.makePlayer(r, control, bases[r.team].pos, i));
    }

    for (let i = 0; i < budget.initial; i++) this.spawnFlame(state);
    return state;
  }

  private makePlayer(r: RosterEntry, control: PlayerState['control'], basePos: Vec2, slot: number): PlayerState {
    const pos = this.spawnPoint(basePos, slot);
    const toCenter = normalize({ x: -basePos.x, z: -basePos.z });
    return {
      id: r.id,
      name: r.name,
      team: r.team,
      character: r.character,
      control,
      left: false,
      pos,
      heading: dirToHeading(toCenter),
      moving: false,
      carrying: 0,
      trail: [{ ...pos }],
      bankedTotal: 0,
      stunTimer: 0,
      staggerTimer: 0,
      burstTimer: 0,
      pumpkinTimer: 0,
      immuneTimer: 0,
      buddyCooldown: 0,
      ability: { cooldown: 0, active: 0, dir: { x: 0, z: 1 } },
      warp: 0,
      lastAcceptAt: 0,
      stats: { banked: 0, steals: 0, stolenFrom: 0, stuns: 0, pickups: 0 },
      bot: r.isBot
        ? {
            mode: 'idle',
            refId: null,
            target: null,
            think: 0,
            bankAt: 5 + Math.floor(this.rng() * 6),
            lastPos: { ...pos },
            stuckFor: 0,
            detour: null,
            detourFor: 0,
            path: null,
            pathIdx: 0,
            pathGoal: null,
            pathAge: 0,
          }
        : null,
    };
  }

  /** Just outside the base toward the arena center, fanned out per slot. */
  private spawnPoint(basePos: Vec2, slot: number): Vec2 {
    const toCenter = Math.atan2(-basePos.x, -basePos.z);
    const spread = [0, 0.55, -0.55, 1.1][slot % 4];
    const r = C.BASE_RADIUS - 0.6;
    return {
      x: basePos.x + Math.sin(toCenter + spread) * r,
      z: basePos.z + Math.cos(toCenter + spread) * r,
    };
  }

  // --- external control ------------------------------------------------------

  /** Latest input for an input-driven player (host player / offline). */
  setInput(id: string, input: InputState): void {
    const prev = this.inputs.get(id);
    // Ability is edge-triggered: keep a pending press until a step consumes it.
    const ability = !!input.ability || !!prev?.ability;
    this.inputs.set(id, { ...input, ability });
  }

  /** Queue a remote client's self-reported state; applied + validated next step. */
  reportRemote(id: string, report: RemoteReport): void {
    this.pendingRemote.set(id, report);
  }

  /** Queue an ability activation for a remote client. */
  requestAbility(id: string, aimHeading: number): void {
    this.pendingAbility.set(id, aimHeading);
  }

  /** A networked player disconnected: drop their flames, keep them on the scoreboard. */
  removePlayer(id: string): void {
    const p = this.getPlayer(id);
    if (!p || p.left) return;
    this.scatterFlames(p);
    p.left = true;
    p.moving = false;
    this.emit({ type: 'left', player: id });
  }

  getPlayer(id: string): PlayerState | undefined {
    return this.state.players.find((p) => p.id === id);
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // --- simulation step ---------------------------------------------------

  step(dt: number): void {
    const s = this.state;
    s.time += dt;
    if (s.phase === 'ended') return;

    if (s.phase === 'countdown') {
      s.countdown -= dt;
      // Remote clients may still report (they're frozen too) — just keep facing.
      for (const p of s.players) {
        p.moving = false;
        const rep = this.pendingRemote.get(p.id);
        if (rep) p.heading = rep.heading;
        const inp = this.inputs.get(p.id);
        if (inp?.aim !== undefined) p.heading = inp.aim;
        if (inp) inp.ability = false;
        p.lastAcceptAt = s.time;
      }
      this.pendingRemote.clear();
      this.pendingAbility.clear();
      if (s.countdown <= 0) {
        s.countdown = 0;
        s.phase = 'playing';
        this.emit({ type: 'phase', phase: 'playing' });
      }
      return;
    }

    s.timeRemaining -= dt;
    if (!s.hurried && s.timeRemaining <= C.HURRY_SECONDS) {
      s.hurried = true;
      this.emit({ type: 'hurry' });
    }
    if (s.timeRemaining <= 0) {
      s.timeRemaining = 0;
      this.endRound();
      return;
    }

    this.spawnFlamesOverTime(dt);
    this.updatePumpkin(dt);
    this.updateFields(dt);

    for (const p of s.players) {
      if (p.left) continue;
      this.tickTimers(p, dt);

      if (p.stunTimer > 0) {
        p.stunTimer -= dt;
        if (p.stunTimer <= 0) this.respawnAtBase(p);
        continue;
      }

      this.handleAbilityRequest(p);

      if (p.control === 'remote') this.applyRemote(p);
      else this.moveLocal(p, dt);

      recordTrail(p.trail, p.pos);
      // Knocked-loose players can't instantly re-collect their own scattered spirits.
      if (p.staggerTimer <= 0) this.collect(p);
      this.tryBank(p);
    }

    this.magnetPull(dt);
    this.updateMegas(dt);
    this.updateProjectiles(dt);
    this.resolveContacts();
  }

  private tickTimers(p: PlayerState, dt: number): void {
    p.burstTimer = Math.max(0, p.burstTimer - dt);
    p.immuneTimer = Math.max(0, p.immuneTimer - dt);
    p.buddyCooldown = Math.max(0, p.buddyCooldown - dt);
    p.pumpkinTimer = Math.max(0, p.pumpkinTimer - dt);
    p.staggerTimer = Math.max(0, p.staggerTimer - dt);
    p.ability.cooldown = Math.max(0, p.ability.cooldown - dt);
    if (p.ability.active > 0) {
      p.ability.active = Math.max(0, p.ability.active - dt);
      if (p.ability.active === 0 && abilityFor(p.character).kind === 'dash') {
        // Dash ended: if we stopped inside a crypt, pop back out.
        resolveCollisions(p.pos, p.team, isPhasing(this.flagsFor(p)), this.state.obstacles, this.state.bases, this.state.arenaHalf);
      }
    }
  }

  /** Effect flags for a player right now (also what snapshots carry). */
  flagsFor(p: PlayerState): number {
    let f = 0;
    if (p.bankedTotal >= C.POWER_SPEED_AT) f |= FX.SPEED;
    if (p.bankedTotal >= C.POWER_MAGNET_AT) f |= FX.MAGNET;
    if (p.bankedTotal >= C.POWER_PHASE_AT) f |= FX.PHASE;
    if (p.burstTimer > 0) f |= FX.BURST;
    if (p.pumpkinTimer > 0) f |= FX.PUMPKIN;
    if (p.staggerTimer > 0) f |= FX.STAGGER;
    if (p.stunTimer > 0) f |= FX.STUN;
    if (p.immuneTimer > 0) f |= FX.IMMUNE;
    if (p.ability.active > 0) {
      const kind = abilityFor(p.character).kind;
      if (kind === 'dash') f |= FX.DASH;
      if (kind === 'rush') f |= FX.RUSH;
    }
    if (this.inEnemyField(p)) f |= FX.SLOWED;
    return f;
  }

  private inEnemyField(p: PlayerState): boolean {
    for (const fl of this.state.fields) {
      if (fl.team !== p.team && dist2(fl.pos, p.pos) <= fl.radius * fl.radius) return true;
    }
    return false;
  }

  // --- movement ----------------------------------------------------------

  private moveLocal(p: PlayerState, dt: number): void {
    const s = this.state;
    let dir: Vec2 = { x: 0, z: 0 };
    let aim: number | undefined;

    if (p.control === 'bot') {
      const tuning = C.BOT_TUNING[this.botDifficulty];
      const out = botThink(this, p, dt, tuning);
      dir = out.dir;
      if (out.ability) this.activateAbility(p, out.abilityHeading ?? p.heading);
    } else {
      const inp = this.inputs.get(p.id);
      if (inp) {
        dir = normalize({ x: inp.x, z: inp.z });
        aim = inp.aim;
        if (inp.ability) {
          inp.ability = false;
          this.activateAbility(p, aim ?? p.heading);
        }
      }
    }

    // Phase Dash overrides steering with the locked dash direction.
    if (p.ability.active > 0 && abilityFor(p.character).kind === 'dash') dir = p.ability.dir;

    const flags = this.flagsFor(p);
    let speed = speedFromFlags(flags);
    if (p.control === 'bot') speed *= C.BOT_TUNING[this.botDifficulty].speed;

    p.moving = stepMovement(p.pos, dir, speed, dt, p.team, isPhasing(flags), s.obstacles, s.bases, s.arenaHalf);
    if (aim !== undefined) p.heading = aim;
    else if (Math.hypot(dir.x, dir.z) > 1e-4) p.heading = dirToHeading(dir);
  }

  /**
   * Accept a remote client's self-reported position if it's plausible
   * (speed-limited, collision-resolved). Movement feels instant for the
   * client while the host still owns every gameplay decision.
   */
  private applyRemote(p: PlayerState): void {
    const s = this.state;
    const rep = this.pendingRemote.get(p.id);
    if (!rep) {
      // Client went quiet (tabbed out / lagging): stop the run animation.
      if (s.time - p.lastAcceptAt > 0.3) p.moving = false;
      return;
    }
    this.pendingRemote.delete(p.id);
    p.heading = rep.heading;
    // Stale report from before a host teleport (respawn): ignore position.
    if (rep.warp !== p.warp) return;
    if (p.staggerTimer > 0) {
      p.moving = false;
      p.lastAcceptAt = s.time;
      return;
    }

    const elapsed = Math.max(s.time - p.lastAcceptAt, C.FIXED_DT);
    const allowed = C.PLAYER_SPEED * C.MAX_SPEED_MULT * elapsed + 1.0;
    let nx = rep.x;
    let nz = rep.z;
    const dx = nx - p.pos.x;
    const dz = nz - p.pos.z;
    const d = Math.hypot(dx, dz);
    let corrected = false;
    if (!Number.isFinite(d)) {
      nx = p.pos.x;
      nz = p.pos.z;
      corrected = true;
    } else if (d > allowed) {
      nx = p.pos.x + (dx / d) * allowed;
      nz = p.pos.z + (dz / d) * allowed;
      corrected = true;
    }
    const next = { x: nx, z: nz };
    // A little grace after dashes: late packets may still be mid-wall.
    const def = abilityFor(p.character);
    const dashGrace = def.kind === 'dash' && p.ability.cooldown > def.cooldown - def.duration - 0.35;
    const phasing = isPhasing(this.flagsFor(p)) || dashGrace;
    resolveCollisions(next, p.team, phasing, s.obstacles, s.bases, s.arenaHalf);
    if (Math.hypot(next.x - rep.x, next.z - rep.z) > 0.75) corrected = true;

    p.moving = rep.moving && Math.hypot(next.x - p.pos.x, next.z - p.pos.z) > 1e-4;
    p.pos.x = next.x;
    p.pos.z = next.z;
    p.lastAcceptAt = s.time;
    // Tell the client to snap to our position.
    if (corrected) p.warp++;
  }

  // --- abilities -----------------------------------------------------------

  private handleAbilityRequest(p: PlayerState): void {
    const aim = this.pendingAbility.get(p.id);
    if (aim === undefined) return;
    this.pendingAbility.delete(p.id);
    this.activateAbility(p, aim);
  }

  /** Returns true if the ability fired. */
  activateAbility(p: PlayerState, aimHeading: number): boolean {
    if (p.left || p.stunTimer > 0 || p.staggerTimer > 0) return false;
    if (p.ability.cooldown > 0 || this.state.phase !== 'playing') return false;
    const def = abilityFor(p.character);
    const dir = headingToDir(aimHeading);
    const s = this.state;

    switch (def.kind) {
      case 'dash':
      case 'rush':
        p.ability.active = def.duration;
        p.ability.dir = dir;
        break;
      case 'field':
        s.fields.push({
          id: s.nextId++,
          owner: p.id,
          team: p.team,
          pos: { ...p.pos },
          radius: def.radius ?? 4,
          ttl: def.duration,
        });
        break;
      case 'projectile': {
        const speed = def.projectileSpeed ?? 24;
        s.projectiles.push({
          id: s.nextId++,
          owner: p.id,
          team: p.team,
          pos: { x: p.pos.x + dir.x * 1.0, z: p.pos.z + dir.z * 1.0 },
          vel: { x: dir.x * speed, z: dir.z * speed },
          ttl: def.duration,
        });
        break;
      }
    }
    p.ability.cooldown = def.cooldown;
    this.emit({ type: 'ability', player: p.id, ability: def.id, x: p.pos.x, z: p.pos.z });
    return true;
  }

  private updateFields(dt: number): void {
    const f = this.state.fields;
    for (let i = f.length - 1; i >= 0; i--) {
      f[i].ttl -= dt;
      if (f[i].ttl <= 0) f.splice(i, 1);
    }
  }

  private updateProjectiles(dt: number): void {
    const s = this.state;
    const def = ABILITIES.boneToss;
    const hitR = (def.radius ?? 0.9) + C.PLAYER_RADIUS;
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const pr = s.projectiles[i];
      pr.ttl -= dt;
      pr.pos.x += pr.vel.x * dt;
      pr.pos.z += pr.vel.z * dt;
      let dead =
        pr.ttl <= 0 ||
        Math.abs(pr.pos.x) > s.arenaHalf ||
        Math.abs(pr.pos.z) > s.arenaHalf ||
        insideObstacle(this.tallObstacles, pr.pos);
      if (!dead) {
        for (const v of s.players) {
          if (v.left || v.team === pr.team || v.stunTimer > 0) continue;
          if (dist2(v.pos, pr.pos) > hitR * hitR) continue;
          const vf = this.flagsFor(v);
          if (vf & FX.DASH) continue; // phased through
          dead = true;
          if (vf & FX.PUMPKIN) break; // bounces off
          const attacker = this.getPlayer(pr.owner);
          if (attacker) this.knock(attacker, v);
          break;
        }
      }
      if (dead) s.projectiles.splice(i, 1);
    }
  }

  // --- flames / scoring --------------------------------------------------

  private spawnFlamesOverTime(dt: number): void {
    const s = this.state;
    s.flameSpawnTimer -= dt;
    while (s.flameSpawnTimer <= 0 && s.flames.length < s.maxFlames) {
      this.spawnFlame(s);
      s.flameSpawnTimer += s.flameSpawnInterval;
    }
    if (s.flameSpawnTimer < 0) s.flameSpawnTimer = 0;
  }

  private randomOpenPoint(s: GameState, margin = 3): Vec2 | null {
    for (let attempt = 0; attempt < 24; attempt++) {
      const pos = {
        x: (this.rng() * 2 - 1) * (s.arenaHalf - margin),
        z: (this.rng() * 2 - 1) * (s.arenaHalf - margin),
      };
      if (insideObstacle(s.obstacles, pos, 0.6)) continue;
      if (s.bases.some((b) => dist(b.pos, pos) < C.BASE_BLOCK_RADIUS + 2)) continue;
      return pos;
    }
    return null;
  }

  private spawnFlame(s: GameState): void {
    const pos = this.randomOpenPoint(s);
    if (!pos) return;
    s.flames.push({ id: s.nextId++, pos });
    s.flameVersion++;
  }

  private collect(p: PlayerState): void {
    const s = this.state;
    const flags = this.flagsFor(p);
    const r = flags & FX.MAGNET ? C.POWER_MAGNET_RADIUS : C.FLAME_PICKUP_RADIUS;
    const r2 = r * r;
    for (let i = s.flames.length - 1; i >= 0; i--) {
      const f = s.flames[i];
      if (dist2(f.pos, p.pos) <= r2) {
        s.flames.splice(i, 1);
        s.flameVersion++;
        p.carrying++;
        p.stats.pickups++;
        this.emit({ type: 'pickup', player: p.id, x: f.pos.x, z: f.pos.z });
      }
    }
    // Magic pumpkin
    const pk = s.pumpkin;
    if (pk.available && dist2(pk.pos, p.pos) <= C.PUMPKIN_PICKUP_RADIUS ** 2) {
      pk.available = false;
      pk.respawnIn = C.PUMPKIN_DURATION + C.PUMPKIN_RESPAWN;
      p.pumpkinTimer = C.PUMPKIN_DURATION;
      this.emit({ type: 'pumpkin', player: p.id, x: pk.pos.x, z: pk.pos.z });
    }
  }

  /** Magnet power: loose spirits within range drift toward the player, faster as they near. */
  private magnetPull(dt: number): void {
    const s = this.state;
    const R = C.MAGNET_PULL_RADIUS;
    let moved = false;
    for (const p of s.players) {
      if (p.left || p.stunTimer > 0 || p.staggerTimer > 0 || p.bankedTotal < C.POWER_MAGNET_AT) continue;
      for (const f of s.flames) {
        const dx = p.pos.x - f.pos.x;
        const dz = p.pos.z - f.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const speed = C.MAGNET_PULL_SPEED * (0.35 + 0.65 * (1 - d / R));
        const stepLen = Math.min(d, speed * dt);
        const nx = f.pos.x + (dx / d) * stepLen;
        const nz = f.pos.z + (dz / d) * stepLen;
        // Spirits don't slide through walls.
        if (insideObstacle(s.obstacles, { x: nx, z: nz })) continue;
        f.pos.x = nx;
        f.pos.z = nz;
        moved = true;
      }
    }
    if (moved) s.flameVersion++;
  }

  private tryBank(p: PlayerState): void {
    if (p.carrying <= 0) return;
    const base = this.state.bases[p.team];
    if (dist(base.pos, p.pos) > C.BASE_RADIUS) return;
    const amount = p.carrying;
    const before = p.bankedTotal;
    base.score += amount;
    p.bankedTotal += amount;
    p.stats.banked += amount;
    p.carrying = 0;
    this.emit({ type: 'bank', player: p.id, team: p.team, amount, x: p.pos.x, z: p.pos.z });

    const unlocks: [number, PowerId][] = [
      [C.POWER_SPEED_AT, 'speed'],
      [C.POWER_MAGNET_AT, 'magnet'],
      [C.POWER_PHASE_AT, 'phase'],
    ];
    for (const [at, power] of unlocks) {
      if (before < at && p.bankedTotal >= at) this.emit({ type: 'power', player: p.id, power });
    }
  }

  /**
   * Knock all carried flames loose where they hang on the trail. Returns how
   * many were dropped. Flames beyond the visible trail land around the player.
   */
  private scatterFlames(p: PlayerState): number {
    const s = this.state;
    const n = p.carrying;
    const lim = s.arenaHalf - 1;
    const drop = (ax: number, az: number) => {
      if (s.flames.length >= C.MAX_LOOSE_FLAMES) return;
      const pos = {
        x: clamp(ax + (this.rng() - 0.5) * 1.4, -lim, lim),
        z: clamp(az + (this.rng() - 0.5) * 1.4, -lim, lim),
      };
      if (insideObstacle(s.obstacles, pos)) {
        pos.x = p.pos.x;
        pos.z = p.pos.z;
      }
      s.flames.push({ id: s.nextId++, pos });
    };
    // Spirits drop where they hung on the trail; any beyond it land around the player.
    const placed = forEachSpirit(p.trail, p.pos, n, (_k, x, z) => drop(x, z));
    for (let k = placed; k < n; k++) drop(p.pos.x, p.pos.z);
    p.carrying = 0;
    s.flameVersion++;
    return n;
  }

  // --- contacts: steals, buddy bonus, pumpkin + rush stuns ----------------

  private resolveContacts(): void {
    const s = this.state;
    const touch2 = C.TRAIL_TOUCH_RADIUS * C.TRAIL_TOUCH_RADIUS;
    const players = s.players;
    const flags = new Map<string, number>();
    for (const p of players) flags.set(p.id, this.flagsFor(p));
    const active = (p: PlayerState) => !p.left && p.stunTimer <= 0;

    // Body contacts first: pumpkin holders and rushing demons stun rivals.
    const bodyR = C.PLAYER_RADIUS * 2.1;
    for (const a of players) {
      if (!active(a)) continue;
      const af = flags.get(a.id)!;
      const pumpkin = (af & FX.PUMPKIN) !== 0;
      const rushing = (af & FX.RUSH) !== 0;
      if (!pumpkin && !rushing) continue;
      const r = rushing ? Math.max(bodyR, ABILITIES.hellfireRush.radius ?? bodyR) : bodyR;
      for (const v of players) {
        if (v === a || v.team === a.team || !active(v)) continue;
        if (dist2(a.pos, v.pos) > r * r) continue;
        const vf = flags.get(v.id)!;
        if (vf & FX.DASH) continue;
        if (vf & FX.PUMPKIN) {
          if (!pumpkin) this.stun(v, a); // pumpkin beats rush
          continue;
        }
        if (pumpkin) this.stun(a, v);
        else if (v.staggerTimer <= 0) this.knock(a, v); // rush: scatter + stagger
      }
    }

    // Trail contacts: steal from rivals, buddy bonus with teammates.
    for (const a of players) {
      if (!active(a) || a.staggerTimer > 0) continue;
      for (const v of players) {
        if (v === a || !active(v) || v.carrying <= 0) continue;
        const vf = flags.get(v.id)!;
        if (v.team === a.team) {
          if (a.buddyCooldown > 0 || v.buddyCooldown > 0) continue;
          if (this.touchIndex(a.pos, v, touch2) < 0) continue;
          a.carrying += C.BUDDY_BONUS;
          v.carrying += C.BUDDY_BONUS;
          a.buddyCooldown = v.buddyCooldown = C.BUDDY_COOLDOWN;
          this.emit({ type: 'buddy', a: a.id, b: v.id, x: a.pos.x, z: a.pos.z });
          continue;
        }
        if (vf & (FX.PUMPKIN | FX.IMMUNE | FX.DASH)) continue;
        const k = this.touchIndex(a.pos, v, touch2);
        if (k < 0) continue;
        const amount = v.carrying - k;
        v.carrying = k;
        a.carrying += amount;
        a.burstTimer = C.STEAL_BURST_SECONDS;
        a.immuneTimer = C.STEAL_IMMUNITY_SECONDS;
        a.stats.steals++;
        v.stats.stolenFrom++;
        flags.set(a.id, this.flagsFor(a));
        this.emit({ type: 'steal', attacker: a.id, victim: v.id, amount, x: a.pos.x, z: a.pos.z });
      }
    }
  }

  /** Index of the first carried spirit of `v` that `head` touches, or -1. */
  private touchIndex(head: Vec2, v: PlayerState, r2: number): number {
    let hit = -1;
    forEachSpirit(v.trail, v.pos, v.carrying, (k, x, z) => {
      const dx = head.x - x;
      const dz = head.z - z;
      if (dx * dx + dz * dz <= r2) {
        hit = k;
        return true;
      }
    });
    return hit;
  }

  /** Magic-pumpkin hit: flames scatter and the victim is sent home. */
  private stun(attacker: PlayerState, victim: PlayerState): void {
    const dropped = this.scatterFlames(victim);
    victim.stunTimer = C.STUN_SECONDS;
    victim.moving = false;
    victim.ability.active = 0;
    attacker.stats.stuns++;
    this.emit({
      type: 'stun',
      attacker: attacker.id,
      victim: victim.id,
      dropped,
      x: victim.pos.x,
      z: victim.pos.z,
      cause: 'pumpkin',
    });
  }

  /** Ability hit (Bone Toss / Hellfire Rush): flames scatter, brief stagger in place. */
  private knock(attacker: PlayerState, victim: PlayerState): void {
    const dropped = this.scatterFlames(victim);
    victim.staggerTimer = C.STAGGER_SECONDS;
    victim.moving = false;
    attacker.stats.stuns++;
    this.emit({ type: 'knock', attacker: attacker.id, victim: victim.id, dropped, x: victim.pos.x, z: victim.pos.z });
  }

  private respawnAtBase(p: PlayerState): void {
    const base = this.state.bases[p.team];
    p.pos = this.spawnPoint(base.pos, Math.floor(this.rng() * 4));
    p.trail = [{ ...p.pos }];
    p.stunTimer = 0;
    p.warp++;
    p.lastAcceptAt = this.state.time;
    if (p.bot) {
      p.bot.mode = 'idle';
      p.bot.target = null;
      p.bot.detour = null;
      p.bot.path = null;
      p.bot.think = 0;
      p.bot.lastPos = { ...p.pos };
    }
    this.emit({ type: 'respawn', player: p.id });
  }

  // --- mega flames & pumpkin ---------------------------------------------

  private updateMegas(dt: number): void {
    const s = this.state;
    const megaMax = s.arenaHalf >= 40 ? 2 : C.MEGA_MAX;
    if (s.megas.length < megaMax) {
      s.megaSpawnTimer -= dt;
      if (s.megaSpawnTimer <= 0) {
        const map = getMap(s.mapId);
        // Prefer the spawn point farthest from everyone.
        let best = map.megaSpawns[0];
        let bestD = -1;
        for (const sp of map.megaSpawns) {
          let nearest = Infinity;
          for (const p of s.players) if (!p.left) nearest = Math.min(nearest, dist2(p.pos, sp));
          for (const m of s.megas) nearest = Math.min(nearest, dist2(m.pos, sp));
          if (nearest > bestD) {
            bestD = nearest;
            best = sp;
          }
        }
        s.megas.push({ id: s.nextId++, pos: { ...best }, vel: { x: 0, z: 0 } });
        s.megaSpawnTimer = C.MEGA_RESPAWN;
        this.emit({ type: 'megaSpawn', x: best.x, z: best.z });
      }
    }

    const pickR = C.MEGA_RADIUS + C.PLAYER_RADIUS;
    for (let i = s.megas.length - 1; i >= 0; i--) {
      const m = s.megas[i];
      // Flee from the nearest player.
      let threat: PlayerState | null = null;
      let threatD = Infinity;
      for (const p of s.players) {
        if (p.left || p.stunTimer > 0) continue;
        const d = dist2(p.pos, m.pos);
        if (d < threatD) {
          threatD = d;
          threat = p;
        }
      }
      let want: Vec2 = { x: 0, z: 0 };
      let speed = 2;
      if (threat && threatD < C.MEGA_FLEE_RADIUS * C.MEGA_FLEE_RADIUS) {
        want = normalize({ x: m.pos.x - threat.pos.x, z: m.pos.z - threat.pos.z });
        speed = C.MEGA_SPEED;
      } else {
        want = { x: Math.sin(s.time * 0.7 + m.id), z: Math.cos(s.time * 0.5 + m.id) };
      }
      // Near walls, steer back toward open ground so it slides instead of sticking.
      const edge = s.arenaHalf - 5;
      if (Math.abs(m.pos.x) > edge) want.x -= Math.sign(m.pos.x) * 0.9;
      if (Math.abs(m.pos.z) > edge) want.z -= Math.sign(m.pos.z) * 0.9;
      const dir = normalize(want);
      m.vel.x += (dir.x * speed - m.vel.x) * Math.min(1, dt * 6);
      m.vel.z += (dir.z * speed - m.vel.z) * Math.min(1, dt * 6);
      m.pos.x += m.vel.x * dt;
      m.pos.z += m.vel.z * dt;
      // Megas avoid every base so nobody gets a free one.
      resolveCollisions(m.pos, -1, false, s.obstacles, s.bases, s.arenaHalf, C.MEGA_RADIUS);

      for (const p of s.players) {
        if (p.left || p.stunTimer > 0) continue;
        if (dist2(p.pos, m.pos) <= pickR * pickR) {
          p.carrying += C.MEGA_VALUE;
          p.stats.pickups += C.MEGA_VALUE;
          this.emit({ type: 'pickup', player: p.id, x: m.pos.x, z: m.pos.z, mega: true });
          s.megas.splice(i, 1);
          break;
        }
      }
    }
  }

  private updatePumpkin(dt: number): void {
    const pk = this.state.pumpkin;
    if (pk.available) return;
    pk.respawnIn -= dt;
    if (pk.respawnIn <= 0) {
      pk.available = true;
      pk.respawnIn = 0;
      this.emit({ type: 'pumpkinSpawn', x: pk.pos.x, z: pk.pos.z });
    }
  }

  // --- lifecycle ---------------------------------------------------------

  private endRound(): void {
    const s = this.state;
    s.phase = 'ended';
    let bestScore = -1;
    let winner: TeamId | null = null;
    let tie = false;
    for (const b of s.bases) {
      if (!b.active) continue;
      if (b.score > bestScore) {
        bestScore = b.score;
        winner = b.team;
        tie = false;
      } else if (b.score === bestScore) {
        tie = true;
      }
    }
    s.winner = tie || bestScore <= 0 ? null : winner;
    for (const p of s.players) p.moving = false;
    this.emit({ type: 'phase', phase: 'ended' });
  }

  emit(e: EventInput): void {
    this.events.push({ ...e, id: this.nextEventId++ } as GameEvent);
    // Bound memory if nobody drains (headless tests).
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
  }

  private navGrids = new Map<TeamId, NavGrid>();

  /** Walkability grid for a team's bots (enemy bases are no-go). Built on first use. */
  navFor(team: TeamId): NavGrid {
    let g = this.navGrids.get(team);
    if (!g) {
      const s = this.state;
      g = new NavGrid(s.arenaHalf, s.obstacles, s.bases, team);
      this.navGrids.set(team, g);
    }
    return g;
  }

  /** Active field list (exposed for bots). */
  get fields(): readonly FieldState[] {
    return this.state.fields;
  }
}
