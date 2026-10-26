// Online client. The host is authoritative; we:
//  - predict our OWN movement locally with the same movement code the host
//    uses (instant response), and report it at 30 Hz for host validation;
//  - predict our own flame pickups and ability presses for instant feedback;
//  - render everyone else from 20 Hz snapshots, interpolated ~110 ms behind.

import { abilityFor } from '../core/characters';
import * as C from '../core/constants';
import { GameEngine } from '../core/engine';
import {
  FX,
  headingToDir,
  isPhasing,
  resolveCollisions,
  speedFromFlags,
  stepMovement,
} from '../core/movement';
import type { BaseState, FlameState, GameEvent, Obstacle, RosterEntry, TeamId, Vec2 } from '../core/types';
import { records, SNAP_LEFT, type AbilityPress, type MatchStart, type PosReport, type Snapshot } from '../net/protocol';
import { makeView, updateViewTrail } from './common';
import { Interp } from './interp';
import { freshEvents, type GameSession, type LocalInput, type ViewState } from './types';

export interface ClientSessionOptions {
  start: MatchStart;
  localId: string;
  sendPos: (r: PosReport) => void;
  sendAbility: (a: AbilityPress) => void;
}

const PHASES = ['countdown', 'playing', 'ended'] as const;

export class ClientSession implements GameSession {
  readonly localId: string;
  readonly online = true;
  readonly isHost = false;
  readonly view: ViewState;
  readonly matchId: number;
  readonly roster: RosterEntry[];

  private readonly opts: ClientSessionOptions;
  private readonly obstacles: readonly Obstacle[];
  private readonly bases: readonly BaseState[];
  private readonly half: number;
  private readonly team: TeamId;
  private readonly character: string;

  // local prediction
  private pos: Vec2;
  private prevDash = 0;
  private warp = 0;
  private serverFlags = 0;
  private serverCarrying = 0;
  private serverCooldown = 0;
  private dash = 0;
  private dashDir: Vec2 = { x: 0, z: 1 };
  private rush = 0;
  private predCooldown = 0;
  private moving = false;
  private input: LocalInput = { x: 0, z: 0, aim: 0 };
  private localInterp = new Interp();
  private localSimMs = 0;

  private lastNow = -1;
  private acc = 0;
  private ticks = 0;

  // remote state
  private interps = new Map<string, Interp>();
  private megaInterps = new Map<number, Interp>();
  private projInterps = new Map<number, { ip: Interp; team: TeamId }>();
  private clockOffset: number | null = null;
  private flames: FlameState[] = [];
  private pending = new Map<number, number>(); // flame id -> expiry (ms)
  private visibleFlamesDirty = true;
  private events: { ev: GameEvent; at: number }[] = [];
  private snapArrivals: number[] = [];
  private sample = { x: 0, z: 0, heading: 0 };
  private localEventId = -1;

  constructor(opts: ClientSessionOptions) {
    this.opts = opts;
    this.localId = opts.localId;
    this.matchId = opts.start.matchId;
    this.roster = opts.start.roster;
    // Build the same initial layout the host built (spawns are deterministic).
    const layout = new GameEngine({
      roster: opts.start.roster,
      mapId: opts.start.mapId,
      roundSeconds: opts.start.roundSeconds,
      seed: 1,
    });
    layout.state.flames.length = 0;
    this.obstacles = layout.state.obstacles;
    this.bases = layout.state.bases;
    this.half = layout.state.arenaHalf;
    this.view = makeView(layout.state, opts.start.roster, opts.localId);
    const me = layout.getPlayer(opts.localId);
    this.pos = me ? { ...me.pos } : { x: 0, z: 0 };
    this.team = me?.team ?? 0;
    this.character = me?.character ?? 'boo';
    this.input.aim = me?.heading ?? 0;
    this.localInterp.reset(0, this.pos.x, this.pos.z, this.input.aim);
    for (const p of layout.state.players) {
      if (p.id === this.localId) continue;
      const ip = new Interp();
      ip.reset(0, p.pos.x, p.pos.z, p.heading);
      this.interps.set(p.id, ip);
    }
  }

