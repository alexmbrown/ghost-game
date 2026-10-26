'use client';

import { useEffect, useMemo, useRef } from 'react';

import { audio } from '@/game/audio/audio';
import { abilityFor } from '@/game/core/characters';
import * as C from '@/game/core/constants';
import { FACTIONS } from '@/game/core/factions';
import { FX } from '@/game/core/movement';
import type { TeamId } from '@/game/core/types';
import { formatRoomCode } from '@/game/net/roomCode';
import type { ViewPlayer } from '@/game/session/types';
import { getOnlineGame, useAppStore } from '@/game/state/store';
import { Crest, Icon, Portrait, UiArt, useUiImage, type IconName } from '@/game/ui/icons';
import { AudioQuick } from './AudioQuick';
import { Minimap } from './Minimap';
import { SettingsPanel } from './SettingsPanel';

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

const POWERS: { at: number; name: string; icon: IconName; flag: number }[] = [
  { at: C.POWER_SPEED_AT, name: 'Speed', icon: 'speed', flag: FX.SPEED },
  { at: C.POWER_MAGNET_AT, name: 'Magnet', icon: 'magnet', flag: FX.MAGNET },
  { at: C.POWER_PHASE_AT, name: 'Phase', icon: 'phase', flag: FX.PHASE },
];

interface Props {
  scoreboard: boolean;
  locked: boolean;
  onResume: () => void;
}

