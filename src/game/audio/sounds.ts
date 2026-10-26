// Runtime audio registry: sound id -> file + mix settings.
//
// Every id here has a matching entry (with its ElevenLabs generation prompt) in
// assets/manifest.json. Files live in public/audio/. Until a file exists the
// AudioManager plays a procedural placeholder (see synth.ts), so the game is
// never silent and wiring can be tested before assets are generated.

export type Bus = 'music' | 'sfx' | 'voice' | 'ambient' | 'ui';

export interface SoundDef {
  file: string;
  bus: Bus;
  volume?: number;
  /** Random +/- playback-rate variation for repeated SFX. */
  pitchVar?: number;
  /** Number of variant files: file_1.mp3 … file_N.mp3, one picked at random. */
  variants?: number;
  loop?: boolean;
  /** Sound id played instead when this sound's file hasn't been generated yet. */
  fallback?: string;
}

const sfx = (file: string, volume = 0.8, pitchVar = 0.06, variants?: number): SoundDef => ({
  file: `sfx/${file}`,
  bus: 'sfx',
  volume,
  pitchVar,
  variants,
});
const vo = (file: string, volume = 1): SoundDef => ({ file: `vo/${file}`, bus: 'voice', volume });
const music = (file: string, loop = true, volume = 0.55, fallback?: string): SoundDef => ({
  file: `music/${file}`,
  bus: 'music',
  loop,
  volume,
  fallback,
});