  setInput(input: LocalInput): void {
    this.input = input;
  }

  pressAbility(): void {
    if (this.view.phase !== 'playing') return;
    if (this.serverFlags & (FX.STUN | FX.STAGGER)) return;
    if (this.predCooldown > 0 || this.serverCooldown > 0.15) return;
    const def = abilityFor(this.character);
    this.opts.sendAbility([Math.round(this.input.aim * 1000)]);
    this.predCooldown = def.cooldown;
    if (def.kind === 'dash') {
      this.dash = def.duration;
      this.dashDir = headingToDir(this.input.aim);
    } else if (def.kind === 'rush') {
      this.rush = def.duration;
    }
    this.events.push({
      ev: { id: this.localEventId--, type: 'ability', player: this.localId, ability: def.id, x: this.pos.x, z: this.pos.z },
      at: performance.now(),
    });
  }

  // --- prediction ---------------------------------------------------------------

  tick(now: number): void {
    if (this.lastNow < 0) this.lastNow = now;
    const dt = Math.min((now - this.lastNow) / 1000, 0.25);
    this.lastNow = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= C.FIXED_DT && steps < 15) {
      this.stepLocal(C.FIXED_DT, now);
      this.acc -= C.FIXED_DT;
      steps++;
      this.ticks++;
      this.localSimMs += C.FIXED_DT * 1000;
      this.localInterp.push(this.localSimMs, this.pos.x, this.pos.z, this.input.aim);
      if (this.ticks % Math.round(60 / C.CLIENT_SEND_HZ) === 0) {
        this.opts.sendPos([
          Math.round(this.pos.x * 100),
          Math.round(this.pos.z * 100),
          Math.round(this.input.aim * 1000),
          this.moving ? 1 : 0,
          this.warp,
          Math.round(this.localSimMs),
        ]);
      }
    }
    if (steps === 15) this.acc = 0;

