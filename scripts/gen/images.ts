// Gemini image generator for every image asset in assets/manifest.json
// (concept-image, ui-image, texture).
//
//   npm run gen:images                     # everything missing
//   npm run gen:images -- concept.char     # by id prefix
//   npm run gen:images -- ui-image --prio=p0
//   npm run gen:images -- --dry
//   npm run gen:images -- --ship           # re-size public copies from masters
//
// - Hero art (characters, logo, key art) uses the Pro image model; the rest
//   uses Flash (same request shape the clean-factory generators use).
// - Prompts are `<style> <subject>`: characters/props use the manifest's
//   `styleGuide`; textures, skies, VFX sprites, UI art and key art each have
//   their own entry in `styles` (the character guide made Gemini draw
//   characters into textures and thumbnails).
// - Style anchors (approved images passed as references) keep the set on one
//   look: Shambles for characters, the iron gate for the fence (props
//   otherwise go without one: a reference prop's base, glow and ghosts leaked
//   into everything), the Zombie crest for the Ghost crest and the Ghost
//   crest for the rest, Phase Dash for the other ability icons. Portraits and
//   key art get the matching character concepts so the heroes stay on-model.
//   (Boo used to anchor everything, but its look leaked into other characters
//   and props.)
// - Icons, crests, badges, banners and portraits are drawn on a flat magenta
//   key and cut out to transparent WebP (Gemini can't output alpha). The raw
//   image is kept in assets/raw/ for re-keying.
// - Generated UI art is NOT activated in-game here; after review run
//   `npm run assets:index` to switch the SVG icons over to it.

import sharp from 'sharp';

import {
  abort,
  type Asset,
  exists,
  isAborted,
  isFatal,
  key,
  loadManifest,
  markStatus,
  outputs,
  parseArgs,
  pool,
  request,
  ROOT,
  selected,
  writeOut,
  HttpError,
} from './lib';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PRO = 'gemini-3-pro-image';
const FLASH = 'gemini-3.1-flash-image';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const KEY_COLOR = { r: 255, g: 0, b: 255 };
const KEY_CLAUSE =
  'Isolated on a perfectly flat, solid pure magenta (#FF00FF) background filling the whole frame, no gradient, no shadow on the background, no magenta anywhere on the subject.';

/** Assets cut out to transparency. */
function needsKey(a: Asset): boolean {
  if (a.id === 'tex.corn_card') return true;
  return a.kind === 'ui-image' && /^ui\.(crest_|icon_|award_|app_icon|logo|banner_|portrait\.)/.test(a.id);
}

function modelFor(a: Asset): string {
  if (a.id.startsWith('concept.char.')) return PRO;
  if (['ui.logo', 'ui.keyart_menu', 'ui.og_share', 'ui.loading'].includes(a.id)) return PRO;
  return FLASH;
}

const CHAR = (slug: string) => `assets/concepts/characters/${slug}.png`;
const PROP = (slug: string) => `assets/concepts/props/${slug}.png`;
const STYLE_ONLY =
  'Use the reference image ONLY as a style guide: match its rendering style, materials, proportions language, outline weight and lighting. Do not include or copy the reference subject.';
const HEROES = ['boo', 'shambles', 'rattles', 'scorch'].map(CHAR);

