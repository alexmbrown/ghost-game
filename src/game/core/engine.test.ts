// Headless tests for the authoritative simulation. Run: npm test

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultCharacter } from './characters';
import * as C from './constants';
import { GameEngine } from './engine';
import { MAP_IDS, MAPS } from './maps';
import { carriedSpiritPos, forEachSpirit, insideObstacle, recordTrail } from './movement';
import type { PlayerState, RosterEntry, TeamId, Vec2 } from './types';

function human(id: string, team: TeamId, character = defaultCharacter(team)): RosterEntry {
  return { id, name: id, team, isBot: false, character };
}
function bot(id: string, team: TeamId): RosterEntry {
  return { id, name: id, team, isBot: true, character: defaultCharacter(team) };
}

/** Engine already past the countdown, with no loose spirits or specials. */
function playing(roster: RosterEntry[], opts: { remote?: string[]; seed?: number; map?: string } = {}) {
  const e = new GameEngine({ roster, seed: opts.seed ?? 1, remoteIds: opts.remote, mapId: opts.map });
  e.step(C.COUNTDOWN_SECONDS + 0.01);
  e.state.flames.length = 0;
  e.state.flameSpawnTimer = 9999;
  e.state.megaSpawnTimer = 9999;
  e.state.pumpkin.respawnIn = 9999;
  e.drainEvents();
  return e;
}

function p(e: GameEngine, id: string): PlayerState {
  const pl = e.getPlayer(id);
  assert.ok(pl, `player ${id}`);
  return pl;
}

/**
 * Head of an open horizontal strip: `length` units of clear ground running -x
 * from the returned point, with `side` units of clearance on both sides and
 * well away from every base. Keeps tests independent of map layouts.
 */
function openStrip(e: GameEngine, length = 12, side = 2.5): Vec2 {
  const s = e.state;
  const H = s.arenaHalf;
  for (let z = -H + 5; z < H - 5; z += 1) {
    for (let x = -H + 5 + length; x < H - 5; x += 1) {
      let ok = s.bases.every((b) => Math.hypot(b.pos.x - x, b.pos.z - z) > 10 + length);
      for (let dx = -length - 1; ok && dx <= 2; dx += 0.5) {
        for (let dz = -side; ok && dz <= side; dz += 0.5) {
          if (insideObstacle(s.obstacles, { x: x + dx, z: z + dz }, 0.9)) ok = false;
        }
      }
      if (ok) return { x, z };
    }
  }
  throw new Error('no open strip on this map');
}

/** Give a player a straight trail heading +x ending at `head`, carrying n spirits. */
function giveTrail(pl: PlayerState, head: Vec2, n: number) {
  pl.pos = { ...head };
  pl.trail = [];
  for (let i = 0; i < n + C.TRAIL_FLAME_OFFSET + 2; i++) {
    pl.trail.push({ x: head.x - i * C.TRAIL_SPACING, z: head.z });
  }
  pl.carrying = n;
}

const STILL = { x: 0, z: 0 };

describe('countdown', () => {
  it('freezes players then starts the round', () => {
    const e = new GameEngine({ roster: [human('a', 0)], seed: 3 });
    const start = { ...p(e, 'a').pos };
    e.setInput('a', { x: 1, z: 0 });
    for (let i = 0; i < 60; i++) e.step(C.FIXED_DT);
    assert.equal(e.state.phase, 'countdown');
    assert.deepEqual(p(e, 'a').pos, start);
    for (let i = 0; i < 150; i++) e.step(C.FIXED_DT);
    assert.equal(e.state.phase, 'playing');
    assert.ok(e.drainEvents().some((ev) => ev.type === 'phase' && ev.phase === 'playing'));
  });
});

describe('collect and bank', () => {
  it('picks up spirits and banks them at the home base', () => {
    const e = playing([human('a', 0)]);
    const a = p(e, 'a');
    const spot = openStrip(e);
    a.pos = { ...spot };
    e.state.flames.push({ id: 999, pos: { ...spot } });
    e.setInput('a', STILL);
    e.step(C.FIXED_DT);
    assert.equal(a.carrying, 1);
    assert.equal(e.state.flames.length, 0);

    a.pos = { ...e.state.bases[0].pos };
    e.step(C.FIXED_DT);
    assert.equal(a.carrying, 0);
    assert.equal(e.state.bases[0].score, 1);
    assert.equal(a.bankedTotal, 1);
    const evs = e.drainEvents();
    assert.ok(evs.some((ev) => ev.type === 'pickup'));
    assert.ok(evs.some((ev) => ev.type === 'bank' && ev.amount === 1));
  });

  it('unlocks powers at banked thresholds', () => {
    const e = playing([human('a', 0)]);
    const a = p(e, 'a');
    a.pos = { ...e.state.bases[0].pos };
    a.carrying = C.POWER_SPEED_AT;
    e.step(C.FIXED_DT);
    assert.ok(e.drainEvents().some((ev) => ev.type === 'power' && ev.power === 'speed'));
  });

  it('scales the spirit budget with arena size', () => {
    const small = new GameEngine({ roster: [human('a', 0)], mapId: 'library', seed: 1 });
    const big = new GameEngine({ roster: [human('a', 0)], mapId: 'forest', seed: 1 });
    assert.ok(big.state.maxFlames > small.state.maxFlames);
    assert.ok(big.state.flames.length > small.state.flames.length);
  });
});

