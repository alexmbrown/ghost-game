// Meshy generator for the 3D models in assets/manifest.json
// (model-character, model-prop).
//
//   npm run gen:models -- model.char.shambles model.prop.gravestone_round
//   npm run gen:models -- --balance          # credits left
//   npm run gen:models -- model.char --dry   # what would run, and its cost
//   npm run gen:models -- model.char.shambles --rebuild   # redo the local build step only
//   npm run gen:models -- model.char.boo --fresh   # new concept art: archive the old raw files, pay for a new model
//
// Pipeline, per model:
//   1. image-to-3d from the approved concept image with Meshy's newest model,
//      remeshed by Meshy to a low-poly `params.target_polycount` (30 credits).
//      Smart Topology (meshy-t2) was tried first: it kept small details such as
//      stitches and carved letters as spiky, broken geometry. With remeshing,
//      fine detail ends up in the texture instead.
//   2. characters with legs: rigging (5 credits), then ONE animation task with
//      every `animations[].meshyActionId` (3 credits each, max 10), which
//      Meshy returns as a single GLB with the clips in request order.
//      Ghosts float with no legs and Meshy can only rig bipeds, so they stop
//      after step 1 and get a local rig + clips instead (ghost-rig.ts).
//   3. build (local, free): rename the clips to the game's names (or rig the
//      ghost), WebP textures <= 1024 px, meshopt compression -> public/models/...
//
// Resumable: every Meshy task id is written to assets/raw/models/<slug>/meshy.json
// the moment it is accepted, so a crash or a re-run polls the existing task
// instead of paying for a new one. Task-creating POSTs are never retried
// blindly (a timed-out POST may still have been charged). If the mesh settings
// change (model version, polycount...), the old raw files move to
// assets/raw/models/_archive/ and the model is generated afresh.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

import { GHOST_CLIPS, type GhostArms, rigGhost } from './ghost-rig';
import { keepHandsOutOfHead } from './rig-fix';
import { abort, type Asset, exists, HttpError, key, loadManifest, markStatus, outputs, parseArgs, pool, request, ROOT, selected, sleep, writeOut } from './lib';

const API = 'https://api.meshy.ai/openapi/v1';
/** Newest Meshy model as of 2026-10-11 (released 2026-09-18; `latest` resolves to it). */
const MESH_MODEL = 'meshy-7.1';
const TEXTURE_SIZE = 1024;

interface Clip {
  name: string;
  meshyActionId: number | null;
  use?: string;
}

interface State {
  /** The image-to-3d settings meshTask was made with (see meshSettings()). */
  meshSettings?: string;
  meshTask?: string;
  rigTask?: string;
  animTask?: string;
  animActionIds?: number[];
  credits?: Record<string, number>;
}

// ---------- Meshy HTTP ----------

const auth = () => ({ Authorization: `Bearer ${key('MESHY_API_KEY')}`, 'Content-Type': 'application/json' });

async function get<T>(path: string): Promise<T> {
  const res = await request(`${API}/${path}`, { headers: auth() }, { timeoutMs: 60_000 });
  return (await res.json()) as T;
}