/** Style anchors (already-generated files) passed as reference images. */
function anchorFor(a: Asset): { files: string[]; note: string } | null {
  // An explicit reference (e.g. re-posing an approved character) wins over the style anchors.
  const own = a.params as { reference?: string; reference_note?: string } | undefined;
  if (own?.reference) return { files: [own.reference], note: own.reference_note ?? 'Keep the reference character exactly on-model.' };
  if (a.id.startsWith('concept.char.')) {
    return { files: [CHAR(a.id === 'concept.char.shambles' ? 'rattles' : 'shambles')], note: STYLE_ONLY };
  }
  if (a.id === 'concept.prop.iron_fence') {
    return { files: [PROP('iron_gate')], note: 'The reference is the matching cemetery gate: use the same wrought-iron material, colors, finials and scrollwork style so the fence and gate read as one set. Draw the fence, not the gate.' };
  }
  const ref = (a.params as { style_reference?: string } | undefined)?.style_reference;
  if (a.id.startsWith('ui.portrait.') && ref) {
    return { files: [ref], note: 'The reference image is the character model sheet: keep the character exactly on-model.' };
  }
  if (['ui.keyart_menu', 'ui.og_share'].includes(a.id)) {
    return { files: HEROES, note: 'The reference images are the model sheets for Boo, Shambles, Rattles and Scorch (in that order): keep each hero exactly on-model.' };
  }
  if (['ui.loading', 'ui.app_icon'].includes(a.id)) {
    return { files: [CHAR('boo')], note: 'The reference image is the model sheet for Boo: keep Boo exactly on-model.' };
  }
  if (a.id === 'ui.crest_ghosts') {
    return { files: ['assets/raw/ui/crest_zombies.png'], note: 'Match the reference crest exactly in shape, framing, border style and rendering; only the emblem and colors change.' };
  }
  if (/^ui\.crest_(zombies|skeletons|demons)$/.test(a.id)) {
    return { files: ['assets/raw/ui/crest_ghosts.png'], note: 'Match the reference crest exactly in shape, framing, border style and rendering; only the face, emblem and colors change.' };
  }
  if (a.id === 'ui.icon_mega') {
    return { files: ['assets/raw/ui/icon_flame.png'], note: 'The reference is the regular spirit icon: match its rendering style and outline; this one is a bigger, scared Mega-Spirit.' };
  }
  if (a.id === 'ui.icon_pumpkin') {
    return { files: [PROP('magic_pumpkin')], note: 'The reference is the Magic Pumpkin model sheet: draw that same pumpkin as an icon.' };
  }
  if (/^ui\.icon_(graveGrasp|boneToss|hellfireRush)$/.test(a.id)) {
    return { files: ['assets/raw/ui/icon_phaseDash.png'], note: 'Match the reference icon exactly in shape, border, framing and rendering style; only the subject and colors change.' };
  }
  return null;
}

/** Anchors other assets reference are generated first, in this order. */
const ANCHORS = ['ui.crest_ghosts', 'ui.icon_phaseDash'];

interface GeminiPart {
  inlineData?: { mimeType: string; data: string };
  text?: string;
}

async function callGemini(model: string, prompt: string, aspect: string | undefined, size: string | undefined, refs: Buffer[] = []): Promise<Buffer> {
  const parts: unknown[] = [];
  for (const ref of refs) parts.push({ inline_data: { mime_type: 'image/png', data: ref.toString('base64') } });
  parts.push({ text: prompt });
  const imageConfig: Record<string, string> = {};
  if (aspect) imageConfig.aspectRatio = aspect;
  if (size) imageConfig.imageSize = size;
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig } };
  let res: Response;
  try {
    res = await request(
      `${API}/${model}:generateContent`,
      { method: 'POST', headers: { 'x-goog-api-key': key('GEMINI_API_KEY'), 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      { timeoutMs: 300_000 },
    );
  } catch (e) {
    // Older/other models may not accept imageSize — retry once without it.
    if (size && e instanceof HttpError && e.status === 400 && /imageSize|image_size/i.test(e.body)) {
      return callGemini(model, prompt, aspect, undefined, refs);
    }
    throw e;
  }
  const j = (await res.json()) as { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]; promptFeedback?: unknown };
  // Gemini 3 image models may emit interim "thought" images first: keep the last image.
  let img: GeminiPart['inlineData'] | undefined;
  for (const c of j.candidates ?? []) for (const p of c.content?.parts ?? []) if (p.inlineData) img = p.inlineData;
  if (!img) throw new Error(`no image returned (${JSON.stringify(j.candidates?.[0]?.finishReason ?? j.promptFeedback ?? 'unknown')})`);
  return Buffer.from(img.data, 'base64');
}

