// ElevenLabs audio generator for every audio asset in assets/manifest.json.
//
//   npm run gen:audio                      # everything missing
//   npm run gen:audio -- sfx ambience      # by kind (sfx|ambience|music|voice-design|voice-line)
//   npm run gen:audio -- music.menu        # by id prefix
//   npm run gen:audio -- --prio=p0         # by priority
//   npm run gen:audio -- --dry             # list what would be generated
//
// Order: SFX/ambience (fast) → voices → voice lines → music (slow).
// Voice design saves every preview to assets/voices/previews/ and keeps the
// first one; swap by editing assets/voices/<name>.json and re-running lines.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
} from './lib';

const API = 'https://api.elevenlabs.io';
const FORMAT = 'mp3_44100_128';

// Appended to every SFX prompt: these models add a named quality far better
// than they withhold an unnamed one.
const SFX_COMMON = 'Clean, dry, close-mic cartoon video game sound effect. No background music, no speech, no voice.';
// Ambience must NOT get the close-mic SFX wording: it made room tones sound
// muffled ("underwater") and turned soft details into close-up crackles.
const AMB_COMMON = 'Wide, airy, natural ambience recording of the whole space, soft and even, no sudden loud sounds. No music, no speech, no voice.';

const headers = () => ({ 'xi-api-key': key('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json' });

async function post(path: string, body: unknown, timeoutMs = 180_000): Promise<Response> {
  return request(`${API}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) }, { timeoutMs });
}

async function sfx(a: Asset): Promise<string[]> {
  const p = (a.params ?? {}) as { duration_seconds?: number; prompt_influence?: number; loop?: boolean };
  const done: string[] = [];
  for (const out of outputs(a)) {
    if (exists(out) || isAborted()) continue;
    const body: Record<string, unknown> = {
      text: `${a.prompt.replace(/[.!?]?$/, ".")} ${a.kind === 'ambience' ? AMB_COMMON : SFX_COMMON}`,
      prompt_influence: p.prompt_influence ?? 0.45,
      model_id: 'eleven_text_to_sound_v2',
    };
    if (p.duration_seconds) body.duration_seconds = Math.max(0.5, Math.min(30, p.duration_seconds));
    if (p.loop) body.loop = true;
    const res = await post(`/v1/sound-generation?output_format=${FORMAT}`, body);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1024) throw new Error(`suspiciously small response (${buf.byteLength} bytes)`);
    writeOut(out, buf, { id: a.id, model: 'eleven_text_to_sound_v2', request: body });
    done.push(out);
  }
  return done;
}

async function music(a: Asset): Promise<string[]> {
  const out = outputs(a)[0];
  if (exists(out)) return [];
  const p = (a.params ?? {}) as { music_length_ms?: number; model_id?: string; force_instrumental?: boolean };
  const body = {
    prompt: a.prompt,
    music_length_ms: Math.max(3000, Math.min(600_000, p.music_length_ms ?? 60_000)),
    model_id: p.model_id ?? 'music_v2_5',
    force_instrumental: p.force_instrumental ?? true,
  };
  const res = await post(`/v1/music?output_format=${FORMAT}`, body, 900_000);
  const buf = Buffer.from(await res.arrayBuffer());
  writeOut(out, buf, { id: a.id, request: body, songId: res.headers.get('song-id') });
  return [out];
}

// --- voices ---------------------------------------------------------------------

/** Premade ElevenLabs voices used if designing/saving a custom voice isn't permitted. */
const FALLBACK_VOICES: Record<string, string> = {
  announcer: 'pNInz6obpgDQGcFmaJgB', // Adam
  boo: 'jBpfuIE2acCO8z3wKNLl', // Gigi
  shambles: 'TxGEqnHWrfWFTfGW9XjX', // Josh
  rattles: 'ErXwobaYiN019PkySvjV', // Antoni
  scorch: 'VR6AewLTigWG4xSOukaG', // Arnold
};

const voiceFile = (name: string) => join(ROOT, 'assets', 'voices', `${name}.json`);

async function designVoice(a: Asset): Promise<string[]> {
  const name = a.id.split('.')[1];
  const out = outputs(a)[0];
  if (exists(out)) return [];
  const design = {
    voice_description: a.prompt,
    model_id: 'eleven_ttv_v3',
    auto_generate_text: true,
  };
  let record: Record<string, unknown>;
  try {
    const res = await post('/v1/text-to-voice/design', design, 300_000);
    const j = (await res.json()) as { previews: { audio_base_64: string; generated_voice_id: string }[] };
    const dir = join(ROOT, 'assets', 'voices', 'previews');
    mkdirSync(dir, { recursive: true });
    j.previews.forEach((pv, i) => writeFileSync(join(dir, `${name}_${i + 1}.mp3`), Buffer.from(pv.audio_base_64, 'base64')));
    const pick = j.previews[0];
    const saved = await post('/v1/text-to-voice', {
      voice_name: `Ghost Game — ${name}`,
      voice_description: a.prompt,
      generated_voice_id: pick.generated_voice_id,
    });
    const sj = (await saved.json()) as { voice_id: string };
    record = { voice_id: sj.voice_id, source: 'voice-design', picked: 1, previews: j.previews.length, description: a.prompt };
  } catch (e) {
    if (isFatal(e) && !/voices_write|text_to_voice|permission/i.test(String(e))) throw e;
    // Designing or saving voices isn't allowed for this key: use a premade voice.
    console.warn(`   voice design unavailable for ${name} (${String(e).slice(0, 120)}); using a premade voice`);
    record = { voice_id: FALLBACK_VOICES[name], source: 'premade-fallback', description: a.prompt };
  }
  mkdirSync(join(ROOT, 'assets', 'voices'), { recursive: true });
  writeFileSync(voiceFile(name), JSON.stringify(record, null, 1) + '\n');
  return [out];
}

let ttsModel = 'eleven_v4';
async function line(a: Asset): Promise<string[]> {
  const out = outputs(a)[0];
  if (exists(out)) return [];
  const voice = String((a.params as { voice?: string } | undefined)?.voice ?? 'announcer');
  if (!existsSync(voiceFile(voice))) throw new Error(`voice ${voice} not designed yet`);
  const { voice_id } = JSON.parse(readFileSync(voiceFile(voice), 'utf-8')) as { voice_id: string };
  for (;;) {
    const body = { text: a.prompt, model_id: ttsModel };
    try {
      const res = await post(`/v1/text-to-speech/${voice_id}?output_format=${FORMAT}`, body);
      const buf = Buffer.from(await res.arrayBuffer());
      writeOut(out, buf, { id: a.id, voice, voice_id, request: body });
      return [out];
    } catch (e) {
      // Fall back through models if the newest isn't enabled on this account.
      const next = { eleven_v4: 'eleven_v3', eleven_v3: 'eleven_multilingual_v2' }[ttsModel];
      if (next && /model/i.test(String(e)) && !isFatal(e)) {
        console.warn(`   ${ttsModel} unavailable, falling back to ${next}`);
        ttsModel = next;
        continue;
      }
      throw e;
    }
  }
}

// --- run ---------------------------------------------------------------------------

const HANDLERS: Record<string, { fn: (a: Asset) => Promise<string[]>; concurrency: number }> = {
  sfx: { fn: sfx, concurrency: 4 },
  ambience: { fn: sfx, concurrency: 3 },
  'voice-design': { fn: designVoice, concurrency: 2 },
  'voice-line': { fn: line, concurrency: 4 },
  music: { fn: music, concurrency: 2 },
};
const ORDER = ['sfx', 'ambience', 'voice-design', 'voice-line', 'music'];
const PRIO = { p0: 0, p1: 1, p2: 2 } as const;

async function main() {
  const { only, prio, dry } = parseArgs(process.argv.slice(2));
  const all = loadManifest().assets.filter((a) => a.generator === 'elevenlabs' && selected(a, only, prio));
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (const kind of ORDER) {
    const todo = all
      .filter((a) => a.kind === kind)
      .filter((a) => {
        const missing = outputs(a).some((o) => !exists(o));
        if (!missing) skipped++;
        return missing;
      })
      .sort((x, y) => PRIO[x.priority] - PRIO[y.priority]);
    if (!todo.length) continue;
    console.log(`\n== ${kind}: ${todo.length} to generate`);
    if (dry) {
      for (const a of todo) console.log(`   [${a.priority}] ${a.id} -> ${outputs(a).join(', ')}`);
      continue;
    }
    const h = HANDLERS[kind];
    await pool(todo, h.concurrency, async (a) => {
      const t0 = Date.now();
      try {
        const made = await h.fn(a);
        if (outputs(a).every(exists)) markStatus([a.id], 'generated');
        if (made.length) {
          ok++;
          console.log(`   ✓ ${a.id} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        }
      } catch (e) {
        failed++;
        console.error(`   ✗ ${a.id}: ${String(e).slice(0, 300)}`);
        if (isFatal(e)) abort(`${a.id}: ${String(e).slice(0, 200)}`);
      }
    });
    if (isAborted()) break;
  }
  console.log(`\n${ok} generated, ${skipped} already present, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

void main();