/** Create a task. Retries only on 429 (rejected, so nothing was charged). */
async function create(path: string, body: unknown): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request(`${API}/${path}`, { method: 'POST', headers: auth(), body: JSON.stringify(body) }, { retries: 0, timeoutMs: 120_000 });
      return ((await res.json()) as { result: string }).result;
    } catch (e) {
      if (e instanceof HttpError && e.status === 429 && attempt < 5) {
        await sleep(10_000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

interface Task {
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress?: number;
  task_error?: { message?: string };
  consumed_credits?: number;
  model_urls?: Record<string, string>;
  thumbnail_url?: string;
  result?: Record<string, unknown>;
}

async function poll(kind: string, id: string, label: string): Promise<Task> {
  let last = '';
  const t0 = Date.now();
  for (;;) {
    const t = await get<Task>(`${kind}/${id}`);
    const line = `${t.status} ${t.progress ?? 0}%`;
    if (line !== last) {
      console.log(`     ${label}: ${line} (${Math.round((Date.now() - t0) / 1000)}s)`);
      last = line;
    }
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${label} ${t.status}: ${t.task_error?.message ?? 'no reason given'}`);
    if (Date.now() - t0 > 30 * 60_000) throw new Error(`${label}: still ${t.status} after 30 min (task ${id} kept in meshy.json)`);
    await sleep(8000);
  }
}

async function download(url: string, rel: string, meta: Record<string, unknown>): Promise<void> {
  const res = await request(url, {}, { timeoutMs: 300_000 });
  writeOut(rel, Buffer.from(await res.arrayBuffer()), meta);
}

// ---------- per-model plan ----------

const slugOf = (a: Asset) => a.id.split('.').pop()!;
const rawDir = (a: Asset) => `assets/raw/models/${slugOf(a)}`;
const conceptOf = (a: Asset) => `assets/concepts/${a.kind === 'model-character' ? 'characters' : 'props'}/${slugOf(a)}.png`;
const params = (a: Asset) => (a.params ?? {}) as { target_polycount?: number; height_meters?: number; rig?: 'meshy' | 'ghost'; arms?: GhostArms | null };
const clips = (a: Asset) => ((a.animations as Clip[] | undefined) ?? []).filter((c) => c.meshyActionId != null);
/**
 * How a model gets its skeleton: Meshy rigs characters with legs; the legless
 * ghosts (`params.rig: "ghost"`) get the local rig from ghost-rig.ts; props have none.
 */
const rigMode = (a: Asset): 'meshy' | 'ghost' | 'none' => (a.kind !== 'model-character' ? 'none' : (params(a).rig ?? 'meshy'));
const rigged = (a: Asset) => rigMode(a) === 'meshy';

function loadState(a: Asset): State {
  const f = join(ROOT, rawDir(a), 'meshy.json');
  return exists(`${rawDir(a)}/meshy.json`) ? (JSON.parse(readFileSync(f, 'utf8')) as State) : {};
}
function saveState(a: Asset, s: State): void {
  writeFileSync(join(ROOT, rawDir(a), 'meshy.json'), JSON.stringify(s, null, 1) + '\n');
}

function cost(a: Asset): number {
  return 30 + (rigged(a) ? 5 + 3 * clips(a).length : 0);
}

/** image-to-3d request body, minus the image. */
function meshSettings(a: Asset): Record<string, unknown> {
  return {
    ai_model: MESH_MODEL,
    should_remesh: true,
    topology: 'triangle',
    target_polycount: params(a).target_polycount ?? (a.kind === 'model-character' ? 6000 : 1500),
    // Rigging wants a clean A-pose; floating ghosts and props have no pose.
    pose_mode: rigged(a) ? 'a-pose' : '',
    should_texture: true,
    enable_pbr: false,
    texture_resolution: '2k',
    target_formats: ['glb'],
  };
}

/** The concept image as a JPEG data URI (smaller upload; the backdrop is flat grey anyway). */
async function conceptDataUri(a: Asset): Promise<string> {
  const jpg = await sharp(join(ROOT, conceptOf(a))).resize(1536, 1536, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#d9d9d9' }).jpeg({ quality: 92 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

async function generate(a: Asset): Promise<void> {
  const dir = rawDir(a);
  mkdirSync(join(ROOT, dir), { recursive: true });
  let s = loadState(a);
  const p = params(a);
  const settings = meshSettings(a);
  const key = JSON.stringify(settings);
  if (s.meshTask && s.meshSettings !== key) {
    // Made with other settings: keep those files for comparison, start over.
    const to = `assets/raw/models/_archive/${slugOf(a)}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    mkdirSync(join(ROOT, 'assets/raw/models/_archive'), { recursive: true });
    renameSync(join(ROOT, dir), join(ROOT, to));
    console.log(`     ${slugOf(a)} mesh settings changed: previous files moved to ${to}`);
    mkdirSync(join(ROOT, dir), { recursive: true });
    s = {};
  }
  const credits = (s.credits ??= {});

  // 1. mesh
  if (!exists(`${dir}/mesh.glb`)) {
    if (!s.meshTask) {
      s.meshTask = await create('image-to-3d', { image_url: await conceptDataUri(a), ...settings });
      s.meshSettings = key;
      saveState(a, s);
    }
    const t = await poll('image-to-3d', s.meshTask, `${slugOf(a)} mesh`);
    credits.mesh = t.consumed_credits ?? 0;
    saveState(a, s);
    if (!t.model_urls?.glb) throw new Error('mesh task returned no GLB');
    await download(t.model_urls.glb, `${dir}/mesh.glb`, { id: a.id, meshyTask: s.meshTask, step: 'image-to-3d' });
    if (t.thumbnail_url) await download(t.thumbnail_url, `${dir}/thumbnail.png`, { id: a.id, meshyTask: s.meshTask });
  }
  if (!rigged(a)) return;

  // 2a. rig
  if (!exists(`${dir}/rigged.glb`)) {
    if (!s.rigTask) {
      s.rigTask = await create('rigging', { input_task_id: s.meshTask, height_meters: p.height_meters ?? 1.4 });
      saveState(a, s);
    }
    const t = await poll('rigging', s.rigTask, `${slugOf(a)} rig`);
    credits.rig = t.consumed_credits ?? 0;
    saveState(a, s);
    const url = t.result?.rigged_character_glb_url as string | undefined;
    if (!url) throw new Error('rig task returned no GLB');
    await download(url, `${dir}/rigged.glb`, { id: a.id, meshyTask: s.rigTask, step: 'rigging' });
  }

  // 2b. animations (one merged GLB, clips in request order)
  const ids = clips(a).map((c) => c.meshyActionId as number);
  if (ids.length > 10) throw new Error(`${ids.length} clips: Meshy merges at most 10 per task`);
  const sameSet = s.animActionIds && s.animActionIds.join() === ids.join();
  if (!exists(`${dir}/animations.glb`) || !sameSet) {
    if (!s.animTask || !sameSet) {
      s.animTask = await create('animations', { rig_task_id: s.rigTask, action_ids: ids });
      s.animActionIds = ids;
      saveState(a, s);
    }
    const t = await poll('animations', s.animTask, `${slugOf(a)} animations (${ids.length} clips)`);
    credits.animations = t.consumed_credits ?? 0;
    saveState(a, s);
    const url = t.result?.animation_glb_url as string | undefined;
    if (!url) throw new Error('animation task returned no GLB');
    await download(url, `${dir}/animations.glb`, { id: a.id, meshyTask: s.animTask, step: 'animations', actionIds: ids });
  }
}

// ---------- local build ----------

async function io(): Promise<NodeIO> {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

function stats(doc: Document): { tris: number; clips: string[]; height: number } {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0)) / 3;
    }
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const acc of doc.getRoot().listAccessors()) {
    // POSITION accessors carry min/max; good enough for a size report.
    if (acc.getType() !== 'VEC3' || acc.getCount() < 50) continue;
    const mn = acc.getMin([]);
    const mx = acc.getMax([]);
    if (mn.length === 3 && mx.length === 3) {
      minY = Math.min(minY, mn[1]);
      maxY = Math.max(maxY, mx[1]);
    }
  }
  return { tris: Math.round(tris), clips: doc.getRoot().listAnimations().map((x) => x.getName()), height: maxY - minY };
}

