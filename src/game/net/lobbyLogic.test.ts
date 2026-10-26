import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { charactersFor, voiceOf } from '../core/characters';
import { applySettings, buildRoster, canJoinTeam, canStart, DEFAULT_SETTINGS, pickTeam } from './lobbyLogic';
import type { LobbyState } from './protocol';
import { isValidRoomCode, normalizeRoomCode } from './roomCode';

function lobby(players: LobbyState['players'], settings = DEFAULT_SETTINGS): LobbyState {
  return { hostId: 'h', players, settings, phase: 'lobby', matchId: 0 };
}

describe('lobby rules', () => {
  it('puts new players on the emptiest team', () => {
    const players = [
      { id: 'a', name: 'a', team: 0 as const },
      { id: 'b', name: 'b', team: 1 as const },
    ];
    assert.equal(pickTeam(players, [0, 1, 2, 3]), 2);
    assert.equal(pickTeam(players, [0, 1]), 0);
  });

  it('caps teams at 4 and rejects inactive teams', () => {
    const full = lobby([0, 1, 2, 3].map((i) => ({ id: `p${i}`, name: '', team: 0 as const })));
    assert.equal(canJoinTeam(full, 'new', 0), false);
    assert.equal(canJoinTeam(full, 'p0', 0), true, 'already on it');
    const two = applySettings(full, { teams: [1, 2] });
    assert.equal(canJoinTeam(two, 'x', 3), false);
  });

  it('moves players off removed teams and validates settings', () => {
    const l = lobby([
      { id: 'a', name: 'a', team: 3 },
      { id: 'b', name: 'b', team: 3 },
    ]);
    const next = applySettings(l, { teams: [0, 1], roundSeconds: 999, botFill: 9, mapId: 'nope' });
    assert.deepEqual(next.settings.teams, [0, 1]);
    assert.ok(next.players.every((p) => p.team === 0 || p.team === 1));
    assert.equal(next.settings.roundSeconds, 120);
    assert.equal(next.settings.botFill, 4);
    assert.equal(next.settings.mapId, 'graveyard');
    assert.deepEqual(applySettings(l, { teams: [2] }).settings.teams, l.settings.teams, 'needs 2+ teams');
  });

  it('fills teams with bots up to botFill', () => {
    const l = lobby(
      [
        { id: 'a', name: 'a', team: 0 },
        { id: 'b', name: 'b', team: 0 },
      ],
      { ...DEFAULT_SETTINGS, botFill: 2, teams: [0, 1] },
    );
    const roster = buildRoster(l);
    assert.equal(roster.filter((r) => r.team === 0).length, 2);
    assert.equal(roster.filter((r) => r.team === 1 && r.isBot).length, 2);
    assert.ok(canStart(l).ok);
    assert.equal(canStart({ ...l, settings: { ...l.settings, botFill: 0 } }).ok, false);
  });
});

describe('character select', () => {
  it('plays your pick, and bots take the characters nobody picked', () => {
    const l = lobby([{ id: 'a', name: 'a', team: 2, character: 'calico' }], { ...DEFAULT_SETTINGS, botFill: 4, teams: [2, 3] });
    const roster = buildRoster(l);
    assert.equal(roster.find((r) => r.id === 'a')?.character, 'calico');
    const skeletons = roster.filter((r) => r.team === 2).map((r) => r.character);
    assert.deepEqual([...skeletons].sort(), charactersFor(2).map((c) => c.id).sort(), 'one of each');
    const demons = roster.filter((r) => r.team === 3).map((r) => r.character);
    assert.equal(new Set(demons).size, 4, 'a full bot team shows the whole faction');
  });

  it('falls back to the team hero when a pick does not fit the team', () => {
    const roster = buildRoster(lobby([{ id: 'a', name: 'a', team: 0, character: 'scorch' }], { ...DEFAULT_SETTINGS, teams: [0, 1] }));
    assert.equal(roster.find((r) => r.id === 'a')?.character, 'boo');
  });

  it('alternates borrow their hero’s voice lines', () => {
    assert.equal(voiceOf('wailey'), 'boo');
    assert.equal(voiceOf('hex'), 'scorch');
    assert.equal(voiceOf('rattles'), 'rattles');
  });
});

describe('room codes', () => {
  it('normalizes user input', () => {
    assert.equal(normalizeRoomCode(' abc-def '), 'ABCDEF');
    assert.equal(isValidRoomCode('ABCDEF'), true);
    assert.equal(isValidRoomCode('ABCDE0'), false);
  });
});
