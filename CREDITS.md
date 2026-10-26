# Credits & Asset Licenses

## Inspiration
Google's Halloween Doodle **The Great Ghoul Duel** (2018, 2022). Gameplay rules are re-implemented
from scratch; no Doodle assets are used.

## 3D Character Models
Generated for this project with **Meshy** (image-to-3D from our own Gemini concept art; Meshy
auto-rigging and animation library for the characters with legs). The ghosts' skeletons and clips
are authored in `scripts/gen/ghost-rig.ts`. See `assets/manifest.json` (`model.char.*`).

The earlier CC0 placeholders (Quaternius "Ultimate Monsters", https://quaternius.com) are kept in
`assets/raw/placeholder-models/` for reference and are no longer shipped.

## Fonts
**Creepster**, **Lilita One** and **Rubik** — Google Fonts (SIL Open Font License), self-hosted at
build time via `next/font`.

## Libraries
three.js, React Three Fiber, drei, postprocessing (MIT) · Trystero (MIT) · Next.js, React,
zustand (MIT).

## Everything else
Music, sound effects, ambience and voices are generated with **ElevenLabs**; concept art, UI art
and textures with **Gemini**; environment props with **Meshy** (`docs/ASSETS.md`). Torch flames,
fog, glows and the SVG fallback icons are procedural / hand-authored in this repo.