    // Expire predicted pickups the host never confirmed.
    for (const [id, exp] of this.pending) {
      if (now > exp) {
        this.pending.delete(id);
        this.visibleFlamesDirty = true;
      }
    }
  }

  private stepLocal(dt: number, now: number): void {
    this.predCooldown = Math.max(0, this.predCooldown - dt);
    this.prevDash = this.dash;
    this.dash = Math.max(0, this.dash - dt);
    this.rush = Math.max(0, this.rush - dt);

    const frozen =
      this.view.phase !== 'playing' || (this.serverFlags & (FX.STUN | FX.STAGGER)) !== 0;
    if (frozen) {
      this.moving = false;
      this.dash = 0;
      this.rush = 0;
      return;
    }

    let flags = this.serverFlags & ~(FX.DASH | FX.RUSH);
    if (this.dash > 0) flags |= FX.DASH;
    if (this.rush > 0) flags |= FX.RUSH;
    const dir = this.dash > 0 ? this.dashDir : { x: this.input.x, z: this.input.z };
    this.moving = stepMovement(
      this.pos,
      dir,
      speedFromFlags(flags),
      dt,
      this.team,
      isPhasing(flags),
      this.obstacles,
      this.bases,
      this.half,
    );
    if (this.prevDash > 0 && this.dash === 0) {
      resolveCollisions(this.pos, this.team, isPhasing(flags & ~FX.DASH), this.obstacles, this.bases, this.half);
    }

    // Predicted pickups: hide the flame and play feedback now; the host confirms.
    const r = flags & FX.MAGNET ? C.POWER_MAGNET_RADIUS : C.FLAME_PICKUP_RADIUS;
    for (const f of this.flames) {
      if (this.pending.has(f.id)) continue;
      const dx = f.pos.x - this.pos.x;
      const dz = f.pos.z - this.pos.z;
      if (dx * dx + dz * dz <= r * r) {
        this.pending.set(f.id, now + 700);
        this.visibleFlamesDirty = true;
        this.events.push({
          ev: { id: this.localEventId--, type: 'pickup', player: this.localId, x: f.pos.x, z: f.pos.z },
          at: now,
        });
      }
    }
  }

  // --- snapshots ----------------------------------------------------------------

  onSnapshot(snap: Snapshot): void {
    if (snap.m !== this.matchId) return;
    const now = performance.now();
    this.snapArrivals.push(now);
    while (this.snapArrivals.length && now - this.snapArrivals[0] > 1000) this.snapArrivals.shift();

    // Clock sync: track the fastest-arriving offset (least queueing delay).
    const sampleOffset = snap.t - now;
    if (this.clockOffset === null) this.clockOffset = sampleOffset;
    else if (sampleOffset > this.clockOffset) this.clockOffset += (sampleOffset - this.clockOffset) * 0.3;
    else this.clockOffset += (sampleOffset - this.clockOffset) * 0.02;

    const v = this.view;
    v.phase = PHASES[snap.ph] ?? 'playing';
    v.countdown = snap.cd / 10;
    v.timeRemaining = snap.tr / 10;
    v.scores[0] = snap.sc[0];
    v.scores[1] = snap.sc[1];
    v.scores[2] = snap.sc[2];
    v.scores[3] = snap.sc[3];
    v.winner = snap.w >= 0 ? (snap.w as TeamId) : null;

    for (let i = 0; i < this.roster.length; i++) {
      const ps = snap.p[i];
      const vp = v.players[i];
      if (!ps || !vp) continue;
      const [qx, qz, qh, carrying, flags, warp, moving, cd, banked] = ps;
      const x = qx / 100;
      const z = qz / 100;
      const h = qh / 1000;
      vp.left = (flags & SNAP_LEFT) !== 0;
      vp.bankedTotal = banked;
      if (vp.id === this.localId) {
        if (warp !== this.warp) {
          // Host teleported us (respawn / correction): snap.
          this.warp = warp;
          this.pos = { x, z };
          this.dash = 0;
          this.rush = 0;
          this.localInterp.reset(this.localSimMs, x, z, this.input.aim);
          vp.trail.length = 0;
        }
        this.serverFlags = flags & ~SNAP_LEFT;
        this.serverCarrying = carrying;
        this.serverCooldown = cd / 10;
      } else {
        const ip = this.interps.get(vp.id)!;
        const latest = ip.latest;
        if (latest && Math.hypot(latest.x - x, latest.z - z) > 6) ip.reset(snap.t, x, z, h);
        else ip.push(snap.t, x, z, h);
        vp.moving = moving === 1;
        vp.carrying = carrying;
        vp.flags = flags & ~SNAP_LEFT;
        vp.abilityCooldown = cd / 10;
      }
    }

    if (snap.f) {
      const next: FlameState[] = [];
      const ids = new Set<number>();
      for (const [id, fx, fz] of records(snap.f, 3)) {
        next.push({ id, pos: { x: fx / 100, z: fz / 100 } });
        ids.add(id);
      }
      this.flames = next;
      // Pending pickups that vanished from the host's list are confirmed.
      for (const id of [...this.pending.keys()]) if (!ids.has(id)) this.pending.delete(id);
      this.visibleFlamesDirty = true;
    }

    const seenMegas = new Set<number>();
    for (const [id, mx, mz] of records(snap.mg, 3)) {
      seenMegas.add(id);
      let ip = this.megaInterps.get(id);
      if (!ip) {
        ip = new Interp();
        ip.reset(snap.t, mx / 100, mz / 100, 0);
        this.megaInterps.set(id, ip);
      } else ip.push(snap.t, mx / 100, mz / 100, 0);
    }
    for (const id of [...this.megaInterps.keys()]) if (!seenMegas.has(id)) this.megaInterps.delete(id);

    const seenProj = new Set<number>();
    for (const [id, px, pz, team] of records(snap.pr, 4)) {
      seenProj.add(id);
      const e = this.projInterps.get(id);
      if (!e) {
        const ip = new Interp();
        ip.reset(snap.t, px / 100, pz / 100, 0);
        this.projInterps.set(id, { ip, team: team as TeamId });
      } else e.ip.push(snap.t, px / 100, pz / 100, 0);
    }
    for (const id of [...this.projInterps.keys()]) if (!seenProj.has(id)) this.projInterps.delete(id);

    v.fields.length = 0;
    for (const [id, fx, fz, r, team, ttl] of records(snap.fl, 6)) {
      v.fields.push({ id, x: fx / 100, z: fz / 100, radius: r / 10, team: team as TeamId, ttl: ttl / 10 });
    }
    v.pumpkin.x = snap.pk[0] / 100;
    v.pumpkin.z = snap.pk[1] / 100;
    v.pumpkin.available = snap.pk[2] === 1;

    for (const ev of snap.ev) {
      // We already played these locally (prediction).
      if (ev.type === 'pickup' && ev.player === this.localId && !ev.mega) continue;
      if (ev.type === 'ability' && ev.player === this.localId) continue;
      this.events.push({ ev, at: now });
    }

    if (snap.st) {
      snap.st.forEach((st, i) => {
        const vp = v.players[i];
        if (vp) vp.stats = { banked: st[0], steals: st[1], stolenFrom: st[2], stuns: st[3], pickups: st[4] };
      });
    }
  }

  // --- view ------------------------------------------------------------------------

  updateView(now: number): void {
    const v = this.view;
    const hostNow = now + (this.clockOffset ?? 0);
    const remoteT = hostNow - C.INTERP_DELAY_MS;
    const localT = this.localSimMs + this.acc * 1000 + Math.max(0, now - this.lastNow) - C.FIXED_DT * 1000 * 1.2;

    for (const vp of v.players) {
      if (vp.id === this.localId) {
        this.localInterp.sample(localT, this.sample);
        vp.x = this.sample.x;
        vp.z = this.sample.z;
        vp.heading = this.input.aim;
        vp.moving = this.moving;
        vp.carrying = this.serverCarrying + this.pending.size;
        let flags = this.serverFlags & ~(FX.DASH | FX.RUSH);
        if (this.dash > 0) flags |= FX.DASH;
        if (this.rush > 0) flags |= FX.RUSH;
        vp.flags = flags;
        vp.abilityCooldown = Math.max(this.predCooldown, this.serverCooldown);
      } else {
        const ip = this.interps.get(vp.id);
        if (ip?.sample(remoteT, this.sample)) {
          vp.x = this.sample.x;
          vp.z = this.sample.z;
          vp.heading = this.sample.heading;
        }
      }
      updateViewTrail(vp, vp.left || (vp.flags & FX.STUN) !== 0);
    }

    if (this.visibleFlamesDirty) {
      v.flames = this.pending.size ? this.flames.filter((f) => !this.pending.has(f.id)) : this.flames;
      this.visibleFlamesDirty = false;
    }

    v.megas.length = 0;
    for (const [id, ip] of this.megaInterps) {
      ip.sample(remoteT, this.sample);
      v.megas.push({ id, x: this.sample.x, z: this.sample.z });
    }
    v.projectiles.length = 0;
    for (const [id, e] of this.projInterps) {
      e.ip.sample(remoteT, this.sample);
      v.projectiles.push({ id, x: this.sample.x, z: this.sample.z, team: e.team });
    }
  }

  drainEvents(): GameEvent[] {
    const out = freshEvents(this.events);
    this.events = [];
    return out;
  }

  /** Snapshots received in the last second. */
  get snapshotHz(): number {
    return this.snapArrivals.length;
  }

  dispose(): void {
    this.events = [];
  }
}