describe('carried spirit placement', () => {
  it('spaces spirits evenly by arc length from the head', () => {
    const trail: Vec2[] = [
      { x: 0, z: 0 },
      { x: -0.3, z: 0 }, // uneven crumb spacing must not matter
      { x: -2, z: 0 },
      { x: -2, z: -5 }, // corner
    ];
    const pts: Vec2[] = [];
    forEachSpirit(trail, { x: 0.5, z: 0 }, 5, (_k, x, z) => {
      pts.push({ x, z });
    });
    assert.equal(pts.length, 5);
    // First spirit sits TRAIL_FLAME_OFFSET spacings behind the head.
    const d0 = C.TRAIL_FLAME_OFFSET * C.TRAIL_SPACING;
    assert.ok(Math.abs(pts[0].x - (0.5 - d0)) < 1e-9);
    // Consecutive spirits are exactly one spacing apart along the path.
    const along = (q: Vec2) => (q.z === 0 ? 0.5 - q.x : 2.5 - q.z);
    for (let k = 1; k < pts.length; k++) {
      assert.ok(Math.abs(along(pts[k]) - along(pts[k - 1]) - C.TRAIL_SPACING) < 1e-9);
    }
    assert.deepEqual(carriedSpiritPos(trail, { x: 0.5, z: 0 }, 1), pts[1]);
  });
});

describe('stealing (Great Ghoul Duel rule)', () => {
  it('takes the touched spirit and everything behind it', () => {
    const e = playing([human('thief', 1), human('victim', 0)]);
    const v = p(e, 'victim');
    const t = p(e, 'thief');
    giveTrail(v, openStrip(e), 8);
    // Touch carried spirit index 3 from the side (neighbors are out of reach).
    const k = 3;
    const target = carriedSpiritPos(v.trail, v.pos, k)!;
    t.pos = { x: target.x, z: target.z + 0.8 };
    t.trail = [{ ...t.pos }];
    e.setInput('thief', STILL);
    e.setInput('victim', STILL);
    e.step(C.FIXED_DT);
    assert.equal(v.carrying, k);
    assert.equal(t.carrying, 8 - k);
    assert.ok(t.burstTimer > 0, 'thief gets a speed burst');
    const ev = e.drainEvents().find((x) => x.type === 'steal');
    assert.ok(ev && ev.type === 'steal' && ev.amount === 8 - k);
  });

  it('cannot steal from a pumpkin holder — and the holder stuns on contact', () => {
    const e = playing([human('a', 1), human('b', 0)]);
    const holder = p(e, 'b');
    const rival = p(e, 'a');
    const spot = openStrip(e);
    giveTrail(holder, spot, 5);
    holder.pumpkinTimer = 5;
    rival.carrying = 4;
    rival.trail = [{ x: spot.x + 0.5, z: spot.z }];
    rival.pos = { x: spot.x + 0.5, z: spot.z };
    e.step(C.FIXED_DT);
    assert.equal(holder.carrying, 5, 'holder keeps spirits');
    assert.ok(rival.stunTimer > 0, 'rival stunned');
    assert.equal(rival.carrying, 0, 'rival dropped spirits');
    assert.ok(e.state.flames.length >= 4, 'dropped spirits are on the ground');
  });
});

describe('buddy bonus', () => {
  it('gives both teammates the bonus with a cooldown', () => {
    const e = playing([human('a', 0), human('b', 0)]);
    const a = p(e, 'a');
    const b = p(e, 'b');
    giveTrail(b, openStrip(e), 3);
    const fp = carriedSpiritPos(b.trail, b.pos, 0)!;
    a.pos = { ...fp };
    a.trail = [{ ...fp }];
    e.step(C.FIXED_DT);
    assert.equal(a.carrying, C.BUDDY_BONUS);
    assert.equal(b.carrying, 3 + C.BUDDY_BONUS);
    e.step(C.FIXED_DT);
    assert.equal(a.carrying, C.BUDDY_BONUS, 'cooldown prevents repeat');
  });
});

