import type { TeamId } from './types';

export interface FactionDef {
  id: TeamId;
  /** Faction name (the "team"). */
  name: string;
  /** Singular, for bot names and announcer lines ("Ghost 2", "Ghosts win!"). */
  singular: string;
  /** Primary team color (hex). Carried flames glow in this color. */
  color: string;
  /** Lighter accent for UI/highlights. */
  accent: string;
  /** One-line flavor for the menu. */
  blurb: string;
}

// 4 factions, one per arena corner. Each has a character roster in
// characters.ts (1 shipped per faction; 4 per faction is the target).
export const FACTIONS: readonly FactionDef[] = [
  {
    id: 0,
    name: 'Ghosts',
    singular: 'Ghost',
    color: '#67e8f9',
    accent: '#ecfeff',
    blurb: 'Phasing & mobility',
  },
  {
    id: 1,
    name: 'Zombies',
    singular: 'Zombie',
    color: '#a3e635',
    accent: '#f7fee7',
    blurb: 'Durability & control',
  },
  {
    id: 2,
    name: 'Skeletons',
    singular: 'Skeleton',
    color: '#fcd34d',
    accent: '#fffbeb',
    blurb: 'Ranged & precise',
  },
  {
    id: 3,
    name: 'Demons',
    singular: 'Demon',
    color: '#f87171',
    accent: '#fee2e2',
    blurb: 'Aggression & burst',
  },
];

export const TEAM_IDS: readonly TeamId[] = [0, 1, 2, 3];

/** Neutral spirit flames — violet so they never read as any team's color. */
export const FLAME_COLOR = '#b48cff';
export const MEGA_FLAME_COLOR = '#d6c2ff';
