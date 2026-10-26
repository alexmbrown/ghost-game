# Asset Pipeline

Every asset the game needs is catalogued in **[`assets/manifest.json`](../assets/manifest.json)** —
227 entries with generation-ready prompts, output paths, priorities and dependencies.
`npm run assets` prints what exists and what's missing, and fails if the manifest and the code
disagree (e.g. a sound id used in code with no manifest entry).

| Kind | Generator | Count | Lands in |
|------|-----------|------:|----------|
| `concept-image` — character/prop reference sheets (Meshy input) | Gemini | 45 | `assets/concepts/` (not shipped) |
| `model-character` — rigged + animated players | Meshy | 16 | `public/models/characters/` |
| `model-prop` — static environment props, portals, pickups | Meshy | 29 | `public/models/props/` |
| `texture` — tileable ground/walls, sky panoramas, VFX sprites | Gemini | 10 | `public/textures/` |
| `ui-image` — logo, key art, crests, ability/power icons, portraits, banners | Gemini | 43 | `public/ui/` |
| `music` — menu, lobby, per-map match loops, hurry-up, stingers | ElevenLabs | 8 | `public/audio/music/` |
| `ambience` — per-map night loops | ElevenLabs | 2 | `public/audio/amb/` |
| `sfx` — pickups, banking, steals, abilities, footsteps, UI | ElevenLabs | 34 | `public/audio/sfx`, `public/audio/ui` |
| `voice-design` — announcer + 4 character voices | ElevenLabs | 5 | `assets/voices/*.json` (voice ids) |
| `voice-line` — announcer calls + character barks | ElevenLabs | 35 | `public/audio/vo/` |

Priorities: **p0** = polished MVP (4 launch characters, core audio, HUD art), **p1** = AAA feel,
**p2** = the 12 future characters and extra dressing.

## How assets plug in (no code changes needed)

- **Audio** — ids in [`src/game/audio/sounds.ts`](../src/game/audio/sounds.ts) map to the manifest's
  output paths. Drop the files in, run `npm run assets:index` (rewrites `public/audio/index.json`),
  and the AudioManager plays them. Until then it plays procedural placeholder SFX.
  Music tracks loop seamlessly: the same command writes `public/audio/loops.json` (needs ffmpeg),
  the loop region after each track's intro and before any baked fade-out, picked so the rhythm lines
  up at the seam (`src/game/audio/loopPoints.ts`). Tracks missing from it are analysed in the browser.
- **Characters** — point the entry in [`src/game/r3f/creatureModels.ts`](../src/game/r3f/creatureModels.ts)
  at `public/models/characters/<id>.glb` and map clip names (`idle`, `run`, `cast`, `hit`, `victory`,
  `defeat`). The renderer already plays hit/cast one-shots and victory/defeat loops.
- **Props** — models load from `public/models/props/<name>.glb`. Add the model's bounding-box size
  to [`src/game/r3f/props/catalog.ts`](../src/game/r3f/props/catalog.ts) (the props test checks it
  against the file) and place it in [`props/layout.ts`](../src/game/r3f/props/layout.ts): obstacles
  are fitted to their collision boxes, decoration stays at the edges. Bright texels can glow
  (`glow` in the catalog).
- **Textures** — `public/textures/<name>.webp`, wired per map in
  [`mapThemes.ts`](../src/game/r3f/mapThemes.ts) (ground, wall texture, sky panorama) and in
  `Vfx.tsx` (sparkle, flame and smoke sprites).
- **UI** — files listed in `public/ui/index.json` replace the SVG icons/crests and fill the logo,
  key art, map cards, portraits, banners and awards; components fall back to SVG when one is missing.
- **Sizes** — Gemini renders at 2K+. The full-size image is kept in `assets/raw/` and `public/` gets
  a copy sized to its use (`npm run gen:images -- --ship` re-sizes them all and writes the favicon,
  Apple touch icon and share card into `src/app/`).

## Workflow (agreed order)

1. **Concept images first (Gemini).** Generate `concept.char.*` for the 4 p0 characters (3–4
   variations each) plus the p0 UI art. **Review and approve** before any 3D spend.
2. **Models (Meshy)** from approved concepts: image-to-3D → auto-rig → animations → compress.
3. **Audio (ElevenLabs)**: design the 5 voices (pick from previews), then lines, SFX, music.
4. Mark entries `generated` → `approved` → `integrated` in the manifest as they move along.

API keys go in `.env.local` (git-ignored), never in the repo:

```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
MESHY_API_KEY=...
```

## Style bible

The manifest's `styleGuide` string is prepended to every character and prop prompt so the whole
set is consistent: chunky, rounded, toy-like cartoon shapes; soft vinyl/clay materials; big
expressive eyes; friendly-spooky (never gory); deep indigo/violet night palette with glowing accents.

