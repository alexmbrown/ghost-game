// Pure lobby rules (unit-tested): team assignment, settings changes, and
// building the match roster (humans + bot fill).

import { botCharacters, characterFor, defaultCharacter } from '../core/characters';
import * as C from '../core/constants';
import { FACTIONS } from '../core/factions';
import { DEFAULT_MAP, MAPS } from '../core/maps';
import type { RosterEntry, TeamId } from '../core/types';
import type { LobbyPlayer, LobbySettings, LobbyState } from './protocol';

export const DEFAULT_SETTINGS: LobbySettings = {
  mapId: DEFAULT_MAP,
  roundSeconds: C.DEFAULT_ROUND_SECONDS,
  botFill: 2,
  botDifficulty: 'normal',
  teams: [0, 1, 2, 3],
};

export const ROUND_OPTIONS = [60, 120, 180] as const;

export function teamCount(players: readonly LobbyPlayer[], team: TeamId): number {
  return players.filter((p) => p.team === team).length;
}

/** Least-populated active team (ties -> lowest id). */
export function pickTeam(players: readonly LobbyPlayer[], teams: readonly TeamId[]): TeamId {
  let best = teams[0] ?? 0;
  let bestN = Infinity;
  for (const t of teams) {
    const n = teamCount(players, t);
    if (n < bestN) {
      bestN = n;
      best = t;
    }
  }
  return best;
}

export function canJoinTeam(lobby: LobbyState, playerId: string, team: TeamId): boolean {
  if (!lobby.settings.teams.includes(team)) return false;
  const others = lobby.players.filter((p) => p.id !== playerId);
  return teamCount(others, team) < C.MAX_TEAM_SIZE;
}

/** Validate + apply a settings patch from the host UI. Reassigns players off removed teams. */
export function applySettings(lobby: LobbyState, patch: Partial<LobbySettings>): LobbyState {
  const s = { ...lobby.settings, ...patch };
  if (!MAPS[s.mapId]) s.mapId = DEFAULT_MAP;
  if (!ROUND_OPTIONS.includes(s.roundSeconds as (typeof ROUND_OPTIONS)[number])) s.roundSeconds = C.DEFAULT_ROUND_SECONDS;
  s.botFill = Math.max(0, Math.min(C.MAX_TEAM_SIZE, Math.round(s.botFill)));
  if (!['easy', 'normal', 'hard'].includes(s.botDifficulty)) s.botDifficulty = 'normal';
  const teams = [...new Set(s.teams)].filter((t) => FACTIONS.some((f) => f.id === t)).sort() as TeamId[];
  s.teams = teams.length >= 2 ? teams : lobby.settings.teams;

  const players: LobbyPlayer[] = [];
  for (const p of lobby.players) {
    const team = s.teams.includes(p.team) && teamCount(players, p.team) < C.MAX_TEAM_SIZE ? p.team : pickTeam(players, s.teams);
    players.push({ ...p, team });
  }
  return { ...lobby, settings: s, players };
}

/** Humans keep their picks; each active team is topped up with bots to `botFill`. */
export function buildRoster(lobby: LobbyState): RosterEntry[] {
  const roster: RosterEntry[] = lobby.players.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    isBot: false,
    character: characterFor(p.character, p.team),
  }));
  for (const team of lobby.settings.teams) {
    const f = FACTIONS[team];
    let n = teamCount(lobby.players, team);
    let i = 1;
    // Bots take the team's characters nobody picked, so matches show off the roster.
    const taken = roster.filter((r) => r.team === team).map((r) => r.character);
    const picks = botCharacters(team, Math.max(0, lobby.settings.botFill - n), taken);
    while (n < lobby.settings.botFill && roster.length < C.MAX_PLAYERS) {
      roster.push({
        id: `bot-${team}-${i}`,
        name: `${f.singular} Bot ${i}`,
        team,
        isBot: true,
        character: picks[i - 1] ?? defaultCharacter(team),
      });
      n++;
      i++;
    }
  }
  return roster;
}

/** A match needs at least two teams with someone on them. */
export function canStart(lobby: LobbyState): { ok: boolean; reason?: string } {
  const roster = buildRoster(lobby);
  const teams = new Set(roster.map((r) => r.team));
  if (teams.size < 2) return { ok: false, reason: 'Need players or bots on at least 2 teams' };
  return { ok: true };
}
