// Online play orchestration (host or client) on top of NetRoom.
//
// Host:   owns the LobbyState, accepts hellos, assigns teams, starts matches
//         (HostSession broadcasts snapshots), returns everyone to the lobby.
// Client: finds the host by room code, mirrors the lobby, and runs a
//         ClientSession during matches.
//
// UI state is pushed out through `onUpdate`; the zustand store subscribes.

import { isCharacterFor } from '../core/characters';
import * as C from '../core/constants';
import type { TeamId } from '../core/types';
import { ClientSession } from '../session/clientSession';
import { HostSession } from '../session/hostSession';
import type { GameSession } from '../session/types';
import { applySettings, buildRoster, canJoinTeam, canStart, DEFAULT_SETTINGS, pickTeam } from './lobbyLogic';
import {
  isTeamId,
  parsePosReport,
  PROTOCOL_VERSION,
  sanitizeName,
  type AbilityPress,
  type Hello,
  type Kick,
  type LobbyRequest,
  type LobbySettings,
  type LobbyState,
  type MatchStart,
  type PosReport,
  type Snapshot,
} from './protocol';
import { NetRoom } from './transport';

export type OnlineRole = 'host' | 'client';
export type OnlineStatus = 'connecting' | 'searching' | 'lobby' | 'match' | 'closed';

export interface OnlineSnapshot {
  role: OnlineRole;
  code: string;
  selfId: string;
  status: OnlineStatus;
  error: string | null;
  lobby: LobbyState | null;
  pings: Record<string, number>;
  relays: number;
  /** Bumps every time a new match session starts (remounts the 3D world). */
  sessionId: number;
}

const KICK_TEXT: Record<Kick['reason'], string> = {
  full: 'That room is full (16 players).',
  version: 'Your game version does not match the host’s. Refresh the page.',
  'host-left': 'The host left the room.',
  kicked: 'You were removed from the room.',
};

export class OnlineGame {
  readonly role: OnlineRole;
  readonly code: string;
  readonly room: NetRoom;
  session: GameSession | null = null;

  private name: string;
  private hostId: string | null = null;
  private lobby: LobbyState | null = null;
  private status: OnlineStatus = 'connecting';
  private error: string | null = null;
  private pings: Record<string, number> = {};
  private sessionId = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private closed = false;
  private readonly createdAt = performance.now();

  constructor(
    role: OnlineRole,
    code: string,
    name: string,
    private readonly onUpdate: (s: OnlineSnapshot) => void,
  ) {
    this.role = role;
    this.code = code;
    this.name = sanitizeName(name);
    this.room = new NetRoom(code);
    this.wire();

    if (role === 'host') {
      this.hostId = this.room.selfId;
      this.lobby = {
        hostId: this.room.selfId,
        players: [{ id: this.room.selfId, name: this.name, team: 0 }],
        settings: { ...DEFAULT_SETTINGS },
        phase: 'lobby',
        matchId: 0,
      };
      this.status = 'lobby';
    } else {
      this.status = 'searching';
    }

    this.timers.push(setInterval(() => this.housekeeping(), 2000));
    this.emit();
  }

  get selfId(): string {
    return this.room.selfId;
  }

  snapshot(): OnlineSnapshot {
    return {
      role: this.role,
      code: this.code,
      selfId: this.room.selfId,
      status: this.status,
      error: this.error,
      lobby: this.lobby,
      pings: { ...this.pings },
      relays: this.room.relayCount(),
      sessionId: this.sessionId,
    };
  }

  private emit(): void {
    if (!this.closed) this.onUpdate(this.snapshot());
  }

  // --- wiring -------------------------------------------------------------------

