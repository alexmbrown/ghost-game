'use client';

import { useEffect, useState } from 'react';

import { audio } from '@/game/audio/audio';
import { abilityFor, botCharacters, characterFor, defaultCharacter } from '@/game/core/characters';
import * as C from '@/game/core/constants';
import { FACTIONS, TEAM_IDS } from '@/game/core/factions';
import type { TeamId } from '@/game/core/types';
import { SettingsPanel } from '@/game/hud/SettingsPanel';
import { canJoinTeam, ROUND_OPTIONS } from '@/game/net/lobbyLogic';
import { preloadMap } from '@/game/r3f/mapAssets';
import { getOnlineGame, useAppStore } from '@/game/state/store';
import { AudioQuick } from '@/game/hud/AudioQuick';
import { Crest, Icon, Portrait, useUiImage, type IconName } from '@/game/ui/icons';
import { CharacterPicker, Field, MapPicker, Seg } from './MainMenu';

export function Lobby() {
  const online = useAppStore((s) => s.online);
  const leaveOnline = useAppStore((s) => s.leaveOnline);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const [copied, setCopied] = useState<string | null>(null);
  const keyart = useUiImage('keyart_lobby.webp');
  const mapId = useAppStore((s) => s.online?.lobby?.settings.mapId);
  useEffect(() => {
    if (mapId) preloadMap(mapId);
  }, [mapId]);

  if (!online) return null;
  const game = getOnlineGame();
  const lobby = online.lobby;
  const isHost = online.role === 'host';
  const me = lobby?.players.find((p) => p.id === online.selfId);
  const settings = lobby?.settings;
  const start = game?.canStart() ?? { ok: false };

  const copy = async (what: 'code' | 'link') => {
    const url = new URL(window.location.href);
    url.search = `?room=${online.code}`;
    try {
      await navigator.clipboard.writeText(what === 'code' ? online.code : url.toString());
      audio.play('ui.copy');
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="screen lobby-screen">
      {keyart && <div className="screen-art" style={{ backgroundImage: `url(${keyart})` }} aria-hidden />}
      <header className="lobby-top">
        <div className="code-plaque">
          <div className="ribbon ribbon--small">
            <span>Room code</span>
          </div>
          <div className="code-tiles" aria-label={`Room code ${online.code}`}>
            {online.code.split('').map((ch, i) => (
              <span key={i} className="code-tile" style={{ animationDelay: `${i * 60}ms` }}>
                {ch}
              </span>
            ))}
          </div>
          <div className="code-actions">
            <button className="gbtn gbtn--sm gbtn--slate" onClick={() => copy('code')}>
              <Icon name={copied === 'code' ? 'check' : 'copy'} size={18} /> {copied === 'code' ? 'Copied!' : 'Copy code'}
            </button>
            <button className="gbtn gbtn--sm gbtn--slate" onClick={() => copy('link')}>
              <Icon name={copied === 'link' ? 'check' : 'link'} size={18} /> {copied === 'link' ? 'Copied!' : 'Invite link'}
            </button>
          </div>
        </div>
        <ConnectionStatus />
        <div className="corner-tools">
          <AudioQuick />
          <button className="gbtn gbtn--icon gbtn--slate" onClick={() => setShowSettings(true)} aria-label="Settings">
            <Icon name="gear" size={26} />
          </button>
        </div>
      </header>

      {lobby && settings ? (
        <>
          <div className="banners">
            {TEAM_IDS.filter((t) => settings.teams.includes(t)).map((t) => {
              const f = FACTIONS[t];
              const members = lobby.players.filter((p) => p.team === t);
              const bots = Math.max(0, settings.botFill - members.length);
              const empty = Math.max(0, C.MAX_TEAM_SIZE - members.length - bots);
              const canJoin = !!me && me.team !== t && canJoinTeam(lobby, online.selfId, t) && lobby.phase === 'lobby';
              const ability = abilityFor(defaultCharacter(t));
              // Bots get the characters nobody on the team picked (same rule as the match roster).
              const botPicks = botCharacters(t, bots, members.map((p) => characterFor(p.character, t)));
              return (
                <div
                  key={t}
                  className={`banner${me?.team === t ? ' banner--mine' : ''}`}
                  style={{ ['--team' as string]: f.color }}
                >
                  <div className="banner-head">
                    <Crest team={t} size={64} />
                    <b>{f.name}</b>
                    <span className="banner-ability" title={ability.description}>
                      <Icon name={ability.icon as IconName} size={18} /> {ability.name}
                    </span>
                  </div>
                  <ul className="slots">
                    {members.map((p) => (
                      <li key={p.id} className={`slot${p.id === online.selfId ? ' slot--me' : ''}`}>
                        <Portrait character={characterFor(p.character, t)} team={t} size={30} className="slot-portrait" />
                        <span className="slot-name">{p.name}</span>
                        {p.id === lobby.hostId && <Icon name="crown" size={18} title="Host" />}
                        {p.id !== online.selfId && online.pings[p.id] !== undefined && (
                          <span className="slot-ping">{online.pings[p.id]}ms</span>
                        )}
                      </li>
                    ))}
                    {Array.from({ length: bots }, (_, i) => (
                      <li key={`bot${i}`} className="slot slot--bot">
                        <Portrait character={botPicks[i]} team={t} size={30} className="slot-portrait" />
                        <Icon name="bot" size={18} />
                        <span className="slot-name">Bot</span>
                      </li>
                    ))}
                    {Array.from({ length: empty }, (_, i) => (
                      <li key={`empty${i}`} className="slot slot--empty">
                        <span className="slot-name">open</span>
                      </li>
                    ))}
                  </ul>
                  {me?.team === t && lobby.phase === 'lobby' && (
                    <CharacterPicker
                      compact
                      team={t}
                      value={characterFor(me.character, t)}
                      onChange={(id) => game?.setCharacter(id)}
                    />
                  )}
                  {canJoin ? (
                    <button className="gbtn gbtn--sm gbtn--team" onClick={() => game?.setTeam(t as TeamId)}>
                      Join
                    </button>
                  ) : (
                    <span className="banner-foot">{me?.team === t ? 'Your team' : ''}</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="lobby-bottom">
            <div className="gpanel gpanel--flat lobby-settings">
              <div className="lobby-settings-title">
                {isHost ? 'Match settings' : 'Match settings (host decides)'}
              </div>
              <div className="lobby-settings-grid">
                <Field label="Map">
                  <MapPicker disabled={!isHost} value={settings.mapId} onChange={(id) => game?.updateSettings({ mapId: id })} />
                </Field>
                <Field label="Teams">
                  <div className="seg seg--icons">
                    {TEAM_IDS.map((t) => {
                      const on = settings.teams.includes(t);
                      return (
                        <button
                          key={t}
                          className={on ? 'is-on' : ''}
                          disabled={!isHost}
                          aria-pressed={on}
                          title={FACTIONS[t].name}
                          onClick={() =>
                            game?.updateSettings({ teams: on ? settings.teams.filter((x) => x !== t) : [...settings.teams, t] })
                          }
                        >
                          <Crest team={t} size={28} />
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Bots">
                  <Seg
                    disabled={!isHost}
                    value={settings.botFill}
                    onChange={(v) => game?.updateSettings({ botFill: v })}
                    options={[0, 1, 2, 3, 4].map((n) => ({ value: n, label: n === 0 ? 'Off' : `${n}/team` }))}
                  />
                </Field>
                <Field label="Bot skill">
                  <Seg
                    disabled={!isHost}
                    value={settings.botDifficulty}
                    onChange={(v) => game?.updateSettings({ botDifficulty: v })}
                    options={(['easy', 'normal', 'hard'] as C.BotDifficulty[]).map((d) => ({ value: d, label: d }))}
                  />
                </Field>
                <Field label="Round">
                  <Seg
                    disabled={!isHost}
                    value={settings.roundSeconds}
                    onChange={(v) => game?.updateSettings({ roundSeconds: v })}
                    options={ROUND_OPTIONS.map((s) => ({ value: s, label: `${s / 60} min` }))}
                  />
                </Field>
              </div>
            </div>

            <div className="lobby-actions">
              {isHost ? (
                <>
                  <button
                    className="gbtn gbtn--primary gbtn--xl"
                    disabled={!start.ok}
                    title={start.reason}
                    onClick={() => game?.startMatch()}
                  >
                    <Icon name="play" size={28} color="#fff" /> Start
                  </button>
                  {!start.ok && start.reason && <span className="hint">{start.reason}</span>}
                </>
              ) : (
                <div className="waiting-plate">
                  <span className="spinner" />
                  {lobby.phase === 'match' ? 'Match in progress — you’ll join the next round' : 'Waiting for the host to start'}
                </div>
              )}
              <button className="gbtn gbtn--danger gbtn--sm" onClick={leaveOnline}>
                <Icon name="leave" size={18} /> Leave
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="lobby-searching">
          <div className="gpanel gpanel--flat">
            <div className="searching-ghost">
              <Icon name="ghost" size={72} />
            </div>
            <b>Looking for the host…</b>
            <p>{online.error ?? 'Connecting to the room. This usually takes a few seconds.'}</p>
            <button className="gbtn gbtn--danger gbtn--sm" onClick={leaveOnline}>
              <Icon name="leave" size={18} /> Cancel
            </button>
          </div>
        </div>
      )}

      {showSettings && <SettingsPanel />}
    </div>
  );
}

function ConnectionStatus() {
  const online = useAppStore((s) => s.online);
  if (!online || !online.lobby) return null;
  const peers = online.lobby.players.length - 1;
  const offline = online.relays === 0;
  let text: string;
  if (online.role === 'host') {
    text = peers === 0 ? 'Waiting for friends — share the code!' : `${peers} friend${peers === 1 ? '' : 's'} connected`;
  } else {
    text = 'Connected to the host';
  }
  return (
    <div className={`status-pill${offline ? ' status-pill--warn' : ''}`}>
      {peers === 0 && online.role === 'host' ? <span className="spinner" /> : <Icon name="signal" size={18} />}
      {text}
      {offline && <em> · signaling offline, new players can’t join</em>}
    </div>
  );
}
