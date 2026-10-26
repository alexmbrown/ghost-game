// Runs the authoritative GameEngine locally. Used for offline play vs bots and
// for the online host (with `broadcast` set, it streams snapshots to clients).

import * as C from '../core/constants';
import { GameEngine } from '../core/engine';
import { FX } from '../core/movement';
import type { GameEvent, RosterEntry, TeamId } from '../core/types';
import { encodeSnapshot, type Snapshot } from '../net/protocol';
import { makeView, updateViewTrail } from './common';
import { Interp } from './interp';
import { freshEvents, type GameSession, type LocalInput, type ViewState } from './types';

export interface HostSessionOptions {
  roster: RosterEntry[];
  localId: string;
  mapId: string;
  roundSeconds: number;
  botDifficulty: C.BotDifficulty;
  matchId?: number;
  /** Remote human player ids (their movement is client-reported). */
  remoteIds?: string[];
  /** Online host: send a snapshot to every client. */
  broadcast?: (snap: Snapshot) => void;
  /** Offline only: pause the sim (e.g. while the tab is hidden). */
  isPaused?: () => boolean;
  seed?: number;
}

export class HostSession implements GameSession {
  readonly engine: GameEngine;
  readonly localId: string;
  readonly online: boolean;
  readonly isHost = true;
  readonly view: ViewState;
  readonly roster: RosterEntry[];
  readonly matchId: number;

  private readonly opts: HostSessionOptions;
  private readonly remote: Set<string>;
  private input: LocalInput = { x: 0, z: 0, aim: 0 };
  private abilityPressed = false;
  private lastNow = -1;
  private acc = 0;
  private ticks = 0;
  private interps = new Map<string, Interp>();
  private lastPush = new Map<string, number>();
  /** Per remote client: host-time offset of their clock, and the mapped time of their latest report. */
  private clockOffset = new Map<string, number>();
  private reportTime = new Map<string, number>();
  /** Events for the renderer, stamped with when they happened (wall clock). */
  private viewEvents: { ev: GameEvent; at: number }[] = [];
  private netEvents: GameEvent[] = [];
  private flameVersionSent = -1;
  private lastFullFlames = 0;
  private sample = { x: 0, z: 0, heading: 0 };

  constructor(opts: HostSessionOptions) {
    this.opts = opts;
    this.localId = opts.localId;
    this.roster = opts.roster;
    this.matchId = opts.matchId ?? 0;
    this.online = !!opts.broadcast;
    this.remote = new Set(opts.remoteIds ?? []);
    this.engine = new GameEngine({
      roster: opts.roster,
      mapId: opts.mapId,
      roundSeconds: opts.roundSeconds,
      botDifficulty: opts.botDifficulty,
      remoteIds: opts.remoteIds,
      seed: opts.seed,
    });
    this.view = makeView(this.engine.state, opts.roster, opts.localId);
    for (const p of this.engine.state.players) {
      const ip = new Interp();
      ip.reset(0, p.pos.x, p.pos.z, p.heading);
      this.interps.set(p.id, ip);
    }
  }

  setInput(input: LocalInput): void {
    this.input = input;
  }

  pressAbility(): void {
    this.abilityPressed = true;
  }

  // --- networking hooks (online host) ----------------------------------------

  onRemotePos(peerId: string, x: number, z: number, heading: number, moving: boolean, warp: number, clientT = -1): void {
    if (!this.remote.has(peerId)) return;
    this.engine.reportRemote(peerId, { x, z, heading, moving, warp });
    if (clientT < 0) return;
    // Place the sample on our timeline by the CLIENT's clock (evenly spaced),
    // not by arrival time (bursty) — keeps their motion smooth for the host.
    const hostNow = this.simNowMs(performance.now());
    const sample = hostNow - clientT;
    const prev = this.clockOffset.get(peerId);
    let off: number;
    if (prev === undefined || sample < prev) off = sample; // least-delayed arrival wins
    else off = prev + (sample - prev) * 0.01; // slow drift correction
    if (prev !== undefined && Math.abs(sample - prev) > 1000) off = sample; // clock jump / tab resumed
    this.clockOffset.set(peerId, off);
    this.reportTime.set(peerId, clientT + off);
  }

  /** Simulated host time (ms) corresponding to wall-clock `now`. */
  private simNowMs(now: number): number {
    return this.engine.state.time * 1000 + this.acc * 1000 + Math.max(0, now - this.lastNow);
  }

  onRemoteAbility(peerId: string, heading: number): void {
    if (!this.remote.has(peerId)) return;
    this.engine.requestAbility(peerId, heading);
  }

  onPeerLeft(peerId: string): void {
    this.engine.removePlayer(peerId);
  }

  // --- simulation -------------------------------------------------------------