describe('bases', () => {
  it('pushes rivals out of an enemy base', () => {
    const e = playing([human('a', 1), human('b', 0)]);
    const a = p(e, 'a');
    const enemyBase = e.state.bases[0].pos;
    a.pos = { x: enemyBase.x + 0.5, z: enemyBase.z + 0.5 };
    e.setInput('a', STILL);
    e.step(C.FIXED_DT);
    const d = Math.hypot(a.pos.x - enemyBase.x, a.pos.z - enemyBase.z);
    assert.ok(d >= C.BASE_BLOCK_RADIUS, `pushed out (d=${d.toFixed(2)})`);
  });
});

describe('remote client validation', () => {
  it('accepts plausible moves and clamps teleports with a warp', () => {
    const e = playing([human('r', 0)], { remote: ['r'] });
    const r = p(e, 'r');
    const start = { ...r.pos };
    e.reportRemote('r', { x: start.x + 0.1, z: start.z + 0.1, heading: 1, moving: true, warp: r.warp });
    e.step(C.FIXED_DT);
    assert.ok(Math.abs(r.pos.x - (start.x + 0.1)) < 1e-6);
    assert.equal(r.warp, 0);

    e.reportRemote('r', { x: 0, z: 0, heading: 1, moving: true, warp: r.warp });
    e.step(C.FIXED_DT);
    assert.ok(Math.hypot(r.pos.x - start.x, r.pos.z - start.z) < 5, 'teleport rejected');
    assert.equal(r.warp, 1, 'client told to snap');

    // Stale warp counter: ignored entirely.
    const before = { ...r.pos };
    e.reportRemote('r', { x: before.x + 0.2, z: before.z, heading: 0, moving: true, warp: 0 });
    e.step(C.FIXED_DT);
    assert.deepEqual(r.pos, before);
  });
});

describe('abilities', () => {
  it('Bone Toss knocks a rival’s spirits loose', () => {
    const e = playing([human('s', 2), human('v', 0)]);
    const sk = p(e, 's');
    const v = p(e, 'v');
    const spot = openStrip(e);
    // Victim's trail runs -x; the thrower stands 4 units ahead (+x) and aims back (-x).
    giveTrail(v, { x: spot.x - 2, z: spot.z }, 6);
    sk.pos = { x: spot.x + 2, z: spot.z };
    e.setInput('s', { x: 0, z: 0, aim: -Math.PI / 2, ability: true });
    e.setInput('v', STILL);
    for (let i = 0; i < 30; i++) e.step(C.FIXED_DT);
    assert.equal(v.carrying, 0);
    assert.ok(e.state.flames.length >= 6);
    assert.ok(e.drainEvents().some((ev) => ev.type === 'knock'));
    assert.ok(sk.ability.cooldown > 0);
  });

  it('Bone Toss flies over ponds and logs but not walls', () => {
    const e = playing([human('s', 2)], { map: 'forest' });
    const pond = e.state.obstacles.find((o) => o.kind === 'water')!;
    const sk = p(e, 's');
    // Stand just west of the pond and throw east across it.
    sk.pos = { x: pond.min.x - 1.5, z: (pond.min.z + pond.max.z) / 2 };
    e.setInput('s', { x: 0, z: 0, aim: Math.PI / 2, ability: true });
    e.step(C.FIXED_DT);
    for (let i = 0; i < 12; i++) e.step(C.FIXED_DT);
    assert.ok(e.state.projectiles.length === 1, 'bone still flying over the water');
  });

  it('Phase Dash passes through a crypt', () => {
    const e = playing([human('g', 0)]);
    const g = p(e, 'g');
    // A thin crypt row (≤ 3.5 units deep along z) to dash through northward.
    const crypt = e.state.obstacles.find((o) => o.kind === 'crypt' && o.max.z - o.min.z <= 3.5 && o.max.x - o.min.x >= 3)!;
    assert.ok(crypt, 'map has a crypt row');
    g.pos = { x: (crypt.min.x + crypt.max.x) / 2, z: crypt.min.z - 1.8 };
    e.setInput('g', { x: 0, z: 1, aim: 0, ability: true }); // heading 0 = +z
    for (let i = 0; i < 40; i++) e.step(C.FIXED_DT);
    assert.ok(g.pos.z > crypt.max.z, `dashed through (z=${g.pos.z.toFixed(2)} > ${crypt.max.z})`);
  });

  it('Grave Grasp slows rivals inside the field', () => {
    const e = playing([human('z', 1), human('v', 0)]);
    const z = p(e, 'z');
    const v = p(e, 'v');
    const spot = openStrip(e);
    z.pos = { x: spot.x - 4, z: spot.z };
    v.pos = { x: spot.x - 3, z: spot.z };
    e.setInput('z', { x: 0, z: 0, aim: 0, ability: true });
    e.setInput('v', { x: 1, z: 0 });
    e.step(C.FIXED_DT);
    const x0 = v.pos.x;
    for (let i = 0; i < 6; i++) e.step(C.FIXED_DT);
    const moved = v.pos.x - x0;
    const normal = C.PLAYER_SPEED * C.FIXED_DT * 6;
    assert.ok(moved < normal * 0.6, `slowed (${moved.toFixed(3)} < ${normal.toFixed(3)})`);
  });
});