  private wire(): void {
    const r = this.room;
    r.onPeerJoin = (peer) => {
      r.send<Hello>('hello', { v: PROTOCOL_VERSION, name: this.name, host: this.role === 'host' }, peer);
    };
    r.onPeerLeave = (peer) => this.handlePeerLeave(peer);
    r.onError = (msg) => {
      // A failed connection to one peer isn't fatal; surface it if we're stuck.
      if (this.status === 'searching') this.error = `Connection trouble: ${msg}`;
      this.emit();
    };

    r.on<Hello>('hello', (hello, peer) => this.handleHello(hello, peer));
    r.on<Kick>('kick', (kick, peer) => {
      if (peer !== this.hostId) return;
      this.fail(KICK_TEXT[kick?.reason] ?? 'Disconnected.');
    });

    if (this.role === 'host') {
      r.on<LobbyRequest>('req', (req, peer) => this.handleRequest(req, peer));
      r.on<PosReport>('pos', (data, peer) => {
        const rep = parsePosReport(data);
        if (!rep || !(this.session instanceof HostSession)) return;
        this.session.onRemotePos(peer, rep[0] / 100, rep[1] / 100, rep[2] / 1000, rep[3] === 1, rep[4], rep[5]);
      });
      r.on<AbilityPress>('abl', (data, peer) => {
        if (!Array.isArray(data) || typeof data[0] !== 'number' || !Number.isFinite(data[0])) return;
        if (this.session instanceof HostSession) this.session.onRemoteAbility(peer, data[0] / 1000);
      });
    } else {
      r.on<LobbyState>('lobby', (lobby, peer) => {
        if (peer !== this.hostId) return;
        this.lobby = lobby;
        if (lobby.phase === 'lobby') {
          this.session = null;
          this.status = 'lobby';
        } else if (!this.session) {
          this.status = 'lobby'; // match in progress without us: wait for the next one
        }
        this.error = null;
        this.emit();
      });
      r.on<MatchStart>('start', (start, peer) => {
        if (peer !== this.hostId) return;
        if (!start.roster.some((p) => p.id === this.selfId)) return; // spectating this round
        this.session?.dispose();
        this.session = new ClientSession({
          start,
          localId: this.selfId,
          sendPos: (rep) => this.hostId && this.room.send('pos', rep, this.hostId),
          sendAbility: (a) => this.hostId && this.room.send('abl', a, this.hostId),
        });
        this.sessionId++;
        this.status = 'match';
        this.emit();
      });
      r.on<Snapshot>('snap', (snap, peer) => {
        if (peer !== this.hostId) return;
        if (this.session instanceof ClientSession) this.session.onSnapshot(snap);
      });
    }
  }

  private handleHello(hello: Hello, peer: string): void {
    if (this.role === 'client') {
      if (hello?.host && !this.hostId) {
        this.hostId = peer;
        this.error = null;
        this.emit();
      }
      return;
    }

    // Host: admit the player.
    if (!this.lobby) return;
    if (hello?.v !== PROTOCOL_VERSION) {
      this.room.send<Kick>('kick', { reason: 'version' }, peer);
      return;
    }
    if (hello.host) return; // someone else thinks they're hosting this code; ignore them
    if (this.lobby.players.some((p) => p.id === peer)) return;
    if (this.lobby.players.length >= C.MAX_PLAYERS) {
      this.room.send<Kick>('kick', { reason: 'full' }, peer);
      return;
    }
    const team = pickTeam(this.lobby.players, this.lobby.settings.teams);
    this.lobby = {
      ...this.lobby,
      players: [...this.lobby.players, { id: peer, name: sanitizeName(hello.name), team }],
    };
    this.broadcastLobby();
  }

  private handleRequest(req: LobbyRequest, peer: string): void {
    if (!this.lobby || this.lobby.phase !== 'lobby') return;
    if (req?.type === 'team' && isTeamId(req.team)) {
      if (!canJoinTeam(this.lobby, peer, req.team)) return;
      this.lobby = {
        ...this.lobby,
        // A new team means that team's hero until they pick someone else.
        players: this.lobby.players.map((p) => (p.id === peer ? { ...p, team: req.team, character: undefined } : p)),
      };
      this.broadcastLobby();
    } else if (req?.type === 'character' && typeof req.character === 'string') {
      const me = this.lobby.players.find((p) => p.id === peer);
      if (!me || !isCharacterFor(req.character, me.team)) return;
      this.lobby = {
        ...this.lobby,
        players: this.lobby.players.map((p) => (p.id === peer ? { ...p, character: req.character } : p)),
      };
      this.broadcastLobby();
    } else if (req?.type === 'name') {
      const name = sanitizeName(req.name);
      this.lobby = {
        ...this.lobby,
        players: this.lobby.players.map((p) => (p.id === peer ? { ...p, name } : p)),
      };
      this.broadcastLobby();
    }
  }