export function Hud({ scoreboard, locked, onResume }: Props) {
  const hud = useAppStore((s) => s.hud);
  const session = useAppStore((s) => s.session);
  const online = useAppStore((s) => s.online);
  const paused = useAppStore((s) => s.paused);
  const showSettings = useAppStore((s) => s.showSettings);

  const ability = abilityFor(hud.character);
  const ready = hud.abilityCooldown <= 0.05 && hud.phase === 'playing';
  const wasReady = useRef(true);
  useEffect(() => {
    if (ready && !wasReady.current) audio.play('sfx.ability.ready');
    wasReady.current = ready;
  }, [ready]);

  const teams = hud.activeTeams;
  const total = teams.reduce<number>((a, t) => a + hud.scores[t], 0);
  const max = Math.max(...teams.map((t) => hud.scores[t]));
  const lowTime = hud.timeRemaining <= C.HURRY_SECONDS && hud.phase === 'playing';
  const stunned = (hud.flags & FX.STUN) !== 0;
  const hostRtt = online && online.lobby ? online.pings[online.lobby.hostId] : undefined;
  const cdFrac = ready || hud.phase !== 'playing' ? 0 : Math.min(1, hud.abilityCooldown / ability.cooldown);

  const nextPower = POWERS.find((p) => hud.bankedTotal < p.at);
  const prevAt = nextPower ? (POWERS[POWERS.indexOf(nextPower) - 1]?.at ?? 0) : 0;
  const powerFrac = nextPower ? (hud.bankedTotal - prevAt) / (nextPower.at - prevAt) : 1;

  return (
    <div className="hud">
      {/* --- top: timer + team plates + tug-of-war bar --- */}
      <div className="hud-top">
        <div className="team-plates team-plates--left">
          {teams.slice(0, Math.ceil(teams.length / 2)).map((t) => (
            <TeamPlate key={t} team={t} score={hud.scores[t]} leader={max > 0 && hud.scores[t] === max} mine={t === hud.team} />
          ))}
        </div>
        <div className={`timer${lowTime ? ' timer--low' : ''}`}>
          <span className="outlined">
            {hud.phase === 'countdown' ? formatTime(session?.view.roundSeconds ?? C.DEFAULT_ROUND_SECONDS) : formatTime(hud.timeRemaining)}
          </span>
        </div>
        <div className="team-plates team-plates--right">
          {teams.slice(Math.ceil(teams.length / 2)).map((t) => (
            <TeamPlate key={t} team={t} score={hud.scores[t]} leader={max > 0 && hud.scores[t] === max} mine={t === hud.team} />
          ))}
        </div>
        <div className="tug">
          {total === 0 ? (
            <div className="tug-empty" />
          ) : (
            teams.map((t) => (
              <div key={t} className="tug-seg" style={{ width: `${(hud.scores[t] / total) * 100}%`, ['--team' as string]: FACTIONS[t].color }} />
            ))
          )}
        </div>
      </div>

      <Feed />
      {session && hud.phase !== 'ended' && <Minimap session={session} />}

      {online && (
        <div className="netinfo">
          <span className="netinfo-code">{formatRoomCode(online.code)}</span>
          {online.role === 'host' ? (
            <span className="netinfo-host">
              <Icon name="crown" size={16} /> Host
            </span>
          ) : (
            <span>
              <Icon name="signal" size={16} /> {hostRtt !== undefined ? `${hostRtt} ms` : '—'}
            </span>
          )}
        </div>
      )}

      <Announcement />
      <Popups />

      {/* --- bottom: carry + powers --- */}
      {hud.phase !== 'ended' && (
        <div className="hud-bottom">
          {stunned ? (
            <div className="stunned-plate">
              <Icon name="stun" size={34} />
              <span className="outlined">Stunned! Respawning…</span>
            </div>
          ) : (
            <div className="status-group">
              <Effects flags={hud.flags} />
              <div className={`carry${hud.carrying > 0 ? ' carry--active' : ''}`}>
                <Icon name="flame" size={44} />
                <span className="carry-num outlined">{hud.carrying}</span>
                <span className="carry-label">{hud.carrying > 0 ? 'Bank them at your portal!' : 'Collect spirits'}</span>
              </div>
              <div className="powers">
                {POWERS.map((p) => (
                  <span key={p.name} className={`power${hud.flags & p.flag ? ' power--on' : ''}`} title={`${p.name} — bank ${p.at}`}>
                    <Icon name={p.icon} size={26} />
                  </span>
                ))}
                <div className="power-next">
                  <div className="power-bar">
                    <i style={{ width: `${Math.max(0, Math.min(1, powerFrac)) * 100}%` }} />
                  </div>
                  <small>{nextPower ? `Bank ${nextPower.at - hud.bankedTotal} more → ${nextPower.name}` : 'All powers unlocked!'}</small>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- ability orb --- */}
      {hud.phase !== 'ended' && (
        <div className={`ability${ready ? ' ability--ready' : ''}`} style={{ ['--team' as string]: FACTIONS[hud.team].color }}>
          <div className="ability-orb">
            <svg viewBox="0 0 100 100" className="ability-ring" aria-hidden>
              <circle cx="50" cy="50" r="45" className="ability-ring-bg" />
              <circle cx="50" cy="50" r="45" className="ability-ring-fg" style={{ strokeDashoffset: `${cdFrac * 283}` }} />
            </svg>
            <Icon name={ability.icon as IconName} size={50} className={ready ? '' : 'is-cooling'} />
            {!ready && hud.phase === 'playing' && <b className="ability-cd outlined">{Math.ceil(hud.abilityCooldown)}</b>}
          </div>
          <div className="ability-text">
            <b className="outlined">{ability.name}</b>
            <span>
              <kbd>Space</kbd> <kbd>Click</kbd>
            </span>
          </div>
        </div>
      )}

      {scoreboard && session && hud.phase !== 'ended' && (
        <div className="scoreboard-overlay">
          <div className="gpanel">
            <div className="ribbon">
              <span>Scoreboard</span>
            </div>
            <div className="gpanel-body">
              <ScoreTable players={session.view.players} live />
            </div>
          </div>
        </div>
      )}

      {hud.phase !== 'ended' && (paused ? <PausePanel onResume={onResume} /> : !locked && <CaptureHint onResume={onResume} />)}

      {hud.phase === 'ended' && session && (
        <Results players={session.view.players} winner={hud.winner} myTeam={hud.team} teams={teams} scores={hud.scores} />
      )}

      {showSettings && <SettingsPanel />}
    </div>
  );
}

function TeamPlate({ team, score, leader, mine }: { team: TeamId; score: number; leader: boolean; mine: boolean }) {
  const prev = useRef(score);
  const bumped = score > prev.current;
  useEffect(() => {
    prev.current = score;
  }, [score]);
  return (
    <div
      className={`team-plate${leader ? ' team-plate--leader' : ''}${mine ? ' team-plate--mine' : ''}`}
      style={{ ['--team' as string]: FACTIONS[team].color }}
    >
      <Crest team={team} size={40} />
      <span key={score} className={`team-score outlined${bumped ? ' bump' : ''}`}>
        {score}
      </span>
      {leader && <Icon name="crown" size={20} className="team-crown" />}
    </div>
  );
}

function Feed() {
  const feed = useAppStore((s) => s.feed);
  return (
    <div className="feed">
      {feed.map((f) => (
        <div key={f.id} className="feed-item">
          <Icon name={f.icon} size={22} />
          <span>
            <b style={{ color: f.a !== undefined ? FACTIONS[f.a].color : undefined }}>{f.who}</b> {f.what}
            {f.whom && (
              <>
                {' '}
                <b style={{ color: f.b !== undefined ? FACTIONS[f.b].color : undefined }}>{f.whom}</b>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function Announcement() {
  const a = useAppStore((s) => s.announcement);
  if (!a) return null;
  return (
    <div key={a.id} className={`announce announce--${a.kind}`}>
      <div className="announce-text outlined">{a.text}</div>
      {a.sub && <div className="announce-sub">{a.sub}</div>}
    </div>
  );
}

function Popups() {
  const popups = useAppStore((s) => s.popups);
  return (
    <div className="popups">
      {popups.map((p) => (
        <div key={p.id} className={`popup popup--${p.kind} outlined`}>
          {p.text}
        </div>
      ))}
    </div>
  );
}

const EFFECTS: [number, IconName, string, string][] = [
  [FX.PUMPKIN, 'pumpkin', 'Pumpkin Power', 'pumpkin'],
  [FX.BURST, 'speed', 'Thief Burst', 'burst'],
  [FX.RUSH, 'hellfireRush', 'Rushing', 'rush'],
  [FX.DASH, 'phaseDash', 'Phasing', 'dash'],
  [FX.SLOWED, 'graveGrasp', 'Slowed', 'slow'],
  [FX.STAGGER, 'stun', 'Staggered', 'slow'],
];

function Effects({ flags }: { flags: number }) {
  const on = EFFECTS.filter(([f]) => flags & f);
  if (!on.length) return null;
  return (
    <div className="effects">
      {on.map(([f, icon, text, kind]) => (
        <span key={f} className={`effect effect--${kind}`}>
          <Icon name={icon} size={20} /> {text}
        </span>
      ))}
    </div>
  );
}

function CaptureHint({ onResume }: { onResume: () => void }) {
  const backToMenu = useAppStore((s) => s.backToMenu);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  return (
    <div className="capture-hint">
      <button className="gbtn gbtn--primary gbtn--sm" onClick={onResume}>
        <Icon name="mouse" size={20} /> Click to aim
      </button>
      <AudioQuick align="center" />
      <button className="gbtn gbtn--icon gbtn--slate gbtn--sm" onClick={() => setShowSettings(true)} aria-label="Settings">
        <Icon name="gear" size={20} />
      </button>
      <button className="gbtn gbtn--icon gbtn--danger gbtn--sm" onClick={backToMenu} aria-label="Leave match">
        <Icon name="leave" size={20} />
      </button>
    </div>
  );
}

function PausePanel({ onResume }: { onResume: () => void }) {
  const backToMenu = useAppStore((s) => s.backToMenu);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  return (
    <div className="overlay">
      <div className="gpanel gpanel--narrow">
        <div className="ribbon">
          <span>Paused</span>
        </div>
        <div className="gpanel-body">
          <div className="stack">
            <button className="gbtn gbtn--primary gbtn--xl gbtn--block" onClick={onResume}>
              <Icon name="play" size={26} color="#fff" /> Resume
            </button>
            <div className="pause-row">
              <button className="gbtn gbtn--slate gbtn--block" onClick={() => setShowSettings(true)}>
                <Icon name="gear" size={22} /> Settings
              </button>
              <AudioQuick align="right" />
            </div>
            <button className="gbtn gbtn--danger gbtn--block" onClick={backToMenu}>
              <Icon name="leave" size={22} /> Quit to menu
            </button>
          </div>
          <p className="panel-note">Press Esc any time to pause.</p>
        </div>
      </div>
    </div>
  );
}

function ScoreTable({ players, live }: { players: ViewPlayer[]; live?: boolean }) {
  // Most spirits first (banked, plus what they're carrying during the round).
  const total = (p: ViewPlayer) => p.stats.banked + (live ? p.carrying : 0);
  const rows = [...players].sort((a, b) => total(b) - total(a) || b.stats.steals - a.stats.steals || a.name.localeCompare(b.name));
  const cols: [IconName, string][] = [
    ...(live ? ([['flame', 'Carrying']] as [IconName, string][]) : []),
    ['bank', 'Banked'],
    ['steal', 'Steals'],
    ['stun', 'Stuns & knocks'],
    ['mega', 'Spirits collected'],
  ];
  return (
    <div className="scoretable" style={{ ['--cols' as string]: cols.length }}>
      <div className="st-row st-head">
        <span />
        {cols.map(([icon, title]) => (
          <span key={icon} title={title}>
            <Icon name={icon} size={22} />
          </span>
        ))}
      </div>
      {rows.map((p) => (
        <div
          key={p.id}
          className={`st-row${p.isLocal ? ' st-row--me' : ''}${p.left ? ' st-row--left' : ''}`}
          style={{ ['--team' as string]: FACTIONS[p.team].color }}
        >
          <span className="st-name">
            <Portrait character={p.character} team={p.team} size={26} />
            <span>{p.name}</span>
            {p.isBot && <Icon name="bot" size={16} />}
          </span>
          {live && <span>{p.carrying}</span>}
          <span>{p.stats.banked}</span>
          <span>{p.stats.steals}</span>
          <span>{p.stats.stuns}</span>
          <span>{p.stats.pickups}</span>
        </div>
      ))}
    </div>
  );
}

function Results({
  players,
  winner,
  myTeam,
  teams,
  scores,
}: {
  players: ViewPlayer[];
  winner: TeamId | null;
  myTeam: TeamId;
  teams: TeamId[];
  scores: [number, number, number, number];
}) {
  const online = useAppStore((s) => s.online);
  const startOffline = useAppStore((s) => s.startOffline);
  const backToMenu = useAppStore((s) => s.backToMenu);
  const leaveOnline = useAppStore((s) => s.leaveOnline);

  const ranked = [...teams].sort((a, b) => scores[b] - scores[a]);
  const verdict = winner === null ? 'Draw' : winner === myTeam ? 'Victory' : 'Defeat';
  const ribbon = useUiImage(verdict === 'Victory' ? 'banner_victory.webp' : verdict === 'Defeat' ? 'banner_defeat.webp' : undefined);

  const awards = useMemo(() => {
    const best = (key: keyof ViewPlayer['stats']) =>
      players.reduce<ViewPlayer | null>((b, p) => (p.stats[key] > (b?.stats[key] ?? 0) ? p : b), null);
    const list: { title: string; art: string; icon: IconName; p: ViewPlayer | null; v: string }[] = [
      { title: 'MVP', art: 'award_mvp.webp', icon: 'trophy', p: best('banked'), v: 'banked' },
      { title: 'Sticky Fingers', art: 'award_steals.webp', icon: 'steal', p: best('steals'), v: 'steals' },
      { title: 'Bruiser', art: 'award_stuns.webp', icon: 'stun', p: best('stuns'), v: 'stuns' },
    ];
    return list.filter((a) => a.p);
  }, [players]);

  return (
    <div className="overlay overlay--results">
      <div className="results">
        <div className={`verdict verdict--${verdict.toLowerCase()}${ribbon ? ' verdict--ribbon' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {ribbon && <img className="verdict-ribbon" src={ribbon} alt="" draggable={false} />}
          <span className="outlined">{verdict}</span>
        </div>
        <div className="results-sub">
          {winner === null ? (
            'Nobody pulled ahead!'
          ) : (
            <>
              <Crest team={winner} size={36} />
              <span style={{ color: FACTIONS[winner].color }}>{FACTIONS[winner].name}</span> win the duel!
            </>
          )}
        </div>

        <div className="results-grid">
          <div className="results-col">
            <div className="podium">
              {ranked.map((t, i) => (
                <div
                  key={t}
                  className={`podium-row${winner === t ? ' podium-row--win' : ''}`}
                  style={{ ['--team' as string]: FACTIONS[t].color, animationDelay: `${i * 90}ms` }}
                >
                  <span className="podium-rank outlined">{i + 1}</span>
                  <Crest team={t} size={34} />
                  <span className="podium-name">{FACTIONS[t].name}</span>
                  <b className="podium-score outlined">{scores[t]}</b>
                </div>
              ))}
            </div>
            <div className="awards">
              {awards.map((a) => (
                <div key={a.title} className="award" style={{ ['--team' as string]: FACTIONS[a.p!.team].color }}>
                  <UiArt file={a.art} icon={a.icon} size={48} />
                  <span className="award-title">{a.title}</span>
                  <span className="award-name">{a.p!.name}</span>
                  <span className="award-sub">
                    {a.p!.stats[a.v as keyof ViewPlayer['stats']]} {a.v}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="gpanel gpanel--flat">
            <ScoreTable players={players} />
          </div>
        </div>

        <div className="results-actions">
          <AudioQuick up align="center" />
          {!online && (
            <>
              <button className="gbtn gbtn--primary gbtn--xl" onClick={startOffline}>
                <Icon name="play" size={26} color="#fff" /> Play again
              </button>
              <button className="gbtn gbtn--slate" onClick={backToMenu}>
                Main menu
              </button>
            </>
          )}
          {online?.role === 'host' && (
            <>
              <button className="gbtn gbtn--primary gbtn--xl" onClick={() => getOnlineGame()?.startMatch()}>
                <Icon name="play" size={26} color="#fff" /> Rematch
              </button>
              <button className="gbtn gbtn--violet" onClick={() => getOnlineGame()?.backToLobby()}>
                <Icon name="users" size={22} /> Lobby
              </button>
              <button className="gbtn gbtn--danger gbtn--sm" onClick={leaveOnline}>
                <Icon name="leave" size={18} /> Leave
              </button>
            </>
          )}
          {online?.role === 'client' && (
            <>
              <div className="waiting-plate">
                <span className="spinner" /> Waiting for the host…
              </div>
              <button className="gbtn gbtn--danger gbtn--sm" onClick={leaveOnline}>
                <Icon name="leave" size={18} /> Leave
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
