import { create } from 'zustand';

import { audio } from '../audio/audio';
import { botCharacters, characterFor } from '../core/characters';
import * as C from '../core/constants';
import { DEFAULT_MAP } from '../core/maps';
import type { RosterEntry, TeamId } from '../core/types';
import { OnlineGame, type OnlineSnapshot } from '../net/online';
import { generateRoomCode } from '../net/roomCode';
import { HostSession } from '../session/hostSession';
import type { GameSession } from '../session/types';
import type { IconName } from '../ui/icons';

export type Screen = 'menu' | 'lobby' | 'game';

export interface UserSettings {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  /** Background soundscapes (wind, crickets, creaks). */
  ambient: number;
  /** Silences everything without losing the levels. */
  muted: boolean;
  sensitivity: number;
  invertY: boolean;
  quality: 'high' | 'low';
}

export interface OfflineSetup {
  mapId: string;
  botDifficulty: C.BotDifficulty;
  /** Players per team (you + bots). */
  teamSize: number;
  team: TeamId;
  /** Your character (must belong to `team`; falls back to the team's hero). */
  character: string;
  teams: TeamId[];
  roundSeconds: number;
}

export interface HudState {
  phase: 'countdown' | 'playing' | 'ended';
  countdown: number;
  timeRemaining: number;
  scores: [number, number, number, number];
  winner: TeamId | null;
  carrying: number;
  flags: number;
  bankedTotal: number;
  abilityCooldown: number;
  team: TeamId;
  character: string;
  activeTeams: TeamId[];
  rttMs: number | null;
}

export interface FeedItem {
  id: number;
  /** Actor name, verb phrase, and optional target — rendered with team colors. */
  who: string;
  what: string;
  whom?: string;
  /** Teams of the two parties, if any (for name colors). */
  a?: TeamId;
  b?: TeamId;
  icon: IconName;
}

export interface Popup {
  id: number;
  text: string;
  kind: 'good' | 'bad' | 'info' | 'power';
}

export interface Announcement {
  id: number;
  text: string;
  sub?: string;
  kind: 'count' | 'go' | 'info' | 'warn';
}

interface AppState {
  screen: Screen;
  playerName: string;
  settings: UserSettings;
  offline: OfflineSetup;
  session: GameSession | null;
  /** Bumps for each new match (remounts the 3D world). */
  sessionKey: number;
  online: OnlineSnapshot | null;
  menuError: string | null;
  showSettings: boolean;
  /** Offline only: sim paused (pause menu open / mouse released). */
  paused: boolean;
  hud: HudState;
  feed: FeedItem[];
  popups: Popup[];
  announcement: Announcement | null;

  setPlayerName: (name: string) => void;
  updateSettings: (patch: Partial<UserSettings>) => void;
  setOffline: (patch: Partial<OfflineSetup>) => void;
  setShowSettings: (v: boolean) => void;
  setPaused: (v: boolean) => void;
  startOffline: () => void;
  hostOnline: () => void;
  joinOnline: (code: string) => void;
  leaveOnline: () => void;
  backToMenu: () => void;
  setHud: (hud: HudState) => void;
  pushFeed: (item: Omit<FeedItem, 'id'>) => void;
  pushPopup: (text: string, kind: Popup['kind']) => void;
  announce: (text: string, kind: Announcement['kind'], sub?: string) => void;
}

// --- persistence (best-effort; private windows may block storage) -----------

const STORAGE_KEY = 'ghoul-duel:v1';

interface Persisted {
  playerName?: string;
  settings?: Partial<UserSettings>;
  offline?: Partial<OfflineSetup>;
}

function readPersisted(): Persisted {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Persisted;
  } catch {
    return {};
  }
}

function writePersisted(s: Pick<AppState, 'playerName' | 'settings' | 'offline'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ playerName: s.playerName, settings: s.settings, offline: s.offline }));
  } catch {
    /* storage unavailable */
  }
}

const DEFAULT_SETTINGS: UserSettings = {
  master: 0.8,
  music: 0.6,
  sfx: 0.9,
  voice: 1,
  ambient: 0.7,
  muted: false,
  sensitivity: 1,
  invertY: false,
  quality: 'high',
};

const DEFAULT_OFFLINE: OfflineSetup = {
  mapId: DEFAULT_MAP,
  botDifficulty: 'normal',
  teamSize: 2,
  team: 0,
  character: 'boo',
  teams: [0, 1, 2, 3],
  roundSeconds: C.DEFAULT_ROUND_SECONDS,
};

const initialHud: HudState = {
  phase: 'countdown',
  countdown: C.COUNTDOWN_SECONDS,
  timeRemaining: C.DEFAULT_ROUND_SECONDS,
  scores: [0, 0, 0, 0],
  winner: null,
  carrying: 0,
  flags: 0,
  bankedTotal: 0,
  abilityCooldown: 0,
  team: 0,
  character: 'boo',
  activeTeams: [0, 1, 2, 3],
  rttMs: null,
};

let onlineGame: OnlineGame | null = null;
export const getOnlineGame = (): OnlineGame | null => onlineGame;

let uid = 1;
let announceTimer: ReturnType<typeof setTimeout> | null = null;

function randomName(): string {
  const a = ['Spooky', 'Wobbly', 'Sneaky', 'Gloomy', 'Giggly', 'Creaky', 'Misty', 'Batty'];
  const b = ['Wisp', 'Ghoul', 'Haunt', 'Specter', 'Boo', 'Phantom', 'Shade', 'Spirit'];
  return `${a[Math.floor(Math.random() * a.length)]}${b[Math.floor(Math.random() * b.length)]}`;
}

