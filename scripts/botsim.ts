// Headless balance check: runs bot-only rounds and prints per-match stats.
// Usage: npm run sim   (options: npm run sim -- [seed] [--all]  — --all runs every difficulty)

import { defaultCharacter } from '../src/game/core/characters';
import * as C from '../src/game/core/constants';
import { GameEngine } from '../src/game/core/engine';
import { MAP_IDS } from '../src/game/core/maps';
import type { RosterEntry, TeamId } from '../src/game/core/types';

const seed = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 11);

const diffs = process.argv.includes('--all') ? (['easy', 'normal', 'hard'] as const) : (['normal'] as const);
for (const map of MAP_IDS) {
  for (const diff of diffs) {
    const roster: RosterEntry[] = ([0, 1, 2, 3] as TeamId[]).flatMap((t) =>
      [0, 1].map((i) => ({ id: `b${t}${i}`, name: `b${t}${i}`, team: t, isBot: true, character: defaultCharacter(t) })),
    );
    const e = new GameEngine({ roster, seed, mapId: map, botDifficulty: diff });
    const counts: Record<string, number> = {};
    let idle = 0;
    let samples = 0;
    const last = new Map<string, { x: number; z: number }>();
    while (e.state.phase !== 'ended') {
      e.step(C.FIXED_DT);
      for (const ev of e.drainEvents()) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
      if (e.state.phase !== 'playing') continue;
      for (const p of e.state.players) {
        const l = last.get(p.id);
        if (p.stunTimer <= 0 && p.staggerTimer <= 0) {
          samples++;
          if (l && Math.hypot(p.pos.x - l.x, p.pos.z - l.z) < 1e-3) idle++;
        }
        last.set(p.id, { ...p.pos });
      }
    }
    const { pickup = 0, bank = 0, steal = 0, buddy = 0, stun = 0, knock = 0, ability = 0, pumpkin = 0 } = counts;
    console.log(
      `${map.padEnd(10)} ${diff.padEnd(6)} scores ${e.state.bases.map((b) => b.score).join('/').padEnd(15)}` +
        ` idle ${((100 * idle) / samples).toFixed(1).padStart(4)}%  pickups ${pickup} banks ${bank}` +
        ` steals ${steal} buddy ${buddy} stuns ${stun} knocks ${knock} abilities ${ability} pumpkins ${pumpkin}`,
    );
  }
}