  tick(now: number): void {
    if (this.lastNow < 0) this.lastNow = now;
    const dt = Math.min((now - this.lastNow) / 1000, 0.25);
    this.lastNow = now;
    if (this.opts.isPaused?.()) return;

    this.acc += dt;
    let steps = 0;
    const s = this.engine.state;
    while (this.acc >= C.FIXED_DT && steps < 15) {
      this.engine.setInput(this.localId, { ...this.input, ability: this.abilityPressed });
      this.abilityPressed = false;
      this.engine.step(C.FIXED_DT);
      this.acc -= C.FIXED_DT;
      steps++;
      this.ticks++;

      const evs = this.engine.drainEvents();
      if (evs.length) {
        for (const ev of evs) this.viewEvents.push({ ev, at: now });
        if (this.online) this.netEvents.push(...evs);
      }

      const t = s.time * 1000;
      for (const p of s.players) {
        const ip = this.interps.get(p.id)!;
        const latest = ip.latest;
        const jumped = latest && Math.hypot(latest.x - p.pos.x, latest.z - p.pos.z) > 6;
        if (jumped) {
          ip.reset(t, p.pos.x, p.pos.z, p.heading);
          continue;
        }
        if (this.remote.has(p.id)) {
          // Remote reports land at ~30 Hz: push each accepted report once,
          // stamped with the client's own (mapped) send time.
          const changed = !latest || latest.x !== p.pos.x || latest.z !== p.pos.z || latest.h !== p.heading;
          const last = this.lastPush.get(p.id) ?? 0;
          const stamp = Math.min(this.reportTime.get(p.id) ?? t, t);
          if (changed && stamp > last) {
            ip.push(stamp, p.pos.x, p.pos.z, p.heading);
            this.lastPush.set(p.id, stamp);
          } else if (t - last > 250) {
            ip.push(t, p.pos.x, p.pos.z, p.heading); // idle: keep the buffer fresh
            this.lastPush.set(p.id, t);
          }
        } else {
          ip.push(t, p.pos.x, p.pos.z, p.heading);
        }
      }

      if (this.online && this.ticks % C.SNAPSHOT_EVERY_TICKS === 0) this.sendSnapshot();
    }
    if (steps === 15) this.acc = 0; // way behind (tab was frozen): don't spiral
  }

  private sendSnapshot(): void {
    const s = this.engine.state;
    // Resend the full flame list when it changed, and at least once a second.
    const includeFlames = s.flameVersion !== this.flameVersionSent || s.time - this.lastFullFlames > 1;
    if (includeFlames) {
      this.flameVersionSent = s.flameVersion;
      this.lastFullFlames = s.time;
    }
    const snap = encodeSnapshot(this.engine, this.matchId, this.roster, this.netEvents, includeFlames);
    this.netEvents = [];
    this.opts.broadcast?.(snap);
  }

  /** Force a final snapshot (round end) so clients get stats immediately. */
  flush(): void {
    if (this.online) this.sendSnapshot();
  }

  updateView(now: number): void {
    const s = this.engine.state;
    const v = this.view;
    // Sim time "now" = simulated time + real time not yet simulated.
    const simNow = this.simNowMs(now);
    const localT = simNow - C.FIXED_DT * 1000 * 1.2;
    const remoteT = simNow - C.INTERP_DELAY_MS;

    v.phase = s.phase;
    v.countdown = s.countdown;
    v.timeRemaining = s.timeRemaining;
    v.scores[0] = s.bases[0].score;
    v.scores[1] = s.bases[1].score;
    v.scores[2] = s.bases[2].score;
    v.scores[3] = s.bases[3].score;
    v.winner = s.winner;
    v.flames = s.flames;
    v.arenaHalf = s.arenaHalf;

    const byId = new Map(s.players.map((p) => [p.id, p]));
    for (const vp of v.players) {
      const p = byId.get(vp.id);
      if (!p) continue;
      const ip = this.interps.get(p.id)!;
      ip.sample(this.remote.has(p.id) ? remoteT : localT, this.sample);
      vp.x = this.sample.x;
      vp.z = this.sample.z;
      vp.heading = p.id === this.localId ? this.input.aim : this.sample.heading;
      vp.moving = p.moving;
      vp.carrying = p.carrying;
      vp.flags = this.engine.flagsFor(p);
      vp.bankedTotal = p.bankedTotal;
      vp.abilityCooldown = p.ability.cooldown;
      vp.left = p.left;
      vp.stats = p.stats;
      updateViewTrail(vp, p.left || (vp.flags & FX.STUN) !== 0);
    }

    v.megas.length = 0;
    for (const m of s.megas) v.megas.push({ id: m.id, x: m.pos.x, z: m.pos.z });
    v.projectiles.length = 0;
    for (const pr of s.projectiles) v.projectiles.push({ id: pr.id, x: pr.pos.x, z: pr.pos.z, team: pr.team });
    v.fields.length = 0;
    for (const f of s.fields) v.fields.push({ id: f.id, x: f.pos.x, z: f.pos.z, radius: f.radius, team: f.team, ttl: f.ttl });
    v.pumpkin.x = s.pumpkin.pos.x;
    v.pumpkin.z = s.pumpkin.pos.z;
    v.pumpkin.available = s.pumpkin.available;
  }

  drainEvents(): GameEvent[] {
    const out = freshEvents(this.viewEvents);
    this.viewEvents = [];
    return out;
  }

  /** Teams that have at least one player (for UI). */
  activeTeams(): TeamId[] {
    return this.engine.state.bases.filter((b) => b.active).map((b) => b.team);
  }

  dispose(): void {
    this.viewEvents = [];
    this.netEvents = [];
  }
}