describe('trail recording', () => {
  it('fills long jumps with evenly spaced crumbs', () => {
    const trail: Vec2[] = [{ x: 0, z: 0 }];
    recordTrail(trail, { x: 3.5, z: 0 });
    assert.equal(trail.length, 6);
    assert.ok(Math.abs(trail[0].x - 3.5) < 1e-9);
  });
});

describe('maps', () => {
  for (const id of MAP_IDS) {
    it(`${id}: bases, pumpkin and mega spawns are open and connected`, () => {
      const roster = ([0, 1, 2, 3] as TeamId[]).map((t) => bot(`b${t}`, t));
      const e = new GameEngine({ roster, mapId: id, seed: 1 });
      const s = e.state;
      const def = MAPS[id];
      for (const pt of [def.pumpkin, ...def.megaSpawns]) {
        assert.ok(!insideObstacle(s.obstacles, pt, 0.5), `${id}: ${JSON.stringify(pt)} is clear`);
      }
      for (const pl of s.players) {
        assert.ok(!insideObstacle(s.obstacles, pl.pos, 0.5), `${id}: spawn of ${pl.id} is clear`);
        const nav = e.navFor(pl.team);
        // Every team can reach the pumpkin, every mega spawn and every rival base's doorstep.
        assert.ok(nav.findPath(pl.pos, def.pumpkin), `${id}: team ${pl.team} reaches the pumpkin`);
        for (const m of def.megaSpawns) assert.ok(nav.findPath(pl.pos, m), `${id}: team ${pl.team} reaches mega spawn`);
        for (const b of s.bases) {
          if (b.team === pl.team) continue;
          const toward = { x: b.pos.x * 0.72, z: b.pos.z * 0.72 };
          assert.ok(nav.findPath(pl.pos, toward), `${id}: team ${pl.team} reaches near base ${b.team}`);
        }
      }
    });
  }
});

describe('full bot round', () => {
  for (const map of MAP_IDS) {
    it(`plays a 4-team round on ${map} without breaking invariants`, () => {
      const roster: RosterEntry[] = [];
      for (const team of [0, 1, 2, 3] as TeamId[]) {
        roster.push(bot(`b${team}a`, team), bot(`b${team}b`, team));
      }
      const e = new GameEngine({ roster, seed: 42, mapId: map, roundSeconds: 60 });
      const H = e.state.arenaHalf;
      let steps = 0;
      while (e.state.phase !== 'ended' && steps < 60 * 70) {
        e.step(C.FIXED_DT);
        steps++;
        if (steps % 30 === 0) {
          for (const pl of e.state.players) {
            assert.ok(Number.isFinite(pl.pos.x) && Number.isFinite(pl.pos.z), 'finite position');
            assert.ok(Math.abs(pl.pos.x) <= H && Math.abs(pl.pos.z) <= H, 'in arena');
            const phasing = e.flagsFor(pl) & (64 | 4);
            if (!phasing && pl.stunTimer <= 0) {
              assert.ok(!insideObstacle(e.state.obstacles, pl.pos, -0.05), `${pl.id} not inside a wall`);
            }
          }
          assert.ok(e.state.flames.length <= C.MAX_LOOSE_FLAMES);
        }
      }
      assert.equal(e.state.phase, 'ended');
      const total = e.state.bases.reduce((a, b) => a + b.score, 0);
      assert.ok(total > 20, `bots banked spirits on ${map} (total=${total})`);
    });
  }

  it('is deterministic for a given seed', () => {
    const run = () => {
      const roster = ([0, 1, 2, 3] as TeamId[]).map((t) => bot(`b${t}`, t));
      const e = new GameEngine({ roster, seed: 7, roundSeconds: 30 });
      while (e.state.phase !== 'ended') e.step(C.FIXED_DT);
      return e.state.bases.map((b) => b.score).join(',');
    };
    assert.equal(run(), run());
  });
});

describe('round end', () => {
  it('declares a draw on tied active teams and ignores inactive bases', () => {
    const e = playing([human('a', 0), human('b', 1)]);
    e.state.bases[0].score = 5;
    e.state.bases[1].score = 5;
    e.state.timeRemaining = 0.001;
    e.step(C.FIXED_DT);
    assert.equal(e.state.phase, 'ended');
    assert.equal(e.state.winner, null);
    assert.equal(e.state.bases[2].active, false);
  });
});
