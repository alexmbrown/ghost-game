// Gameplay tunables. Keep balance numbers here so they are easy to iterate on.

/** Fixed simulation timestep (60 Hz). */
export const FIXED_DT = 1 / 60;

/** Arena size is per map (core/maps.ts). Perimeter wall height: */
export const WALL_HEIGHT = 3;

export const MAX_PLAYERS = 16;
export const MAX_TEAM_SIZE = 4;

export const PLAYER_RADIUS = 0.8;
export const PLAYER_SPEED = 10; // units/sec

/** Pre-round "3, 2, 1, GO!" — everyone frozen, keeps network starts in sync. */
export const COUNTDOWN_SECONDS = 3;
export const DEFAULT_ROUND_SECONDS = 120;
/** "Hurry up" threshold — music/announcer switch, like the Doodle's last 20s. */
export const HURRY_SECONDS = 20;

// --- trail -------------------------------------------------------------
/** Spacing between trail breadcrumbs. One carried flame sits on each crumb. */
export const TRAIL_SPACING = 0.7;
/** Crumbs between the player and their first carried flame. */
export const TRAIL_FLAME_OFFSET = 2;
/** Hard cap on breadcrumbs per player (bounds memory with huge trails). */
export const MAX_TRAIL = 420;
/** Distance at which a head touching a carried flame counts as contact. */
export const TRAIL_TOUCH_RADIUS = 1.0;

// --- stealing / buddy bonus (Great Ghoul Duel rules) ----------------------
/** Thief gets a short speed burst after a steal. */
export const STEAL_BURST_SECONDS = 1.5;
export const STEAL_BURST_MULT = 1.4;
/** Stolen-from players can't steal straight back for a moment. */
export const STEAL_IMMUNITY_SECONDS = 0.6;
/** Touching a teammate's trail grants both players this many flames. */
export const BUDDY_BONUS = 3;
export const BUDDY_COOLDOWN = 8;

// --- spirits (called "flames" in code; the Doodle's spirit flames) ------
export const FLAME_PICKUP_RADIUS = 1.2;
/** Absolute cap including knocked-loose spirits (instanced mesh capacity).
 *  Natural spawn budgets scale with arena size — see spiritBudget() in maps.ts. */
export const MAX_LOOSE_FLAMES = 280;

// --- mega spirits (flee from players, worth 10) --------------------------
export const MEGA_VALUE = 10;
/** Concurrent Mega-Spirits: 1, or 2 on big arenas (half >= 40). */
export const MEGA_MAX = 1;
export const MEGA_FIRST_SPAWN = 15;
export const MEGA_RESPAWN = 22;
export const MEGA_SPEED = 11.5;
export const MEGA_FLEE_RADIUS = 9;
export const MEGA_RADIUS = 1.1;

// --- magic pumpkin (temporary invulnerability + stun on touch) -----------
export const PUMPKIN_FIRST_SPAWN = 30;
export const PUMPKIN_RESPAWN = 20;
export const PUMPKIN_DURATION = 9;
export const PUMPKIN_PICKUP_RADIUS = 1.5;

// --- stun / knock-loose ----------------------------------------------------
/** "Ghosted" time after being stunned before reappearing at base. */
export const STUN_SECONDS = 1.6;
/** Brief knock-loose stagger (bone hit): flames scatter, player stays put. */
export const STAGGER_SECONDS = 0.7;

// --- bases -------------------------------------------------------------
export const BASE_RADIUS = 3.2; // bank zone radius around each team base
/** Enemies are pushed out of bases at this radius. */
export const BASE_BLOCK_RADIUS = 3.6;

// --- per-player progression (banked total unlocks; Doodle-style) ---------
export const POWER_SPEED_AT = 10; // permanent speed bonus for the round
export const POWER_SPEED_MULT = 1.25;
export const POWER_MAGNET_AT = 25; // pulls loose spirits in from afar
export const POWER_MAGNET_RADIUS = 2.4; // pickup radius with the magnet
export const MAGNET_PULL_RADIUS = 8.5;
export const MAGNET_PULL_SPEED = 18; // units/sec at point-blank, eased toward the edge
export const POWER_PHASE_AT = 50; // walk through obstacles
/** Max speed multiplier any combination of effects can reach (host validation). */
export const MAX_SPEED_MULT = 2.6;

// --- bots --------------------------------------------------------------
export type BotDifficulty = 'easy' | 'normal' | 'hard';
export const BOT_TUNING: Record<
  BotDifficulty,
  { speed: number; aggression: number; reaction: number; abilityUse: number }
> = {
  easy: { speed: 0.8, aggression: 0.15, reaction: 0.6, abilityUse: 0.3 },
  normal: { speed: 0.92, aggression: 0.45, reaction: 0.35, abilityUse: 0.7 },
  hard: { speed: 1.0, aggression: 0.8, reaction: 0.15, abilityUse: 1.0 },
};

// --- networking --------------------------------------------------------
/** Host broadcasts snapshots every N sim ticks (60/3 = 20 Hz). */
export const SNAPSHOT_EVERY_TICKS = 3;
/** Clients report their position at this rate. */
export const CLIENT_SEND_HZ = 30;
/** Render remote entities this far in the past so we always interpolate. */
export const INTERP_DELAY_MS = 110;