async function build(a: Asset): Promise<void> {
  const dir = rawDir(a);
  const src = rigged(a) ? `${dir}/animations.glb` : `${dir}/mesh.glb`;
  const nio = await io();
  const doc = await nio.read(join(ROOT, src));
  const before = stats(doc);

  if (rigged(a)) {
    const names = clips(a).map((c) => c.name);
    const anims = doc.getRoot().listAnimations();
    if (anims.length !== names.length) {
      throw new Error(`expected ${names.length} clips, the GLB has ${anims.length}: ${anims.map((x) => x.getName()).join(', ')}`);
    }
    anims.forEach((anim, i) => anim.setName(names[i]));
    const fix = keepHandsOutOfHead(doc);
    if (fix) console.log(`     ${slugOf(a)} hands kept out of head: ${fix.framesFixed} keys in ${fix.clips} clips (up to ${fix.maxDegrees.toFixed(0)}°)`);
  } else if (rigMode(a) === 'ghost') {
    const r = rigGhost(doc, params(a).height_meters ?? 1.4, params(a).arms ?? null);
    console.log(`     ${slugOf(a)} ghost rig: ${r.vertices} vertices, ${(r.armShare * 100).toFixed(0)}% arm, ${(r.hemShare * 100).toFixed(0)}% hem (arm vertices L ${r.armVerts.L} / R ${r.armVerts.R}), clips [${GHOST_CLIPS.map((c) => c.name).join(', ')}]`);
  }

  await doc.transform(
    dedup(),
    prune(),
    resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE], quality: 88 }),
  );
  const out = outputs(a)[0];
  // An uncompressed copy for viewers without a meshopt decoder (asset review page).
  writeOut(`${dir}/preview.glb`, await nio.writeBinary(doc), { id: a.id, note: 'build output before meshopt, for previews' });
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const bin = await nio.writeBinary(doc);
  const after = stats(doc);
  writeOut(out, bin, { id: a.id, source: src, triangles: after.tris, clips: after.clips, meshy: loadState(a) });
  console.log(`     ${slugOf(a)} build: ${before.tris} tris, ${after.clips.length ? `clips [${after.clips.join(', ')}], ` : ''}height ${before.height.toFixed(2)} -> ${out} (${Math.round(bin.byteLength / 1024)} KB)`);
}

