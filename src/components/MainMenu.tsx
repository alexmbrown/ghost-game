'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { audio } from '@/game/audio/audio';
import { abilityFor, characterFor, charactersFor, defaultCharacter } from '@/game/core/characters';
import * as C from '@/game/core/constants';
import { FACTIONS } from '@/game/core/factions';
import { MAPS } from '@/game/core/maps';
import type { TeamId } from '@/game/core/types';
import { SettingsPanel } from '@/game/hud/SettingsPanel';
import { ROUND_OPTIONS } from '@/game/net/lobbyLogic';
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from '@/game/net/roomCode';
import { preloadMap } from '@/game/r3f/mapAssets';
import { useAppStore } from '@/game/state/store';
import { AudioQuick } from '@/game/hud/AudioQuick';
import { Crest, Icon, Portrait, useUiImage, type IconName } from '@/game/ui/icons';

type Panel = 'quick' | 'online' | 'howto';

export function MainMenu() {
  const playerName = useAppStore((s) => s.playerName);
  const setPlayerName = useAppStore((s) => s.setPlayerName);
  const menuError = useAppStore((s) => s.menuError);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  // A pending invite link opens straight onto the join panel.
  const [panel, setPanel] = useState<Panel>(() =>
    new URLSearchParams(window.location.search).get('room') ? 'online' : 'quick',
  );

  return (
    <div className="screen menu-screen">
      <aside className="menu-left">
        <Logo />
        <div className="name-row">
          <label className="nameplate">
            <Icon name="edit" size={22} />
            <input
              value={playerName}
              maxLength={16}
              onChange={(e) => setPlayerName(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-label="Your name"
            />
          </label>
          <AudioQuick align="left" />
        </div>
        <nav className="menu-nav">
          <NavButton icon="play" label="Quick Play" sub="vs bots" on={panel === 'quick'} onClick={() => setPanel('quick')} />
          <NavButton icon="users" label="Play with Friends" sub="room code" on={panel === 'online'} onClick={() => setPanel('online')} />
          <NavButton icon="book" label="How to Play" on={panel === 'howto'} onClick={() => setPanel('howto')} />
          <NavButton icon="gear" label="Settings" on={false} onClick={() => setShowSettings(true)} />
        </nav>
        {menuError && (
          <div className="error-plate" role="alert">
            <Icon name="knock" size={22} /> {menuError}
          </div>
        )}
        <div className="menu-credit">Inspired by Google’s Great Ghoul Duel · v0.2</div>
      </aside>

      <section className="menu-right" key={panel}>
        {panel === 'quick' && <QuickPlayPanel />}
        {panel === 'online' && <OnlinePanel />}
        {panel === 'howto' && <HowToPanel />}
      </section>

      {showSettings && <SettingsPanel />}
    </div>
  );
}

function Logo() {
  const art = useUiImage('logo.webp');
  if (art) {
    return (
      <div className="logo logo--art">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art} alt="Ghost Game" draggable={false} />
        <div className="logo-ribbon">The Ghoul Duel</div>
      </div>
    );
  }
  return (
    <div className="logo">
      <div className="logo-title">
        Ghost <span>Game</span>
      </div>
      <div className="logo-ribbon">The Ghoul Duel</div>
    </div>
  );
}

function NavButton({
  icon,
  label,
  sub,
  on,
  onClick,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`navbtn${on ? ' navbtn--on' : ''}`} onClick={onClick}>
      <span className="navbtn-icon">
        <Icon name={icon} size={30} color={icon === 'play' ? '#ffb347' : undefined} />
      </span>
      <span className="navbtn-text">
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  );
}

