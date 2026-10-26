# Ghost Game — The Ghoul Duel

A 3D, browser-based party game inspired by Google's Halloween Doodle
**[The Great Ghoul Duel](https://doodles.google/doodle/halloween-2022/)**, rebuilt in 3D with four
factions, hero abilities, and **peer-to-peer online play by room code** — hosted for free as a
static site, with no game servers.

**▶ Play it: [alexmbrown.github.io/ghost-game](https://alexmbrown.github.io/ghost-game/)** — Quick Play
against bots, or host a room and send the 6-letter code to friends.

## How it plays

1. **Collect** spirit flames — they trail behind you like a snake.
2. **Bank** them at your team's glowing portal. Rivals can't enter your base.
3. **Steal**: touch a rival's trail to take that flame *and every flame behind it* (thieves get a
   speed burst) — the Doodle's core rule.
4. **Buddy Bonus**: touch a teammate's trail for +3 flames each.
5. **Mega-Flames** run away from you — corner one for 10. The **Magic Pumpkin** makes you
   unstealable for 9s and stuns any rival you ram.
6. Banking unlocks per-player **powers**: Speed (10), Magnet (25), Phase-through-walls (50).
7. After 2 minutes (configurable) the team with the most banked flames wins. The last 20 seconds
   switch to "hurry up" music.

| Faction | Launch character | Ability |
|---------|------------------|---------|
| Ghosts | Boo | **Phase Dash** — burst forward through walls, untouchable while phasing |
| Zombies | Shambles | **Grave Grasp** — a field of grabbing hands that slows rivals |
| Skeletons | Rattles | **Bone Toss** — a projectile that knocks a rival's flames loose |
| Demons | Scorch | **Hellfire Rush** — a flaming charge; body-slam rivals to scatter their flames |

**Maps:** Moonlit Graveyard and Corn Maze. **Modes:** offline vs bots (easy/normal/hard, solo to
4v4) or online with friends (up to 16 players, 2–4 teams, optional bot fill).

**Controls:** WASD move (camera-relative) · click to capture the mouse and aim · Space / click =
ability · Tab = scoreboard · Esc = pause (offline) / free the mouse.

## Multiplayer: room codes, peer-to-peer, free

- **Host a Room** → you get a 6-character code (e.g. `GFU WZB`). Friends enter it under **Join**.
  There is deliberately **no matchmaking or public room list** — only people with the code join.
  Invite links (`?room=CODE`) just pre-fill the code.
- **Signaling** (finding each other) uses [Trystero](https://github.com/dmotz/trystero) over
  public Nostr relays — free, nothing for us to run. The room code doubles as the signaling
  encryption password. After that, all game traffic is **direct WebRTC, end-to-end encrypted**.
- **Netcode:** host-authoritative star topology. The host runs the simulation at 60 Hz and sends
  20 Hz snapshots; clients predict their own movement, pickups and abilities instantly and report
  positions at 30 Hz; the host validates them (speed limits, walls, warp-on-correction). Remote
  players are interpolated ~110 ms in the past for smoothness. The host simulation runs from a
  Web Worker clock, so the match keeps going if the host tabs out.
- **Known limits:** if the host leaves, the match ends (host migration is on the roadmap). Players
  on very strict NATs may fail to connect without a TURN relay — you can add one at build time via
  `NEXT_PUBLIC_TURN_*` (see `.env.example`); by default the game stays 100% serverless.

## Hosting it for free

It's a static site (`npm run build` → `./out`), so any static host works:

- **GitHub Pages** — push to GitHub, then Settings → Pages → Source: *GitHub Actions*. The included
  workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) tests, builds and
  deploys on every push to `main`. For a custom domain or a `<user>.github.io` repo, add the repo
  variable `BASE_PATH` = `/`.
- **Cloudflare Pages** — connect the repo; build command `npm run build`, output directory `out`,
  environment variable `NODE_VERSION=22`.

## Assets

All 16 characters are low-poly, animated Meshy models (`npm run gen:models`), and all 16 are
playable: pick one from your faction in Quick Play or in your lobby banner. The 44 environment props
are Meshy models too, fitted to each map's collision boxes by
[`src/game/r3f/props/layout.ts`](src/game/r3f/props/layout.ts). Music, SFX, ambience and voices
come from ElevenLabs; concept art, UI art (logo, key art, portraits, crests, icons, map cards,
banners, favicon and share card) and textures (ground, walls, sky panoramas, VFX sprites) from
Gemini. **Every asset is catalogued** with a generation-ready prompt
and status in [`assets/manifest.json`](assets/manifest.json). See **[docs/ASSETS.md](docs/ASSETS.md)** for the
pipeline, style bible and verified API notes. Generated files drop in without code changes
(`npm run assets` reports progress; `npm run assets:index` registers new audio/UI files;
`npm run gen:images -- --ship` re-sizes the shipped images from their full-size masters).

## Development

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # engine + lobby unit tests (node:test via tsx)
npm run sim          # headless bot-vs-bot balance report
npm run lint
npm run typecheck
npm run build        # static export to ./out
npm run assets       # asset manifest status + code consistency check
```

Requires Node 20.9+ (22 recommended).

### Code layout

```
src/
  app/                 Next.js shell (layout, fonts, global styles)
  components/          GameApp (screen router), MainMenu, Lobby
  game/
    core/              rendering-independent simulation: engine, rules, bots, maps,
                       characters/abilities, shared movement/collision (+ tests)
    net/               protocol, Trystero transport, lobby rules, OnlineGame (host/client)
    session/           HostSession (offline + online host), ClientSession (prediction +
                       interpolation), worker ticker, event router (audio/VFX/feed)
    r3f/               three.js rendering: GameWorld loop + camera, Creature, Flames, Specials,
                       Vfx, Arena, Scenery, map themes, MenuScene
    hud/               HUD, results, settings
    ui/                SVG icon set + crests (swappable for generated art)
    audio/             AudioManager, sound registry, procedural placeholder SFX
    state/             zustand store
assets/manifest.json   every asset to generate, with prompts
docs/ASSETS.md         asset pipeline + API reference
scripts/               botsim (balance), assets (status/index)
```

See **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** for the roadmap.
