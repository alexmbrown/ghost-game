// Asset pipeline status + consistency checks.
//
//   npm run assets            summary by kind/priority, and missing p0 assets
//   npm run assets -- --all   list every missing asset
//   npm run assets -- --index rebuild public/{audio,ui}/index.json from files on disk
//   npm run assets -- --index=audio   only audio (UI art stays on SVG until approved)
//
// The audio index also writes public/audio/loops.json: where each music track
// loops seamlessly (src/game/audio/loopPoints.ts; needs ffmpeg on the PATH to
// decode, otherwise the file is left as is and the game analyses at runtime).
//
// Fails (exit 1) if the manifest and the code disagree, e.g. a sound id used in
// src/game/audio/sounds.ts has no manifest entry, or the output paths differ.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { findLoopPoints, type LoopPoints } from '../src/game/audio/loopPoints';
import { SOUNDS, soundUrls, type SoundDef, type SoundId } from '../src/game/audio/sounds';
import { CHARACTERS } from '../src/game/core/characters';

interface Asset {
  id: string;
  kind: string;
  generator: string;
  priority: 'p0' | 'p1' | 'p2';
  status: string;
  output: string | string[];
  prompt: string;
  dependsOn?: string[];
}

const root = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'assets/manifest.json'), 'utf-8')) as { assets: Asset[] };
const args = new Set(process.argv.slice(2));
const outputs = (a: Asset) => (Array.isArray(a.output) ? a.output : [a.output]);
const present = (a: Asset) => outputs(a).every((o) => existsSync(join(root, o)));

const problems: string[] = [];
const byId = new Map(manifest.assets.map((a) => [a.id, a]));
if (byId.size !== manifest.assets.length) problems.push('duplicate asset ids in manifest');

// Every runtime sound must be catalogued with matching output paths.
for (const id of Object.keys(SOUNDS) as SoundId[]) {
  const a = byId.get(id);
  if (!a) {
    problems.push(`sound "${id}" is used in code but missing from the manifest`);
    continue;
  }
  const expected = soundUrls(id).map((u) => `public${u}`);
  const actual = outputs(a);
  if (expected.join('|') !== actual.join('|')) {
    problems.push(`sound "${id}" paths differ: code ${expected.join(', ')} vs manifest ${actual.join(', ')}`);
  }
}
// Every playable character needs a concept image and a model entry.
for (const c of Object.values(CHARACTERS)) {
  for (const prefix of ['concept.char.', 'model.char.']) {
    if (!byId.has(prefix + c.id)) problems.push(`character "${c.id}" has no ${prefix}${c.id} entry`);
  }
}
for (const a of manifest.assets) {
  for (const dep of a.dependsOn ?? []) if (!byId.has(dep)) problems.push(`${a.id} depends on unknown ${dep}`);
}

// --- report ------------------------------------------------------------------
const kinds = new Map<string, { total: number; done: number }>();
const prios = new Map<string, { total: number; done: number }>();
for (const a of manifest.assets) {
  const ok = present(a);
  for (const [map, key] of [
    [kinds, a.kind],
    [prios, a.priority],
  ] as const) {
    const e = map.get(key) ?? { total: 0, done: 0 };
    e.total++;
    if (ok) e.done++;
    map.set(key, e);
  }
}
const row = (k: string, v: { total: number; done: number }) =>
  `  ${k.padEnd(18)} ${String(v.done).padStart(3)} / ${String(v.total).padEnd(4)} ${'█'.repeat(Math.round((v.done / v.total) * 20)).padEnd(20, '·')}`;

console.log(`\nGhost Game assets — ${manifest.assets.length} catalogued\n`);
console.log('By kind:');
for (const [k, v] of [...kinds].sort()) console.log(row(k, v));
console.log('\nBy priority:');
for (const [k, v] of [...prios].sort()) console.log(row(k, v));

const missing = manifest.assets.filter((a) => !present(a) && (args.has('--all') || a.priority === 'p0'));
if (missing.length) {
  console.log(`\nMissing ${args.has('--all') ? '' : 'p0 '}assets (${missing.length}):`);
  for (const a of missing) console.log(`  [${a.priority}] ${a.id.padEnd(30)} ${a.generator.padEnd(10)} -> ${outputs(a)[0]}`);
}

// --- availability indexes (read at runtime so missing files never 404) --------
const indexArg = process.argv.find((a) => a.startsWith('--index'));
if (indexArg) {
  const which = indexArg.includes('=') ? indexArg.split('=')[1] : 'all';
  const index = (sub: string, pattern: RegExp) => {
    const dir = join(root, 'public', sub);
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (pattern.test(f)) files.push(relative(dir, p).split(sep).join('/'));
      }
    };
    if (existsSync(dir)) walk(dir);
    files.sort();
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ files }, null, 2) + '\n');
    console.log(`Wrote public/${sub}/index.json (${files.length} files)`);
  };
  /** Seamless loop region of every looping music track. */
  const loops = () => {
    const out: Record<string, LoopPoints> = {};
    for (const [id, def] of Object.entries(SOUNDS) as [SoundId, SoundDef][]) {
      if (!def.loop || def.bus !== 'music') continue;
      for (const url of soundUrls(id)) {
        const file = join(root, 'public', url);
        if (!existsSync(file)) continue;
        let raw: Buffer;
        try {
          raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
        } catch {
          console.warn('ffmpeg not available: public/audio/loops.json left unchanged (the game will analyse tracks itself)');
          return;
        }
        const p = findLoopPoints([new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4).slice()], 44100);
        const r = (v: number) => Math.round(v * 1000) / 1000;
        if (p) out[url.replace(/^\/audio\//, '')] = { start: r(p.start), end: r(p.end), quality: r(p.quality) };
      }
    }
    writeFileSync(join(root, 'public/audio/loops.json'), JSON.stringify(out, null, 2) + '\n');
    console.log(`Wrote public/audio/loops.json (${Object.keys(out).length} music loops)`);
  };
  console.log('');
  if (which === 'all' || which === 'audio') {
    index('audio', /\.(mp3|ogg|wav|m4a)$/i);
    loops();
  }
  if (which === 'all' || which === 'ui') index('ui', /\.(webp|png|jpe?g|svg)$/i);
}

if (problems.length) {
  console.error(`\n✖ ${problems.length} manifest problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n✓ Manifest is consistent with the code.\n');
