# Ghost Game — Implementation Plan

Phased plan for the game described in [README.md](README.md). Status as of **2026-10-10**.

## Locked decisions
- Max players **16** (up to 4 teams × 4). Round length **1–3 min** (default 2).
- Online play is **room-code only** — no matchmaking or public lobbies.
- Topology: **star / host-authoritative**; clients predict their own movement and the host validates.
- Signaling: **Trystero over Nostr** (free, serverless). TURN: none by default; optional at build time.
- Deploy: **static export** to GitHub Pages (workflow included) or Cloudflare Pages.
- Assets: **Gemini** (images) → approve → **Meshy** (3D) ; **ElevenLabs** for all audio.
  Catalogued in `assets/manifest.json`.

---

## Phase 0–2 — Scaffolding, rendering, offline loop ✅
Next.js static export, R3F scene, third-person camera, kinematic movement + AABB collision,
the collect → trail → bank loop vs bots.

## Phase 3 — Lobby & presence ✅
Host/join by 6-character room code, invite links that only pre-fill the code, team picking
(host-validated, max 4/team), host settings (map, teams 2–4, bot fill, bot skill, round length),
pings, join/leave handling, version check, room-full rejection.

## Phase 4 — Authoritative netcode ✅
Host sim at 60 Hz, 20 Hz snapshots (flame list only when changed), client-side prediction of
movement/pickups/abilities with host validation (speed cap, walls, warp-on-correction), ~110 ms
entity interpolation with clock-offset estimation, Web-Worker sim clock so a backgrounded host
keeps the match alive, stale-event dropping when a tab resumes.
*Design note:* clients are authoritative over their *own position* within host-enforced limits
(classic for friends-only P2P); every scoring decision (pickups, steals, banking, hits) is host-side.

## Phase 5 — Factions, characters & abilities ✅ (MVP roster)
Data-driven characters + ability kits (`core/characters.ts`): Phase Dash, Grave Grasp, Bone Toss,
Hellfire Rush. Doodle rules: trail stealing, buddy bonus, enemy-base blocking, Mega-Flames, Magic
Pumpkin, per-player power unlocks (speed / magnet / phase). Balance checked with `npm run sim`.
- [ ] 3 more characters per faction (12 total; designs + prompts already in the asset manifest).

## Phase 6 — Combat & feel ✅
Projectile + area + dash + charge abilities, stagger/stun states, steal streams, particle VFX,
announcer/feedback event router, kill feed, popups, awards on the results screen.

## Phase 7 — Host migration ⬜
Today the match ends when the host leaves (clients get a clear message). Plan: backup peer mirrors
snapshots; deterministic successor election; new host rebuilds the engine from the last snapshot.

## Phase 8 — Maps, assets & polish 🟡
Done: 2 maps (Graveyard, Corn Maze) with themes, game-style UI (SVG icon set, 3D menu scene),
audio system with procedural placeholders, rim-lit characters, settings (audio/controls/graphics),
asset manifest + pipeline docs.
Remaining:
- [ ] Generate assets per [docs/ASSETS.md](docs/ASSETS.md): concept art first (needs approval),
      then Meshy characters/props, then ElevenLabs audio.
- [ ] Touch / gamepad controls.
- [ ] More maps from the Doodle (Mansion, Library, Museum).

## Phase 9 — Deploy & playtest 🟡
GitHub Pages workflow ready. Next: push to GitHub, enable Pages, playtest across real networks and
measure connection success (decide on an optional TURN relay from data).

---

## Testing
- `npm test` — engine rules (steals, buddy bonus, pumpkin, abilities, remote validation, full bot
  rounds on both maps, determinism) and lobby rules.
- `npm run sim` — bot-only balance report across maps and difficulties.
- Verified manually in two browser tabs: host/join by code, team switching, synchronized match,
  client prediction accepted by host without corrections, results, back-to-lobby, host-leave and
  client-leave paths.
