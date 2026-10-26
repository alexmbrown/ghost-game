// Prop catalog and map dressing. Run: npm test

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { MAP_IDS, MAPS } from '../../core/maps';
import { themeFor } from '../mapThemes';
import { PROP_NAMES, PROPS, type PropName } from './catalog';
import { dressArena, dressScenery, propsUsed, SET_PIECES, topOf, type Dressing } from './layout';

const file = (name: string) => join(process.cwd(), 'public/models/props', `${name}.glb`);

function dress(mapId: string): { arena: Dressing; scenery: Dressing } {
  const map = MAPS[mapId];
  const theme = themeFor(mapId);
  return {
    arena: dressArena(map.obstacles, map.half, { trees: theme.trees, wallModel: theme.walls.model }),
    scenery: dressScenery(mapId, map.half, theme.fx.torch),
  };
}

describe('prop catalog', () => {
  let io: NodeIO;
  before(async () => {
    await MeshoptDecoder.ready;
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  });

  it('records each model’s real size (layouts fit models without loading them)', async () => {
    for (const name of PROP_NAMES) {
      assert.ok(existsSync(file(name)), `${name}.glb is missing`);
      const b = getBounds((await io.read(file(name))).getRoot().listScenes()[0]);
      const real = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
      PROPS[name].size.forEach((v, k) => assert.ok(Math.abs(v - real[k]) < 0.02, `${name} size[${k}] is ${v}, model says ${real[k].toFixed(2)}`));
    }
  });

  it('puts every model somewhere in the game', () => {
    const used = new Set<PropName>(SET_PIECES);
    for (const id of MAP_IDS) {
      const d = dress(id);
      for (const n of propsUsed(d.arena, d.scenery)) used.add(n);
    }
    assert.deepEqual(
      PROP_NAMES.filter((n) => !used.has(n)),
      [],
    );
  });
});

describe('map dressing', () => {
  for (const id of MAP_IDS) {
    it(`${id}: every obstacle gets a model inside its collision box`, () => {
      const { arena } = dress(id);
      const places = Object.values(arena.props).flat();
      for (const o of MAPS[id].obstacles) {
        const inside = places.some((p) => p.x >= o.min.x - 0.01 && p.x <= o.max.x + 0.01 && p.z >= o.min.z - 0.01 && p.z <= o.max.z + 0.01);
        assert.ok(inside, `${o.kind} at ${o.min.x},${o.min.z} has no model`);
      }
    });

    it(`${id}: models are finite, upright and sensibly sized`, () => {
      const d = dress(id);
      for (const [name, list] of Object.entries({ ...d.arena.props, ...d.arena.walls, ...d.scenery.props }) as [PropName, NonNullable<Dressing['props'][PropName]>][]) {
        for (const p of list) {
          assert.ok([p.x, p.z, ...p.s].every(Number.isFinite), `${name} has a bad transform`);
          assert.ok(p.s.every((v) => v > 0), `${name} is flipped or flat`);
          const top = topOf(name, p);
          assert.ok(top > 0.1 && top < 20, `${name} is ${top.toFixed(1)} tall`);
        }
      }
    });

    it(`${id}: shrine pillars, tables and mausoleums carry their flames`, () => {
      const lit = MAPS[id].obstacles.filter((o) => o.kind === 'pillar' || o.kind === 'table' || o.kind === 'mausoleum').length;
      const { arena } = dress(id);
      assert.ok(arena.fires.length >= lit, `${arena.fires.length} flames for ${lit} lit obstacles`);
      for (const f of arena.fires) assert.ok(f.y > 0.5 && f.y < 12, `flame at height ${f.y}`);
    });
  }
});