export const SOUNDS = {
  // --- music ---
  'music.menu': music('menu_theme'),
  'music.lobby': music('lobby_loop', true, 0.5, 'music.menu'),
  'music.match.graveyard': music('match_graveyard', true, 0.55, 'music.match.mansion'),
  'music.match.cornmaze': music('match_cornmaze'),
  'music.match.mansion': music('match_mansion'),
  'music.match.forest': music('match_forest'),
  'music.match.library': music('match_library'),
  'music.hurry': music('hurry_up', true, 0.6),
  'music.victory': music('stinger_victory', false, 0.7),
  'music.defeat': music('stinger_defeat', false, 0.7),
  'music.draw': music('stinger_draw', false, 0.7),

  // --- ambience ---
  'amb.graveyard': { file: 'amb/graveyard_night', bus: 'ambient', loop: true, volume: 0.45 },
  'amb.cornmaze': { file: 'amb/cornfield_night', bus: 'ambient', loop: true, volume: 0.45 },
  'amb.mansion': { file: 'amb/mansion_creaks', bus: 'ambient', loop: true, volume: 0.45 },
  'amb.forest': { file: 'amb/forest_night', bus: 'ambient', loop: true, volume: 0.45 },
  'amb.library': { file: 'amb/library_hush', bus: 'ambient', loop: true, volume: 0.45 },

  // --- flames & scoring ---
  'sfx.flame.pickup': sfx('flame_pickup', 0.6, 0.12, 3),
  'sfx.flame.pickupMega': sfx('flame_pickup_mega', 0.9),
  'sfx.flame.bankSmall': sfx('bank_small', 0.85),
  'sfx.flame.bankBig': sfx('bank_big', 0.95),
  'sfx.steal.thief': sfx('steal_whoosh_high', 0.9),
  'sfx.steal.victim': sfx('steal_whoosh_low', 0.9),
  'sfx.buddy': sfx('buddy_bonus', 0.85),
  'sfx.stun': sfx('pumpkin_stun', 0.95),
  'sfx.knock': sfx('flames_knocked_loose', 0.9),
  'sfx.respawn': sfx('respawn_poof', 0.7),
  'sfx.power': sfx('power_unlock', 0.9, 0),

  // --- abilities ---
  'sfx.ability.phaseDash': sfx('ability_phase_dash', 0.85),
  'sfx.ability.graveGrasp': sfx('ability_grave_grasp', 0.9),
  'sfx.ability.boneToss': sfx('ability_bone_toss', 0.85),
  'sfx.ability.hellfireRush': sfx('ability_hellfire_rush', 0.9),
  'sfx.ability.ready': sfx('ability_ready', 0.5, 0),

  // --- specials ---
  'sfx.pumpkin.spawn': sfx('pumpkin_spawn', 0.8, 0),
  'sfx.pumpkin.get': sfx('pumpkin_pickup', 0.95, 0),
  'sfx.mega.spawn': sfx('mega_flame_spawn', 0.8, 0),

  // --- footsteps (per faction, played while moving) ---
  'sfx.step.ghost': sfx('step_ghost_whoosh', 0.18, 0.15, 3),
  'sfx.step.zombie': sfx('step_zombie_shuffle', 0.22, 0.12, 3),
  'sfx.step.skeleton': sfx('step_skeleton_clack', 0.22, 0.12, 3),
  'sfx.step.demon': sfx('step_demon_hoof', 0.22, 0.12, 3),

  // --- round flow ---
  'sfx.countdown.tick': sfx('countdown_tick', 0.8, 0),
  'sfx.countdown.go': sfx('countdown_go', 0.9, 0),
  'sfx.hurry': sfx('hurry_bell', 0.9, 0),
  'sfx.round.end': sfx('round_end_gong', 0.9, 0),

  // --- UI ---
  'ui.click': { file: 'ui/click', bus: 'ui', volume: 0.6, pitchVar: 0.04 },
  'ui.hover': { file: 'ui/hover', bus: 'ui', volume: 0.25, pitchVar: 0.04 },
  'ui.back': { file: 'ui/back', bus: 'ui', volume: 0.6 },
  'ui.join': { file: 'ui/player_join', bus: 'ui', volume: 0.7 },
  'ui.leave': { file: 'ui/player_leave', bus: 'ui', volume: 0.6 },
  'ui.error': { file: 'ui/error', bus: 'ui', volume: 0.6 },
  'ui.copy': { file: 'ui/copy', bus: 'ui', volume: 0.6 },

  // --- announcer ---
  'vo.welcome': vo('announcer_welcome'),
  'vo.three': vo('announcer_three'),
  'vo.two': vo('announcer_two'),
  'vo.one': vo('announcer_one'),
  'vo.go': vo('announcer_go'),
  'vo.hurry': vo('announcer_twenty_seconds'),
  'vo.win.0': vo('announcer_ghosts_win'),
  'vo.win.1': vo('announcer_zombies_win'),
  'vo.win.2': vo('announcer_skeletons_win'),
  'vo.win.3': vo('announcer_demons_win'),
  'vo.draw': vo('announcer_draw'),
  'vo.victory': vo('announcer_victory'),
  'vo.defeat': vo('announcer_defeat'),
  'vo.megaSpawn': vo('announcer_mega_flame'),
  'vo.pumpkinSpawn': vo('announcer_pumpkin'),
  'vo.bigBank': vo('announcer_huge_bank'),
  'vo.power.speed': vo('announcer_power_speed'),
  'vo.power.magnet': vo('announcer_power_magnet'),
  'vo.power.phase': vo('announcer_power_phase'),

  // --- character barks (character id from core/characters.ts) ---
  'vo.boo.steal': vo('boo_steal'),
  'vo.boo.stolen': vo('boo_stolen'),
  'vo.boo.bank': vo('boo_bank'),
  'vo.boo.ability': vo('boo_ability'),
  'vo.shambles.steal': vo('shambles_steal'),
  'vo.shambles.stolen': vo('shambles_stolen'),
  'vo.shambles.bank': vo('shambles_bank'),
  'vo.shambles.ability': vo('shambles_ability'),
  'vo.rattles.steal': vo('rattles_steal'),
  'vo.rattles.stolen': vo('rattles_stolen'),
  'vo.rattles.bank': vo('rattles_bank'),
  'vo.rattles.ability': vo('rattles_ability'),
  'vo.scorch.steal': vo('scorch_steal'),
  'vo.scorch.stolen': vo('scorch_stolen'),
  'vo.scorch.bank': vo('scorch_bank'),
  'vo.scorch.ability': vo('scorch_ability'),
} satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

export const AUDIO_EXT = 'mp3';

/** Public URL(s) for a sound (all variants). */
export function soundUrls(id: SoundId, base = ''): string[] {
  const def: SoundDef = SOUNDS[id];
  if (def.variants && def.variants > 1) {
    return Array.from({ length: def.variants }, (_, i) => `${base}/audio/${def.file}_${i + 1}.${AUDIO_EXT}`);
  }
  return [`${base}/audio/${def.file}.${AUDIO_EXT}`];
}
