// Bot AI. Pure functions over engine state; runs only on the authoritative host.
//
// Each bot re-plans every `reaction` seconds, picking the highest-priority goal:
//   pumpkin-powered hunt > flee home with a fat trail > bank > grab the pumpkin
//   > chase a Mega-Flame > steal from a nearby carrier > nearest flame > wander
// Movement follows smoothed A* paths (core/nav.ts) plus a stuck detector that
// sidesteps when progress stalls.

import { abilityFor } from './characters';
import * as C from './constants';
import type { GameEngine } from './engine';
import { dist, dist2, dirTo, normalize, segmentHitsBox } from './math';
import type { NavGrid } from './nav';
import { FX, carriedSpiritPos, dirToHeading, isPhasing } from './movement';
import type { BotMemory, GameState, PlayerState, Vec2 } from './types';

export interface BotOutput {
  dir: Vec2;
  ability: boolean;
  abilityHeading?: number;
}

type Tuning = (typeof C.BOT_TUNING)[C.BotDifficulty];

const STILL: BotOutput = { dir: { x: 0, z: 0 }, ability: false };

export function botThink(engine: GameEngine, bot: PlayerState, dt: number, tuning: Tuning): BotOutput {
  const s = engine.state;
  const mem = bot.bot!;
  if (bot.staggerTimer > 0) return STILL;

  const flags = engine.flagsFor(bot);
  const phasing = isPhasing(flags);

  mem.think -= dt;
  const goalGone = !mem.target || (mem.mode !== 'bank' && dist2(bot.pos, mem.target) < 0.5);
  if (mem.think <= 0 || goalGone) {
    mem.think = tuning.reaction * (0.7 + engine.rng() * 0.6);
    choose(engine, bot, mem, tuning);
  } else {
    track(s, mem);
  }

  let ability = false;
  let abilityHeading: number | undefined;
  if (bot.ability.cooldown <= 0 && s.phase === 'playing' && engine.rng() < tuning.abilityUse * dt * 4) {
    const a = decideAbility(engine, bot, mem);
    if (a !== null) {
      ability = true;
      abilityHeading = a;
    }
  }

  const target = mem.target;
  if (!target) return { dir: { x: 0, z: 0 }, ability, abilityHeading };

  // Stuck detection: sample progress every 0.4s.
  mem.stuckFor += dt;
  if (mem.stuckFor >= 0.4) {
    const moved = dist(bot.pos, mem.lastPos);
    if (moved < C.PLAYER_SPEED * 0.4 * 0.2 && dist(bot.pos, target) > 1.2) {
      const d = dirTo(bot.pos, target);
      const side = engine.rng() < 0.5 ? 1 : -1;
      mem.detour = normalize({ x: -d.z * side + d.x * 0.2, z: d.x * side + d.z * 0.2 });
      mem.detourFor = 0.45 + engine.rng() * 0.4;
    }
    mem.lastPos = { ...bot.pos };
    mem.stuckFor = 0;
  }
  if (mem.detour && mem.detourFor > 0) {
    mem.detourFor -= dt;
    return { dir: mem.detour, ability, abilityHeading };
  }
  mem.detour = null;

  const waypoint = phasing ? target : followPath(engine.navFor(bot.team), bot, mem, target, dt);
  return { dir: dirTo(bot.pos, waypoint), ability, abilityHeading };
}

function rivalsOf(s: GameState, bot: PlayerState): PlayerState[] {
  return s.players.filter((p) => p.team !== bot.team && !p.left && p.stunTimer <= 0);
}

function nearest<T>(from: Vec2, list: T[], pos: (t: T) => Vec2): { item: T; d: number } | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const t of list) {
    const d = dist2(from, pos(t));
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best === null ? null : { item: best, d: Math.sqrt(bestD) };
}

function choose(engine: GameEngine, bot: PlayerState, mem: BotMemory, tuning: Tuning): void {
  const s = engine.state;
  const base = s.bases[bot.team].pos;
  const rivals = rivalsOf(s, bot);
  const homeD = dist(bot.pos, base);
  const set = (mode: BotMemory['mode'], target: Vec2 | null, refId: BotMemory['refId'] = null) => {
    mem.mode = mode;
    mem.target = target ? { ...target } : null;
    mem.refId = refId;
  };

  // Pumpkin-powered: body-check the juiciest rival in reach.
  if (bot.pumpkinTimer > 1) {
    const prey = rivals
      .filter((r) => dist(r.pos, bot.pos) < 14)
      .sort((a, b) => b.carrying - a.carrying)[0];
    if (prey) return set('ram', prey.pos, prey.id);
  }

  const threat = nearest(bot.pos, rivals, (r) => r.pos);
  const exposed = bot.carrying >= 3 && bot.pumpkinTimer <= 0;
  if (exposed && threat && threat.d < 5.5) return set('bank', base);

  const timeHome = homeD / C.PLAYER_SPEED + 3;
  if (
    bot.carrying >= mem.bankAt ||
    (bot.carrying > 0 && s.timeRemaining < timeHome) ||
    (bot.carrying >= 3 && homeD < 9)
  ) {
    return set('bank', base);
  }

  if (s.pumpkin.available && dist(bot.pos, s.pumpkin.pos) < 16) return set('pumpkin', s.pumpkin.pos);

  const mega = nearest(bot.pos, s.megas, (m) => m.pos);
  if (mega && mega.d < 20) return set('mega', mega.item.pos, mega.item.id);

  if (engine.rng() < tuning.aggression && bot.carrying < 8) {
    const carriers = rivals.filter(
      (r) => r.carrying >= 4 && dist(r.pos, bot.pos) < 18 && !(engine.flagsFor(r) & (FX.PUMPKIN | FX.DASH)),
    );
    const prey = carriers.sort((a, b) => b.carrying - a.carrying)[0];
    if (prey) {
      const fp = carriedSpiritPos(prey.trail, prey.pos, 0);
      if (fp) return set('hunt', fp, prey.id);
    }
  }

  // Nearest flame, mildly penalizing ones a rival is closer to.
  let best: Vec2 | null = null;
  let bestScore = Infinity;
  for (const f of s.flames) {
    const d = dist(bot.pos, f.pos);
    let score = d;
    if (threat) {
      const rd = dist(threat.item.pos, f.pos);
      if (rd < d) score += 4;
    }
    if (score < bestScore) {
      bestScore = score;
      best = f.pos;
    }
  }
  if (best) return set('flame', best);

  const wander = {
    x: (engine.rng() * 2 - 1) * (s.arenaHalf - 6),
    z: (engine.rng() * 2 - 1) * (s.arenaHalf - 6),
  };
  set('wander', wander);
}