  private handlePeerLeave(peer: string): void {
    delete this.pings[peer];
    if (this.role === 'client') {
      if (peer === this.hostId) this.fail(KICK_TEXT['host-left']);
      return;
    }
    if (!this.lobby) return;
    this.lobby = { ...this.lobby, players: this.lobby.players.filter((p) => p.id !== peer) };
    if (this.session instanceof HostSession) this.session.onPeerLeft(peer);
    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    if (!this.lobby) return;
    this.room.send('lobby', this.lobby);
    this.emit();
  }

  private async housekeeping(): Promise<void> {
    if (this.closed) return;
    const targets = this.role === 'host' ? this.lobby?.players.map((p) => p.id).filter((id) => id !== this.selfId) ?? [] : this.hostId ? [this.hostId] : [];
    await Promise.all(
      targets.map(async (id) => {
        const ms = await this.room.ping(id);
        if (ms !== null) this.pings[id] = Math.round(ms);
      }),
    );
    if (this.role === 'client' && this.status === 'searching' && !this.error) {
      // Nudge the user after a while; keep waiting regardless.
      if (performance.now() - this.createdAt > 15000) {
        this.error = 'Still looking for the host… double-check the room code.';
      }
    }
    this.emit();
  }

  // --- host actions -----------------------------------------------------------

  setTeam(team: TeamId): void {
    if (this.role === 'client') {
      if (this.hostId) this.room.send<LobbyRequest>('req', { type: 'team', team }, this.hostId);
      return;
    }
    if (!this.lobby || !canJoinTeam(this.lobby, this.selfId, team)) return;
    this.lobby = {
      ...this.lobby,
      players: this.lobby.players.map((p) => (p.id === this.selfId ? { ...p, team, character: undefined } : p)),
    };
    this.broadcastLobby();
  }

  /** Pick a character from your current team. */
  setCharacter(character: string): void {
    if (this.role === 'client') {
      if (this.hostId) this.room.send<LobbyRequest>('req', { type: 'character', character }, this.hostId);
      return;
    }
    const me = this.lobby?.players.find((p) => p.id === this.selfId);
    if (!this.lobby || !me || !isCharacterFor(character, me.team)) return;
    this.lobby = {
      ...this.lobby,
      players: this.lobby.players.map((p) => (p.id === this.selfId ? { ...p, character } : p)),
    };
    this.broadcastLobby();
  }

  updateSettings(patch: Partial<LobbySettings>): void {
    if (this.role !== 'host' || !this.lobby || this.lobby.phase !== 'lobby') return;
    this.lobby = applySettings(this.lobby, patch);
    this.broadcastLobby();
  }

  canStart(): { ok: boolean; reason?: string } {
    if (!this.lobby) return { ok: false };
    return canStart(this.lobby);
  }

  startMatch(): void {
    if (this.role !== 'host' || !this.lobby || !canStart(this.lobby).ok) return;
    const roster = buildRoster(this.lobby);
    const matchId = this.lobby.matchId + 1;
    const start: MatchStart = {
      matchId,
      roster,
      mapId: this.lobby.settings.mapId,
      roundSeconds: this.lobby.settings.roundSeconds,
    };
    this.lobby = { ...this.lobby, phase: 'match', matchId };
    const remoteIds = roster.filter((r) => !r.isBot && r.id !== this.selfId).map((r) => r.id);
    this.session?.dispose();
    this.session = new HostSession({
      roster,
      localId: this.selfId,
      mapId: start.mapId,
      roundSeconds: start.roundSeconds,
      botDifficulty: this.lobby.settings.botDifficulty,
      matchId,
      remoteIds,
      broadcast: (snap) => this.room.send('snap', snap),
    });
    this.room.send('start', start);
    this.sessionId++;
    this.status = 'match';
    this.broadcastLobby();
  }

  backToLobby(): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.session?.dispose();
    this.session = null;
    this.lobby = { ...this.lobby, phase: 'lobby' };
    this.status = 'lobby';
    this.broadcastLobby();
  }

  // --- teardown ------------------------------------------------------------------

  private fail(message: string): void {
    this.error = message;
    this.status = 'closed';
    this.session?.dispose();
    this.session = null;
    this.emit();
    this.shutdown();
  }

  leave(): void {
    if (this.role === 'host') this.room.send<Kick>('kick', { reason: 'host-left' });
    this.closed = true;
    // Give the goodbye a moment to flush before tearing down connections.
    setTimeout(() => this.shutdown(), 150);
  }

  private shutdown(): void {
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.session?.dispose();
    this.session = null;
    this.room.leave();
  }
}