/** Magenta chroma key → RGBA with soft edges and de-spill. */
async function keyOut(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // How "magenta" the pixel is: high red+blue, low green.
    const m = Math.min(r, b) - g;
    const dist = Math.hypot(r - KEY_COLOR.r, g - KEY_COLOR.g, b - KEY_COLOR.b);
    let alpha = 255;
    if (dist < 90) alpha = 0;
    else if (m > 60) alpha = Math.max(0, Math.min(255, 255 - (m - 60) * 2.2));
    if (alpha < 255 && alpha > 0) {
      // De-spill: pull red/blue down toward green on edge pixels.
      const cap = g + 40;
      data[i] = Math.min(r, cap);
      data[i + 2] = Math.min(b, cap);
    }
    data[i + 3] = Math.min(data[i + 3], alpha);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function generate(a: Asset): Promise<void> {
  const out = outputs(a)[0];
  if (exists(out)) return;
  const params = (a.params ?? {}) as { aspect_ratio?: string; image_size?: string };
  const model = modelFor(a);
  const keyed = needsKey(a);
  const anchor = anchorFor(a);
  const refs = (anchor?.files ?? []).map((f) => {
    if (!exists(f)) throw new Error(`style anchor missing: ${f}`);
    return readFileSync(join(ROOT, f));
  });
  const prompt = [a.prompt, keyed ? KEY_CLAUSE : '', anchor?.note ?? ''].filter(Boolean).join(' ');
  const raw = await callGemini(model, prompt, params.aspect_ratio, params.image_size ?? '2K', refs);
  const sidecar = { id: a.id, model, aspect: params.aspect_ratio, styleAnchors: anchor?.files ?? [], keyed, prompt };

  if (keyed) {
    // public/ui/portraits/boo.webp -> assets/raw/ui/portraits/boo.png
    const rawPath = out.replace(/^public\//, 'assets/raw/').replace(/\.[a-z]+$/, '.png');
    const rawPng = await sharp(raw).png().toBuffer();
    writeOut(rawPath, rawPng, sidecar);
    const cut = await keyOut(rawPng);
    await ship(out, await sharp(cut).webp({ quality: 92, alphaQuality: 100 }).toBuffer(), sidecar);
  } else if (out.endsWith('.webp')) {
    await ship(out, await sharp(raw).webp({ quality: 90 }).toBuffer(), sidecar);
  } else {
    writeOut(out, await sharp(raw).png().toBuffer(), sidecar);
  }
}

// --- shipping sizes -------------------------------------------------------------
//
// Gemini renders at 2K+, far more than the game shows (a 2048px icon drawn at
// 40px). The full-size result is kept as a master in assets/raw/ and public/
// gets a copy sized to its use. `--ship` rebuilds every public copy from the
// masters (adopting the current public file as the master when there is none).

/** Longest-edge cap for a public image, by path. */
function shipMax(out: string): number {
  const name = out.split('/').pop()!;
  if (out.startsWith('public/ui/portraits/')) return 384;
  if (/^(icon_|crest_|award_)/.test(name)) return 384;
  if (name.startsWith('app_icon')) return 512;
  if (name.startsWith('logo')) return 1400;
  if (name.startsWith('banner_')) return 1600;
  if (name.startsWith('map_')) return 1280;
  if (out.startsWith('public/ui/')) return 1920; // key art, loading, share card
  if (name.startsWith('sky_')) return 4096; // mobile GPUs cap textures at 4096
  if (name.startsWith('vfx_')) return 256;
  return 1024; // tiling textures
}

const masterOf = (out: string) => out.replace(/^public\//, 'assets/raw/');

async function ship(out: string, full: Buffer, sidecar: Record<string, unknown>): Promise<void> {
  mkdirSync(dirname(join(ROOT, masterOf(out))), { recursive: true });
  writeFileSync(join(ROOT, masterOf(out)), full);
  const max = shipMax(out);
  // The logo and ribbons float in a wide transparent frame; crop it so CSS can size them.
  const trim = /\/(logo|banner_)[^/]*$/.test(out);
  const src = trim ? await sharp(full).trim({ threshold: 8 }).toBuffer() : full;
  const img = sharp(src).resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true });
  const alpha = (await sharp(full).metadata()).hasAlpha;
  writeOut(out, await img.webp(alpha ? { quality: 90, alphaQuality: 100 } : { quality: 86 }).toBuffer(), { ...sidecar, master: masterOf(out) });
}

/** Re-ship every generated webp under public/ui and public/textures from its master. */
async function shipAll(): Promise<void> {
  const files = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(`${dir}/${e.name}`) : e.name.endsWith('.webp') ? [`${dir}/${e.name}`] : [],
    );
  let before = 0;
  let after = 0;
  for (const out of [...files('public/ui'), ...files('public/textures')]) {
    const master = join(ROOT, masterOf(out));
    if (!existsSync(master)) {
      mkdirSync(dirname(master), { recursive: true });
      copyFileSync(join(ROOT, out), master);
    }
    before += statSync(join(ROOT, out)).size;
    const side = join(ROOT, out.replace(/\.webp$/, '.json'));
    const sidecar = existsSync(side) ? (JSON.parse(readFileSync(side, 'utf8')) as Record<string, unknown>) : {};
    await ship(out, readFileSync(master), sidecar);
    after += statSync(join(ROOT, out)).size;
  }
  console.log(`shipped: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
  await shipAppFiles();
}

/** Favicon, Apple touch icon and share card, as Next.js app-directory metadata files. */
async function shipAppFiles(): Promise<void> {
  const icon = join(ROOT, masterOf('public/ui/app_icon.webp'));
  if (existsSync(icon)) {
    await sharp(icon).resize(256, 256).png({ palette: true, quality: 90 }).toFile(join(ROOT, 'src/app/icon.png'));
    // iOS paints transparent corners black; give it the night-ink backdrop instead.
    await sharp(icon).resize(180, 180).flatten({ background: '#1b1030' }).png().toFile(join(ROOT, 'src/app/apple-icon.png'));
  }
  const og = join(ROOT, masterOf('public/ui/og_share.webp'));
  if (existsSync(og)) {
    await sharp(og).resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 86 }).toFile(join(ROOT, 'src/app/opengraph-image.jpg'));
    writeFileSync(join(ROOT, 'src/app/opengraph-image.alt.txt'), 'Ghost Game: Boo, Shambles, Rattles and Scorch on a moonlit graveyard hill');
  }
  console.log('app icons + share card written to src/app/');
}

const PRIO = { p0: 0, p1: 1, p2: 2 } as const;

async function main() {
  const { only, prio, dry, flags } = parseArgs(process.argv.slice(2));
  if (flags.has('ship')) return shipAll();
  const all = loadManifest()
    .assets.filter((a) => a.generator === 'gemini' && selected(a, only, prio))
    .filter((a) => outputs(a).some((o) => !exists(o)))
    .sort((x, y) => PRIO[x.priority] - PRIO[y.priority]);
  console.log(`${all.length} images to generate`);
  if (dry) {
    for (const a of all) console.log(`   [${a.priority}] ${modelFor(a) === PRO ? 'PRO  ' : 'flash'} ${a.id} -> ${outputs(a)[0]}${needsKey(a) ? ' (keyed)' : ''}`);
    return;
  }
  let ok = 0;
  let failed = 0;
  const run = async (a: Asset) => {
    const t0 = Date.now();
    try {
      await generate(a);
      markStatus([a.id], 'generated');
      ok++;
      console.log(`   ✓ ${a.id} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.error(`   ✗ ${a.id}: ${String(e).slice(0, 300)}`);
      if (isFatal(e)) abort(`${a.id}: ${String(e).slice(0, 200)}`);
    }
  };
  // Anchors first (sequentially), then everything else in parallel.
  const anchors = ANCHORS.map((id) => all.find((a) => a.id === id)).filter((a): a is Asset => !!a);
  for (const a of anchors) await run(a);
  const rest = all.filter((a) => !ANCHORS.includes(a.id));
  if (!isAborted()) await pool(rest, 5, run);
  console.log(`\n${ok} generated, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

void main();