export function GamePanel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`gpanel${className ? ` ${className}` : ''}`}>
      <div className="ribbon">
        <span>{title}</span>
      </div>
      <div className="gpanel-body">{children}</div>
    </div>
  );
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`seg${disabled ? ' seg--locked' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'is-on' : ''}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

const MAP_ICON: Record<string, IconName> = {
  graveyard: 'graveyard',
  cornmaze: 'corn',
  mansion: 'castle',
  forest: 'tree',
  library: 'book',
};

export function MapIcon({ id, size = 30 }: { id: string; size?: number }) {
  return <Icon name={MAP_ICON[id] ?? 'graveyard'} size={size} />;
}

/** Map cards (thumbnail or icon + name); description on hover. */
export function MapPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  return (
    <div className={`map-pick${disabled ? ' map-pick--locked' : ''}`}>
      {Object.values(MAPS).map((m) => (
        <MapCard key={m.id} id={m.id} name={m.name} description={m.description} on={value === m.id} disabled={disabled} onPick={() => onChange(m.id)} />
      ))}
    </div>
  );
}

function MapCard({ id, name, description, on, disabled, onPick }: { id: string; name: string; description: string; on: boolean; disabled?: boolean; onPick: () => void }) {
  const art = useUiImage(`map_${id}.webp`);
  return (
    <button
      className={`map-card${on ? ' is-on' : ''}${art ? ' map-card--art' : ''}`}
      style={art ? { backgroundImage: `url(${art})` } : undefined}
      disabled={disabled}
      onClick={onPick}
      title={description}
    >
      {!art && <MapIcon id={id} />}
      <b>{name}</b>
    </button>
  );
}

/** A faction's characters as portrait cards. */
export function CharacterPicker({
  team,
  value,
  onChange,
  disabled,
  compact,
}: {
  team: TeamId;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`char-pick${compact ? ' char-pick--compact' : ''}`}
      role="radiogroup"
      aria-label="Character"
      style={{ ['--team' as string]: FACTIONS[team].color }}
    >
      {charactersFor(team).map((c) => (
        <button
          key={c.id}
          role="radio"
          aria-checked={c.id === value}
          className={`char-card${c.id === value ? ' is-on' : ''}`}
          disabled={disabled}
          onClick={() => onChange(c.id)}
          title={c.name}
        >
          <Portrait character={c.id} team={team} size={compact ? 44 : 60} />
          {!compact && <b>{c.name}</b>}
        </button>
      ))}
    </div>
  );
}

function QuickPlayPanel() {
  const offline = useAppStore((s) => s.offline);
  const setOffline = useAppStore((s) => s.setOffline);
  const startOffline = useAppStore((s) => s.startOffline);
  const character = characterFor(offline.character, offline.team);
  const ability = abilityFor(character);
  const faction = FACTIONS[offline.team];
  // Fetch the picked map's models and textures while the rest is being set up.
  useEffect(() => preloadMap(offline.mapId), [offline.mapId]);

  return (
    <GamePanel title="Quick Play" className="gpanel--quick">
      <div className="faction-pick">
        {FACTIONS.map((f) => (
          <button
            key={f.id}
            className={`faction-btn${offline.team === f.id ? ' is-on' : ''}`}
            style={{ ['--team' as string]: f.color }}
            onClick={() => setOffline({ team: f.id as TeamId })}
          >
            <Crest team={f.id} size={46} />
            <b>{f.name}</b>
          </button>
        ))}
      </div>
      <CharacterPicker team={offline.team} value={character} onChange={(id) => setOffline({ character: id })} />
      <div className="ability-card" style={{ ['--team' as string]: faction.color }}>
        <Icon name={ability.icon as IconName} size={40} />
        <div>
          <b>{ability.name}</b>
          <p>{ability.description}</p>
        </div>
      </div>

      <Field label="Map">
        <MapPicker value={offline.mapId} onChange={(id) => setOffline({ mapId: id })} />
      </Field>
      <Field label="Team size">
        <Seg
          value={offline.teamSize}
          onChange={(v) => setOffline({ teamSize: v })}
          options={[1, 2, 3, 4].map((n) => ({ value: n, label: n === 1 ? 'Solo' : `${n} v ${n}` }))}
        />
      </Field>
      <Field label="Bots">
        <Seg
          value={offline.botDifficulty}
          onChange={(v) => setOffline({ botDifficulty: v })}
          options={(['easy', 'normal', 'hard'] as C.BotDifficulty[]).map((d) => ({ value: d, label: d }))}
        />
      </Field>
      <Field label="Round">
        <Seg
          value={offline.roundSeconds}
          onChange={(v) => setOffline({ roundSeconds: v })}
          options={ROUND_OPTIONS.map((s) => ({ value: s, label: `${s / 60} min` }))}
        />
      </Field>

      <button className="gbtn gbtn--primary gbtn--xl gbtn--block" onClick={startOffline}>
        <Icon name="play" size={26} color="#fff" /> Play
      </button>
    </GamePanel>
  );
}

function OnlinePanel() {
  const hostOnline = useAppStore((s) => s.hostOnline);
  const joinOnline = useAppStore((s) => s.joinOnline);
  // Invite links (?room=CODE) only prefill the code — joining is always explicit.
  const [code, setCode] = useState(() => normalizeRoomCode(new URLSearchParams(window.location.search).get('room') ?? ''));
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = isValidRoomCode(code);
  const join = () => valid && joinOnline(code);

  return (
    <GamePanel title="Play with Friends">
      <div className="online-card">
        <Icon name="castle" size={56} />
        <div>
          <b>Host a room</b>
          <p>Get a 6-letter code and send it to your friends.</p>
        </div>
        <button className="gbtn gbtn--primary" onClick={hostOnline}>
          Host
        </button>
      </div>

      <div className="or">
        <span>or</span>
      </div>

      <div className="online-card online-card--join">
        <b>Join with a code</b>
        <div className="codebox" onClick={() => inputRef.current?.focus()}>
          {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => (
            <span key={i} className={`codebox-cell${i === code.length ? ' is-cursor' : ''}${code[i] ? ' is-filled' : ''}`}>
              {code[i] ?? ''}
            </span>
          ))}
          <input
            ref={inputRef}
            className="codebox-input"
            value={code}
            maxLength={ROOM_CODE_LENGTH + 2}
            onChange={(e) => {
              const next = normalizeRoomCode(e.target.value);
              if (next.length > code.length) audio.play('ui.hover');
              setCode(next);
            }}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            spellCheck={false}
            autoComplete="off"
            aria-label="Room code"
          />
        </div>
        <button className="gbtn gbtn--violet gbtn--block" disabled={!valid} onClick={join}>
          Join Room
        </button>
      </div>

      <p className="panel-note">
        <Icon name="signal" size={18} /> Peer-to-peer over WebRTC — no accounts and no matchmaking. Only people with your
        code can join.
      </p>
    </GamePanel>
  );
}

const RULES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'flame', title: 'Collect', text: 'Grab spirits — they trail behind you like a snake.' },
  { icon: 'bank', title: 'Bank', text: 'Bring them home to your glowing portal. Rivals can’t enter your base.' },
  { icon: 'steal', title: 'Steal', text: 'Touch a rival’s trail to take that spirit and everything behind it.' },
  { icon: 'buddy', title: 'Buddy Bonus', text: 'Touch a teammate’s trail: +3 spirits each.' },
  { icon: 'mega', title: 'Mega-Spirits', text: 'They run away! Corner one for 10 spirits.' },
  { icon: 'pumpkin', title: 'Magic Pumpkin', text: 'Unstealable for 9s — ram rivals to stun them.' },
  {
    icon: 'speed',
    title: 'Powers',
    text: `Bank ${C.POWER_SPEED_AT} for Speed, ${C.POWER_MAGNET_AT} for Magnet, ${C.POWER_PHASE_AT} to Phase through walls.`,
  },
];

function HowToPanel() {
  return (
    <GamePanel title="How to Play" className="gpanel--scroll">
      <div className="rules">
        {RULES.map((r) => (
          <div key={r.title} className="rule">
            <Icon name={r.icon} size={38} />
            <div>
              <b>{r.title}</b>
              <p>{r.text}</p>
            </div>
          </div>
        ))}
        {FACTIONS.map((f) => {
          const a = abilityFor(defaultCharacter(f.id));
          return (
            <div key={f.id} className="rule">
              <Crest team={f.id} size={38} />
              <div>
                <b style={{ color: f.color }}>
                  {f.name} · {a.name}
                </b>
                <p>{a.description}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="keys-grid">
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> Move
        </span>
        <span>
          <Icon name="mouse" size={20} /> Click to aim
        </span>
        <span>
          <kbd>Space</kbd> Ability
        </span>
        <span>
          <kbd>Tab</kbd> Scores
        </span>
        <span>
          <kbd>Esc</kbd> Pause
        </span>
      </div>
    </GamePanel>
  );
}
