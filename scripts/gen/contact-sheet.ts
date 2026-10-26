// Build contact sheets of generated images for quick visual review.
//   npx tsx scripts/gen/contact-sheet.ts <out-dir>

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

import { exists, loadManifest, outputs, ROOT } from './lib';

const outDir = process.argv[2] ?? join(ROOT, 'assets', 'sheets');
mkdirSync(outDir, { recursive: true });

const groups: Record<string, (id: string) => boolean> = {
  characters: (id) => id.startsWith('concept.char.'),
  props: (id) => id.startsWith('concept.prop.'),
  ui: (id) => id.startsWith('ui.'),
  textures: (id) => id.startsWith('tex.'),
};

async function sheet(name: string, ids: string[], cell = 220, cols = 8): Promise<void> {
  const rows = Math.ceil(ids.length / cols);
  const tiles = await Promise.all(
    ids.map(async (id, i) => {
      const a = loadManifest().assets.find((x) => x.id === id)!;
      const file = join(ROOT, outputs(a)[0]);
      const img = await sharp(file)
        .resize(cell - 8, cell - 28, { fit: 'contain', background: { r: 40, g: 34, b: 60, alpha: 1 } })
        .flatten({ background: { r: 40, g: 34, b: 60 } })
        .toBuffer();
      const label = Buffer.from(
        `<svg width="${cell}" height="22"><text x="4" y="15" font-size="12" font-family="Arial" fill="#fff">${id.replace(/^(concept\.(char|prop)|ui|tex)\./, '')}</text></svg>`,
      );
      return [
        { input: img, left: (i % cols) * cell + 4, top: Math.floor(i / cols) * cell + 4 },
        { input: label, left: (i % cols) * cell, top: Math.floor(i / cols) * cell + cell - 22 },
      ];
    }),
  );
  await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: { r: 18, g: 14, b: 32 } } })
    .composite(tiles.flat())
    .jpeg({ quality: 82 })
    .toFile(join(outDir, `${name}.jpg`));
  console.log(`${name}: ${ids.length} -> ${join(outDir, `${name}.jpg`)}`);
}

async function main() {
  const assets = loadManifest().assets.filter((a) => a.generator === 'gemini' && exists(outputs(a)[0]));
  for (const [name, pred] of Object.entries(groups)) {
    const ids = assets.filter((a) => pred(a.id)).map((a) => a.id);
    if (ids.length) await sheet(name, ids);
  }
}

void main();