Other image kinds use their own prefix from `styles` (`texture`, `sky`, `vfx`, `cutout`, `ui`,
`scene`). The character guide talks about eyes and proportions, and when it was prepended to
textures and map thumbnails Gemini drew characters into them. Keep it out of non-character prompts.
Icons, crests, badges, banners, portraits and the corn card are drawn on a magenta key and cut out
to transparency. Never ask Gemini for a "transparent" background, because it paints a fake
checkerboard instead.

| Faction | Color | Launch character | Ability |
|---------|-------|------------------|---------|
| Ghosts | spectral cyan `#67e8f9` | Boo — floating bedsheet ghost | Phase Dash |
| Zombies | toxic lime `#a3e635` | Shambles — goofy patched-up zombie | Grave Grasp |
| Skeletons | bone gold `#fcd34d` | Rattles — lanky skeleton with a bow tie | Bone Toss |
| Demons | coral red `#f87171` | Scorch — chubby little imp | Hellfire Rush |

Neutral spirit flames are violet `#b48cff` (teardrops with dot eyes, like the Doodle's wisps).
Use the first approved concept image as a **style reference** for the rest (Gemini Pro accepts up
to 3 style references) to lock the look.

## Gotchas

- **Meshy rigging only accepts humanoid bipeds** (HTTP 422 "pose estimation failed" otherwise).
  That's why every character — including the ghosts — is designed with two legs and two arms.
  Fallback for a legless design: static mesh + the procedural float/bob already in `Creature.tsx`.
- Character concept images must be **one character, full body, front view, A-pose, plain
  background** — that's what image-to-3D reconstructs best. The prompts already say so.
- **Music has no native loop flag**: generate long, trim to a bar boundary, add a short crossfade.
- Meshy has no float/hover animation; flyers get the procedural bob on top of `idle`/`run`.
- Keep characters at ~12–20k triangles and compress (`gltf-transform optimize --compress meshopt
  --texture-compress webp`) — 16 players on screen.

## API reference (verified 2026-10-10)

### Gemini (images) — `x-goog-api-key`
- Model: **`gemini-3-pro-image`** (Nano Banana Pro) for concept art — supports style references;
  `gemini-nano-banana-2.1` is the cheaper workhorse. Imagen 4 is shut down.
- `POST https://generativelanguage.googleapis.com/v1beta/interactions`
  ```json
  { "model": "gemini-3-pro-image",
    "input": [{ "type": "text", "text": "<styleGuide> <prompt>" },
              { "type": "image", "mime_type": "image/png", "data": "<base64 style ref>" }],
    "response_format": { "type": "image", "aspect_ratio": "3:4", "image_size": "2K" } }
  ```
- Image bytes: last `{type:"image", data}` block in `steps[].content[]` of the `model_output`
  step (Gemini 3 may return interim "thought" images first — take the last). ~$0.13/image (2K).

### ElevenLabs (audio) — `xi-api-key`
- SFX: `POST /v1/sound-generation?output_format=mp3_44100_128`
  `{ text, duration_seconds (0.5–30), prompt_influence, loop }` → raw audio bytes.
- Music: `POST /v1/music` `{ prompt, music_length_ms, model_id: "music_v2_5", force_instrumental: true }`
  → raw audio bytes (paid plans).
- Voice design: `POST /v1/text-to-voice/design` `{ voice_description, model_id: "eleven_ttv_v3",
  auto_generate_text: true }` → previews; save one with `POST /v1/text-to-voice`
  `{ voice_name, voice_description, generated_voice_id }` → `voice_id`.
- Lines: `POST /v1/text-to-speech/{voice_id}` `{ text, model_id: "eleven_v4" }` — `[tags]` in the
  text are delivery directions (`[excited]`, `[giggles]`).

### Meshy (3D) — `Authorization: Bearer`
- `POST https://api.meshy.ai/openapi/v1/image-to-3d` `{ image_url: "data:image/png;base64,…",
  ai_model: "latest", pose_mode: "a-pose", should_remesh: true, target_polycount: 16000,
  enable_pbr: true, target_formats: ["glb"] }` → `{ result: taskId }`; poll
  `GET /openapi/v1/image-to-3d/{id}` until `SUCCEEDED`, then `model_urls.glb`. ~30 credits.
- Multi-view: `POST /openapi/v1/multi-image-to-3d` with 1–4 `image_urls` (front first).
- Rig: `POST /openapi/v1/rigging` `{ input_task_id, height_meters }` → rigged glb + free walk/run. 5 credits.
- Animate: `POST /openapi/v1/animations` `{ rig_task_id, action_ids: [...] }` (≤10, merged) → glb.
  3 credits/action. Browse ids: `GET /openapi/v1/animations/library`. The manifest lists suggested
  ids per clip — verify them against the library before running.
- Rate limits: 20 req/s; concurrent tasks 10 (Pro) – 100 (Ultra); failed tasks are refunded.