// ---------- main ----------

async function main() {
  const argv = process.argv.slice(2);
  const { only, prio, dry, flags } = parseArgs(argv);
  if (flags.has('balance')) {
    console.log(await get<{ balance: number }>('balance'));
    return;
  }
  if (!only.length) {
    console.error('Name the models to generate (e.g. model.char.shambles): Meshy costs credits, so there is no "everything" default.');
    process.exitCode = 1;
    return;
  }
  // Highest priority first, so if credits run out the models that matter most exist.
  const PRIO = { p0: 0, p1: 1, p2: 2 } as const;
  const todo = loadManifest()
    .assets.filter((a) => a.generator === 'meshy' && selected(a, only, prio))
    .sort((x, y) => PRIO[x.priority] - PRIO[y.priority]);
  const rebuild = flags.has('rebuild');
  const fresh = flags.has('fresh');
  const upToDate = (a: Asset) => exists(outputs(a)[0]) && loadState(a).meshSettings === JSON.stringify(meshSettings(a));
  const total = rebuild ? 0 : todo.reduce((n, a) => n + (upToDate(a) && !fresh ? 0 : cost(a)), 0);
  console.log(`${todo.length} model(s), up to ${total} credits${dry ? ' (dry run)' : ''}`);
  for (const a of todo) {
    const c = clips(a);
    const plan = { meshy: `Meshy rig + ${c.length} clips [${c.map((x) => x.name).join(', ')}]`, ghost: `ghost rig + ${GHOST_CLIPS.length} clips (local)`, none: 'static' }[rigMode(a)];
    console.log(`   ${a.id}: ${params(a).target_polycount ?? '?'} tris, ${plan} -> ${outputs(a)[0]}`);
  }
  if (dry) return;
  if (!rebuild) console.log(`   balance before: ${(await get<{ balance: number }>('balance')).balance}`);

  let failed = 0;
  // Three at a time: each model is mostly waiting on Meshy. Log lines carry the slug.
  await pool(todo, 3, async (a) => {
    if (!exists(conceptOf(a))) {
      console.error(`   ✗ ${a.id}: concept image missing (${conceptOf(a)})`);
      failed++;
      return;
    }
    if (fresh && exists(`${rawDir(a)}/meshy.json`)) {
      const to = `assets/raw/models/_archive/${slugOf(a)}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      mkdirSync(join(ROOT, 'assets/raw/models/_archive'), { recursive: true });
      renameSync(join(ROOT, rawDir(a)), join(ROOT, to));
      console.log(`     ${slugOf(a)}: previous files moved to ${to}`);
    }
    if (!rebuild && !fresh && upToDate(a)) {
      console.log(`   = ${a.id}: up to date`);
      return;
    }
    try {
      console.log(`   > ${a.id}`);
      if (!rebuild || !exists(rigged(a) ? `${rawDir(a)}/animations.glb` : `${rawDir(a)}/mesh.glb`)) await generate(a);
      await build(a);
      markStatus([a.id], 'generated');
      console.log(`   ✓ ${a.id}`);
    } catch (e) {
      failed++;
      console.error(`   ✗ ${a.id}: ${String(e).slice(0, 400)}`);
      if (e instanceof HttpError && (e.status === 401 || e.status === 402)) abort(`${a.id}: ${e.status}`);
    }
  });
  if (!rebuild) console.log(`\n   balance after: ${(await get<{ balance: number }>('balance')).balance}`);
  process.exitCode = failed ? 1 : 0;
}

void main();
