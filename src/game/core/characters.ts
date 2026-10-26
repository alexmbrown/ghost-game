// Data-driven character + ability kits. Adding a character is content, not
// engineering: add an entry here, a model entry in r3f/creatureModels.ts, and
// its assets in assets/manifest.json.

import type { TeamId } from './types';

export type AbilityKind = 'dash' | 'field' | 'projectile' | 'rush';

export interface AbilityDef {
  id: string;
  name: string;
  /** Short HUD/tooltip description. */
  description: string;
  /** Icon name from src/game/ui/icons.tsx (kept as a plain string so core stays UI-free). */
  icon: string;
  kind: AbilityKind;
  cooldown: number;
  /** Active duration (dash/rush) or lifetime (field/projectile). */
  duration: number;
  /** Kind-specific tuning. */
  speedMult?: number;
  radius?: number;
  range?: number;
  projectileSpeed?: number;
  slowMult?: number;
}

export const ABILITIES: Record<string, AbilityDef> = {
  phaseDash: {
    id: 'phaseDash',
    name: 'Phase Dash',
    description: 'Burst forward through walls. Untouchable while phasing.',
    icon: 'phaseDash',
    kind: 'dash',
    cooldown: 7,
    duration: 0.28,
    speedMult: 2.6,
  },
  graveGrasp: {
    id: 'graveGrasp',
    name: 'Grave Grasp',
    description: 'Hands burst from the ground, slowing rivals caught inside.',
    icon: 'graveGrasp',
    kind: 'field',
    cooldown: 9,
    duration: 3.5,
    radius: 4.5,
    slowMult: 0.45,
  },
  boneToss: {
    id: 'boneToss',
    name: 'Bone Toss',
    description: 'Hurl a bone that knocks a rival’s spirits loose.',
    icon: 'boneToss',
    kind: 'projectile',
    cooldown: 4.5,
    duration: 0.75,
    projectileSpeed: 26,
    radius: 0.9,
  },
  hellfireRush: {
    id: 'hellfireRush',
    name: 'Hellfire Rush',
    description: 'Charge in hellfire — body-slam rivals to knock their spirits loose.',
    icon: 'hellfireRush',
    kind: 'rush',
    cooldown: 11,
    duration: 1.2,
    speedMult: 1.7,
    radius: 1.7,
  },
};

export interface CharacterDef {
  id: string;
  name: string;
  team: TeamId;
  ability: string;
  /** Playable (has a model). */
  available: boolean;
  /** The faction's hero: the default pick, and the only one with recorded voice lines. */
  hero?: boolean;
}

const char = (id: string, name: string, team: TeamId, ability: string, hero = false): CharacterDef => ({ id, name, team, ability, available: true, hero });

/** Four characters per faction; a faction's characters share its ability. */
export const CHARACTERS: Record<string, CharacterDef> = Object.fromEntries(
  [
    char('boo', 'Boo', 0, 'phaseDash', true),
    char('wisp', 'Wisp', 0, 'phaseDash'),
    char('clank', 'Clank', 0, 'phaseDash'),
    char('wailey', 'Wailey', 0, 'phaseDash'),
    char('shambles', 'Shambles', 1, 'graveGrasp', true),
    char('wraps', 'Wraps', 1, 'graveGrasp'),
    char('bolt', 'Bolt', 1, 'graveGrasp'),
    char('muncher', 'Muncher', 1, 'graveGrasp'),
    char('rattles', 'Rattles', 2, 'boneToss', true),
    char('calico', 'Calico', 2, 'boneToss'),
    char('bonesworth', 'Sir Bonesworth', 2, 'boneToss'),
    char('calavera', 'Calavera', 2, 'boneToss'),
    char('scorch', 'Scorch', 3, 'hellfireRush', true),
    char('horns', 'Horns', 3, 'hellfireRush'),
    char('gargle', 'Gargle', 3, 'hellfireRush'),
    char('hex', 'Hex', 3, 'hellfireRush'),
  ].map((c) => [c.id, c]),
);

/** A faction's playable characters, hero first. */
export function charactersFor(team: TeamId): CharacterDef[] {
  return Object.values(CHARACTERS).filter((c) => c.team === team && c.available);
}

/** Default character (the hero) for a faction. */
export function defaultCharacter(team: TeamId): string {
  const c = Object.values(CHARACTERS).find((d) => d.team === team && d.hero);
  return c ? c.id : 'boo';
}

/** True when `id` is a playable character of `team`. */
export function isCharacterFor(id: string | undefined, team: TeamId): boolean {
  const c = id ? CHARACTERS[id] : undefined;
  return !!c && c.available && c.team === team;
}

/** `id` if it can play for `team`, otherwise the team's hero. */
export function characterFor(id: string | undefined, team: TeamId): string {
  return isCharacterFor(id, team) ? id! : defaultCharacter(team);
}

/** Whose recorded voice lines a character uses (alternates borrow their hero's). */
export function voiceOf(id: string): string {
  const c = CHARACTERS[id];
  return c?.hero ? id : defaultCharacter(c?.team ?? 0);
}

/**
 * Characters for a team's bots: the team's characters not already taken by
 * `taken`, cycled, so matches show off the whole roster.
 */
export function botCharacters(team: TeamId, count: number, taken: readonly string[] = []): string[] {
  const all = charactersFor(team).map((c) => c.id);
  const free = all.filter((id) => !taken.includes(id));
  const pool = free.length ? free : all;
  return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
}

export function abilityFor(characterId: string): AbilityDef {
  const c = CHARACTERS[characterId] ?? CHARACTERS.boo;
  return ABILITIES[c.ability];
}
