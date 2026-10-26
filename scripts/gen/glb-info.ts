// Inspect GLBs: bounds, top-level transforms, clips and how far the hips
// travel in each clip (root motion would make in-game characters drift).
//   npx tsx scripts/gen/glb-info.ts public/models/characters/shambles.glb

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const fmt = (v: number[]) => v.map((x) => x.toFixed(2)).join(', ');

async function main() {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const file of process.argv.slice(2)) {
    const doc = await io.read(file);
    const root = doc.getRoot();
    const scene = root.listScenes()[0];
    const b = getBounds(scene);
    console.log(`\n${file}\n  bounds [${fmt(b.min)}] .. [${fmt(b.max)}], height ${(b.max[1] - b.min[1]).toFixed(2)} (bind pose, skinning ignored)`);
    console.log(`  top nodes: ${scene.listChildren().map((n) => `${n.getName()} scale [${fmt(n.getScale())}]`).join(' | ')}`);
    for (const anim of root.listAnimations()) {
      const dur = Math.max(...anim.listSamplers().map((s) => s.getInput()?.getMax([] as number[])[0] ?? 0));
      let motion = '';
      for (const ch of anim.listChannels()) {
        const node = ch.getTargetNode();
        const out = ch.getSampler()?.getOutput();
        if (ch.getTargetPath() !== 'translation' || !node || !out || !/hip|root|pelvis/i.test(node.getName())) continue;
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < out.getCount(); i++) {
          const v = out.getElement(i, [] as number[]);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], v[k]);
            hi[k] = Math.max(hi[k], v[k]);
          }
        }
        motion = `${node.getName()} travel [${fmt(hi.map((h, k) => h - lo[k]))}]`;
        break;
      }
      console.log(`  clip "${anim.getName()}" ${dur.toFixed(2)}s ${motion}`);
    }
  }
}

void main();