/** Keep moving goals (megas, prey trails) up to date between re-plans. */
function track(s: GameState, mem: BotMemory): void {
  if (mem.mode === 'mega') {
    const m = s.megas.find((mm) => mm.id === mem.refId);
    if (!m) {
      mem.target = null;
      return;
    }
    // Lead the target a little.
    mem.target = { x: m.pos.x + m.vel.x * 0.25, z: m.pos.z + m.vel.z * 0.25 };
  } else if (mem.mode === 'hunt' || mem.mode === 'ram') {
    const prey = s.players.find((p) => p.id === mem.refId);
    if (!prey || prey.left || prey.stunTimer > 0 || (mem.mode === 'hunt' && prey.carrying <= 0)) {
      mem.target = null;
      return;
    }
    const fp = mem.mode === 'hunt' ? carriedSpiritPos(prey.trail, prey.pos, 0) : prey.pos;
    if (fp) mem.target = { ...fp };
  } else if (mem.mode === 'flame' && mem.target) {
    const t = mem.target;
    if (!s.flames.some((f) => f.pos.x === t.x && f.pos.z === t.z)) mem.target = null;
  } else if (mem.mode === 'pumpkin' && !s.pumpkin.available) {
    mem.target = null;
  }
}

/** Returns an aim heading if the bot should fire its ability now. */
function decideAbility(engine: GameEngine, bot: PlayerState, mem: BotMemory): number | null {
  const s = engine.state;
  const def = abilityFor(bot.character);
  const rivals = rivalsOf(s, bot);
  const clearShot = (to: Vec2) => !s.obstacles.some((o) => segmentHitsBox(bot.pos, to, o));

  switch (def.kind) {
    case 'dash': {
      if (!mem.target) return null;
      const d = dist(bot.pos, mem.target);
      const fleeing = mem.mode === 'bank' && bot.carrying >= 4;
      const blocked = !clearShot(mem.target);
      if ((fleeing && d > 6) || (blocked && d > 7 && d < 14) || (mem.mode === 'mega' && d < 7)) {
        return dirToHeading(dirTo(bot.pos, mem.target));
      }
      return null;
    }
    case 'field': {
      const close = rivals.find((r) => dist(r.pos, bot.pos) < 3.5 && (r.carrying >= 2 || bot.carrying >= 3));
      return close ? bot.heading : null;
    }
    case 'projectile': {
      const speed = def.projectileSpeed ?? 24;
      for (const r of rivals) {
        if (r.carrying < 3) continue;
        const d = dist(r.pos, bot.pos);
        if (d > 15) continue;
        // Lead the target along its facing if it's moving.
        const t = d / speed;
        const lead = r.moving ? { x: Math.sin(r.heading) * C.PLAYER_SPEED * t, z: Math.cos(r.heading) * C.PLAYER_SPEED * t } : { x: 0, z: 0 };
        const aimAt = { x: r.pos.x + lead.x, z: r.pos.z + lead.z };
        if (clearShot(aimAt)) return dirToHeading(dirTo(bot.pos, aimAt));
      }
      return null;
    }
    case 'rush': {
      const prey = rivals.find((r) => r.carrying >= 3 && dist(r.pos, bot.pos) < 8 && clearShot(r.pos));
      if (!prey) return null;
      mem.mode = 'ram';
      mem.refId = prey.id;
      mem.target = { ...prey.pos };
      mem.think = def.duration;
      return dirToHeading(dirTo(bot.pos, prey.pos));
    }
  }
  return null;
}

/**
 * Next point to steer toward on a smoothed A* path to `target`. Re-plans when
 * the goal moves, the path is stale, or we fell off it.
 */
function followPath(nav: NavGrid, bot: PlayerState, mem: BotMemory, target: Vec2, dt: number): Vec2 {
  mem.pathAge += dt;
  const goalMoved = !mem.pathGoal || dist2(mem.pathGoal, target) > 4;
  if (!mem.path || goalMoved || mem.pathAge > 1.2) {
    mem.path = nav.findPath(bot.pos, target);
    mem.pathIdx = 0;
    mem.pathGoal = { ...target };
    mem.pathAge = 0;
  }
  const path = mem.path;
  if (!path || path.length === 0) return target;
  while (mem.pathIdx < path.length - 1 && dist2(bot.pos, path[mem.pathIdx]) < 0.8 * 0.8) mem.pathIdx++;
  return mem.pathIdx < path.length ? path[mem.pathIdx] : target;
}