function offlineRoster(setup: OfflineSetup, name: string): RosterEntry[] {
  const mine = characterFor(setup.character, setup.team);
  const roster: RosterEntry[] = [{ id: 'you', name: name || 'You', team: setup.team, isBot: false, character: mine }];
  const teams = setup.teams.includes(setup.team) ? setup.teams : [...setup.teams, setup.team];
  for (const team of teams) {
    const count = setup.teamSize - (team === setup.team ? 1 : 0);
    // Bots cycle through the team's characters (skipping yours) to show off the roster.
    const picks = botCharacters(team, count, team === setup.team ? [mine] : []);
    for (let i = 1; i <= count; i++) {
      roster.push({
        id: `bot-${team}-${i}`,
        name: `${['Ghost', 'Zombie', 'Skeleton', 'Demon'][team]} Bot ${i}`,
        team,
        isBot: true,
        character: picks[i - 1],
      });
    }
  }
  return roster;
}

export const useAppStore = create<AppState>((set, get) => {
  const persisted = readPersisted();
  const settings = { ...DEFAULT_SETTINGS, ...persisted.settings };

  const onOnlineUpdate = (snap: OnlineSnapshot) => {
    const st = get();
    const game = onlineGame;
    if (!game) return;
    if (snap.status === 'closed') {
      onlineGame = null;
      set({ online: null, session: null, screen: 'menu', menuError: snap.error ?? 'Disconnected.' });
      audio.play('ui.error');
      return;
    }
    const patch: Partial<AppState> = { online: snap };
    if (game.session && snap.sessionId !== st.online?.sessionId) {
      patch.session = game.session;
      patch.sessionKey = st.sessionKey + 1;
      patch.screen = 'game';
      patch.hud = initialHud;
      patch.feed = [];
      patch.popups = [];
    } else if (!game.session && st.screen === 'game') {
      patch.session = null;
      patch.screen = 'lobby';
    }
    // Lobby join/leave chimes.
    const before = st.online?.lobby?.players.length ?? 0;
    const after = snap.lobby?.players.length ?? 0;
    if (st.online && snap.lobby?.phase === 'lobby') {
      if (after > before) audio.play('ui.join');
      else if (after < before) audio.play('ui.leave');
    }
    set(patch);
  };

  return {
    screen: 'menu',
    playerName: persisted.playerName ?? randomName(),
    settings,
    offline: { ...DEFAULT_OFFLINE, ...persisted.offline },
    session: null,
    sessionKey: 0,
    online: null,
    menuError: null,
    showSettings: false,
    paused: false,
    hud: initialHud,
    feed: [],
    popups: [],
    announcement: null,

    setPlayerName: (name) => {
      set({ playerName: name.slice(0, 16) });
      writePersisted(get());
    },
    updateSettings: (patch) => {
      const next = { ...get().settings, ...patch };
      set({ settings: next });
      audio.setVolumes(next);
      writePersisted(get());
    },
    setOffline: (patch) => {
      const next = { ...get().offline, ...patch };
      // Changing team picks that team's hero unless a character for it was chosen too.
      next.character = characterFor(next.character, next.team);
      set({ offline: next });
      writePersisted(get());
    },
    setShowSettings: (v) => set({ showSettings: v }),
    setPaused: (v) => set({ paused: v }),

    startOffline: () => {
      const { offline, playerName } = get();
      const roster = offlineRoster(offline, playerName);
      const session = new HostSession({
        roster,
        localId: 'you',
        mapId: offline.mapId,
        roundSeconds: offline.roundSeconds,
        botDifficulty: offline.botDifficulty,
        isPaused: () => (typeof document !== 'undefined' && document.hidden) || get().paused,
      });
      set((s) => ({
        screen: 'game',
        session,
        sessionKey: s.sessionKey + 1,
        hud: initialHud,
        feed: [],
        popups: [],
        announcement: null,
        menuError: null,
        paused: false,
      }));
    },

    hostOnline: () => {
      onlineGame?.leave();
      onlineGame = new OnlineGame('host', generateRoomCode(), get().playerName, onOnlineUpdate);
      set({ screen: 'lobby', menuError: null, online: onlineGame.snapshot() });
    },

    joinOnline: (code) => {
      onlineGame?.leave();
      onlineGame = new OnlineGame('client', code, get().playerName, onOnlineUpdate);
      set({ screen: 'lobby', menuError: null, online: onlineGame.snapshot() });
    },

    leaveOnline: () => {
      onlineGame?.leave();
      onlineGame = null;
      set({ online: null, session: null, screen: 'menu' });
    },

    backToMenu: () => {
      if (onlineGame) {
        get().leaveOnline();
        return;
      }
      get().session?.dispose();
      set({ screen: 'menu', session: null, announcement: null });
    },

    setHud: (hud) => set({ hud }),

    pushFeed: (item) => {
      const entry = { ...item, id: uid++ };
      set((s) => ({ feed: [...s.feed.slice(-5), entry] }));
      setTimeout(() => set((s) => ({ feed: s.feed.filter((f) => f.id !== entry.id) })), 5000);
    },

    pushPopup: (text, kind) => {
      const entry = { id: uid++, text, kind };
      set((s) => ({ popups: [...s.popups.slice(-3), entry] }));
      setTimeout(() => set((s) => ({ popups: s.popups.filter((p) => p.id !== entry.id) })), 1800);
    },

    announce: (text, kind, sub) => {
      const entry = { id: uid++, text, kind, sub };
      set({ announcement: entry });
      if (announceTimer) clearTimeout(announceTimer);
      announceTimer = setTimeout(() => {
        if (get().announcement?.id === entry.id) set({ announcement: null });
      }, kind === 'count' ? 900 : 1900);
    },
  };
});
