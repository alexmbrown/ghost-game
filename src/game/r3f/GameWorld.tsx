import { useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';

import { audio } from '@/game/audio/audio';
import type { SoundId } from '@/game/audio/sounds';
import * as C from '@/game/core/constants';
import { FACTIONS } from '@/game/core/factions';
import { clamp } from '@/game/core/math';
import { FX } from '@/game/core/movement';
import type { TeamId } from '@/game/core/types';
import type { MoveInput } from '@/game/input/useInput';
import { emitVfx } from '@/game/fx/bus';
import { routeEvents } from '@/game/session/eventRouter';
import type { GameSession, ViewState } from '@/game/session/types';
import { useAppStore, type HudState } from '@/game/state/store';
import { Arena } from './Arena';
import { Backdrop } from './Backdrop';
import { Creature } from './Creature';
import { Flames } from './Flames';
import { MapFx } from './fx/MapFx';
import { dressMap } from './mapAssets';
import { themeFor } from './mapThemes';
import { PostFX } from './PostFX';
import { Scenery } from './Scenery';
import { Specials } from './Specials';
import { Vfx } from './Vfx';

// Hero-shooter camera rig.
const CAM_DIST = 11;
const CAM_BASE_HEIGHT = 3.2;
const LOOK_HEIGHT = 1.5;
const MOUSE_SENS = 0.0025;
const PITCH_MIN = 0.08;
const PITCH_MAX = 1.0;
const STRIDE = 1.7;

const STEP_SOUND: Record<number, SoundId> = {
  0: 'sfx.step.ghost',
  1: 'sfx.step.zombie',
  2: 'sfx.step.skeleton',
  3: 'sfx.step.demon',
};
const COUNT_VO: Record<number, SoundId> = { 3: 'vo.three', 2: 'vo.two', 1: 'vo.one' };

interface Props {
  session: GameSession;
  move: RefObject<MoveInput>;
  tagLayer: RefObject<HTMLDivElement | null>;
  /** Called once the arena's models and textures are in the scene. */
  onReady?: () => void;
}

/**
 * Mounts only when its Suspense boundary has everything loaded, then warms
 * up: for one frame every hidden object (the Mega-Spirit, pumpkin, bones,
 * grasp hands, every particle look) is drawn through the real pipeline —
 * shadow map and post-processing included, which compile their own shader
 * variants — under the loading card, so nothing compiles mid-match and
 * freezes a frame. Then the scene is put back and the match is shown.
 */
function Ready({ onReady }: { onReady?: () => void }) {
  const scene = useThree((s) => s.scene);
  const stage = useRef<'warm' | 'restore' | 'done'>('warm');
  const restore = useRef<{ o: THREE.Object3D; count?: number }[]>([]);
  // Priority 0: after every game update (negative priorities), before the composer renders.
  useFrame(() => {
    if (stage.current === 'warm') {
      scene.traverse((o) => {
        if (!o.visible) {
          restore.current.push({ o });
          o.visible = true;
        }
        const m = o as THREE.InstancedMesh;
        if (m.isInstancedMesh && m.count === 0) {
          restore.current.push({ o, count: 0 });
          m.count = 1;
        }
      });
      stage.current = 'restore';
    } else if (stage.current === 'restore') {
      for (const r of restore.current) {
        if (r.count !== undefined) (r.o as THREE.InstancedMesh).count = r.count;
        else r.o.visible = false;
      }
      restore.current = [];
      stage.current = 'done';
      onReady?.();
    }
  }, 0);
  return null;
}

/**
 * Owns the per-frame render loop. Simulation/prediction is ticked separately
 * (session/ticker.ts) so the host keeps running in background tabs; here we
 * feed input, pull the interpolated view, and mutate visuals imperatively.
 */
export function GameWorld({ session, move, tagLayer, onReady }: Props) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const settings = useAppStore((s) => s.settings);
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const view = useRef<ViewState>(session.view);
  const players = session.view.players;
  const theme = themeFor(session.view.mapId);
  const high = settings.quality === 'high';
  const dressing = useMemo(
    () => dressMap(session.view.mapId, session.view.obstacles, session.view.arenaHalf, theme),
    [session.view.mapId, session.view.obstacles, session.view.arenaHalf, theme],
  );
  const propFires = useMemo(() => [...dressing.arena.fires, ...dressing.scenery.fires], [dressing]);

  const avatarRefs = useRef<(THREE.Group | null)[]>([]);
  const lookTarget = useRef(new THREE.Vector3(0, LOOK_HEIGHT, 0));
  const heroLight = useRef<THREE.PointLight>(null);
  const yaw = useRef(0);
  const pitch = useRef(0.42);
  const locked = useRef(false);
  const hudAcc = useRef(0);
  /**
   * How each avatar is turned, which isn't the sim's `heading`: for players that
   * is the camera's aim (where abilities fire), and using it made characters
   * strafe. Avatars turn toward where they're actually going, keep facing that
   * way when they stop, and swing to their aim for a moment when they cast.
   */
  const facings = useRef(new Map<string, { yaw: number; x: number; z: number; vx: number; vz: number; aimUntil: number }>());
  const hudSig = useRef('');
  const lastCount = useRef(-1);
  const lastPhase = useRef(session.view.phase);
  const strides = useRef(new Map<string, { x: number; z: number; acc: number }>());
  const fxAcc = useRef(0);
  const magnetAcc = useRef(0);
  const [outcome, setOutcome] = useState<{ winner: TeamId | null } | null>(null);

  // Dev-only debugging handle (stripped from production builds).
  const scene = useThree((s) => s.scene);
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__ghost = { session, scene, camera, gl, advance, store: useAppStore };
  }, [session, scene, camera, gl, advance]);

  // Start the camera behind the local player, facing the arena center.
  useEffect(() => {
    const me = session.view.players.find((p) => p.isLocal);
    yaw.current = (me?.heading ?? 0) - Math.PI;
    if (me) {
      camera.position.set(me.x + Math.sin(yaw.current) * 14, 9, me.z + Math.cos(yaw.current) * 14);
      lookTarget.current.set(me.x, LOOK_HEIGHT, me.z);
    }
  }, [session, camera]);

  // Music + ambience for this map; preload gameplay sounds.
  useEffect(() => {
    audio.playMusic(theme.music);
    audio.playAmbient(theme.ambience);
    audio.preload([
      'sfx.flame.pickup',
      'sfx.flame.bankSmall',
      'sfx.flame.bankBig',
      'sfx.steal.thief',
      'sfx.steal.victim',
      'sfx.countdown.tick',
      'sfx.countdown.go',
      'vo.three',
      'vo.two',
      'vo.one',
      'vo.go',
    ]);
  }, [theme]);

  // Pointer-lock mouse look; while locked, left click fires the ability.
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!locked.current) {
        if (view.current.phase !== 'ended') {
          const p = el.requestPointerLock?.() as unknown as Promise<void> | undefined;
          p?.catch?.(() => {});
        }
      } else {
        session.pressAbility();
      }
    };
    const onMove = (e: MouseEvent) => {
      if (!locked.current) return;
      const s = settingsRef.current;
      const k = MOUSE_SENS * s.sensitivity;
      yaw.current -= e.movementX * k;
      pitch.current = clamp(pitch.current + e.movementY * k * (s.invertY ? -1 : 1), PITCH_MIN, PITCH_MAX);
    };
    const onLockChange = () => {
      locked.current = document.pointerLockElement === el;
    };
    el.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      el.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [gl, session]);

  // Floating name tags (DOM overlay, positioned imperatively each frame).
  const tags = useRef(new Map<string, { el: HTMLDivElement; name: HTMLSpanElement; carry: HTMLSpanElement; last: string }>());
  useEffect(() => {
    const layer = tagLayer.current;
    if (!layer) return;
    const map = tags.current;
    for (const p of session.view.players) {
      if (p.isLocal) continue;
      const el = document.createElement('div');
      el.className = 'nametag';
      el.style.setProperty('--team', FACTIONS[p.team].color);
      const name = document.createElement('span');
      name.className = 'nametag-name';
      name.textContent = p.name;
      const carry = document.createElement('span');
      carry.className = 'nametag-carry';
      if (p.isBot) {
        const bot = document.createElement('span');
        bot.className = 'nametag-bot';
        bot.textContent = 'BOT';
        el.append(bot);
      }
      el.append(name, carry);
      layer.appendChild(el);
      map.set(p.id, { el, name, carry, last: '' });
    }
    return () => {
      for (const t of map.values()) t.el.remove();
      map.clear();
    };
  }, [session, tagLayer]);

  const projected = useMemo(() => new THREE.Vector3(), []);

  useFrame((rs, delta) => {
    const now = performance.now();
    const dt = Math.min(delta, 0.1);
    const v = view.current;

    // Auto-orbit the camera on the results screen.
    if (v.phase === 'ended' && !locked.current) yaw.current += dt * 0.18;

    // 1. Camera-relative movement input.
    const raw = move.current ?? { x: 0, y: 0 };
    const yw = yaw.current;
    const cy = Math.cos(yw);
    const sy = Math.sin(yw);
    const wx = raw.x * cy - raw.y * sy;
    const wz = -raw.x * sy - raw.y * cy;
    session.setInput({ x: wx, z: wz, aim: yw + Math.PI });

    // 2. Interpolated view + events.
    session.updateView(now);
    const events = session.drainEvents();
    for (const ev of events) {
      // Casting: face the aim (a Bone Toss flies where you look) for a moment.
      if (ev.type === 'ability') {
        const f = facings.current.get(ev.player);
        if (f) f.aimUntil = now + 450;
      }
    }
    routeEvents(events, v);

    // 3. Countdown cues + phase transitions.
    if (v.phase === 'countdown') {
      const n = Math.ceil(v.countdown);
      if (n !== lastCount.current && n >= 1 && n <= 3) {
        lastCount.current = n;
        useAppStore.getState().announce(String(n), 'count');
        audio.play('sfx.countdown.tick');
        audio.say(COUNT_VO[n]);
      }
    }
    if (v.phase !== lastPhase.current) {
      lastPhase.current = v.phase;
      if (v.phase === 'ended') {
        setOutcome({ winner: v.winner });
        if (document.pointerLockElement) document.exitPointerLock();
      }
      hudAcc.current = 1; // push HUD now
    }

    // 4. Avatars: placed at their view positions, turned toward their movement.
    const turnK = 1 - Math.exp(-dt * 12);
    const velK = 1 - Math.exp(-dt * 10);
    for (let i = 0; i < v.players.length; i++) {
      const p = v.players[i];
      const g = avatarRefs.current[i];
      if (!g) continue;
      g.visible = !p.left && (p.flags & FX.STUN) === 0;
      g.position.set(p.x, 0, p.z);
      let f = facings.current.get(p.id);
      if (!f) {
        f = { yaw: p.heading, x: p.x, z: p.z, vx: 0, vz: 0, aimUntil: 0 };
        facings.current.set(p.id, f);
      }
      const dx = p.x - f.x;
      const dz = p.z - f.z;
      f.x = p.x;
      f.z = p.z;
      if (dt > 0 && Math.hypot(dx, dz) < 3) {
        // Smoothed velocity, so interpolation noise can't twitch the facing (teleports ignored).
        f.vx += (dx / dt - f.vx) * velK;
        f.vz += (dz / dt - f.vz) * velK;
      }
      let target = f.yaw;
      if (now < f.aimUntil) target = p.heading;
      else if (p.moving && Math.hypot(f.vx, f.vz) > 1) target = Math.atan2(f.vx, f.vz);
      // Turn the short way round.
      f.yaw += Math.atan2(Math.sin(target - f.yaw), Math.cos(target - f.yaw)) * turnK;
      g.rotation.y = f.yaw;
    }

    // 5. Third-person follow camera.
    const local = v.players.find((p) => p.isLocal);
    if (local) {
      const cam = rs.camera;
      const horiz = CAM_DIST * Math.cos(pitch.current);
      const vert = CAM_DIST * Math.sin(pitch.current);
      // The camera rides above the 3-unit perimeter walls, so it may look in from
      // outside them; clamping it inside made it collapse onto the player at walls.
      const bound = v.arenaHalf + 8;
      const tx = clamp(local.x + Math.sin(yw) * horiz, -bound, bound);
      const tz = clamp(local.z + Math.cos(yw) * horiz, -bound, bound);
      const ty = CAM_BASE_HEIGHT + vert;
      const k = 1 - Math.exp(-dt * 14);
      cam.position.x += (tx - cam.position.x) * k;
      cam.position.y += (ty - cam.position.y) * k;
      cam.position.z += (tz - cam.position.z) * k;
      const kl = 1 - Math.exp(-dt * 18);
      lookTarget.current.x += (local.x - lookTarget.current.x) * kl;
      lookTarget.current.y += (LOOK_HEIGHT - lookTarget.current.y) * kl;
      lookTarget.current.z += (local.z - lookTarget.current.z) * kl;
      cam.lookAt(lookTarget.current);

      if (heroLight.current) {
        heroLight.current.position.set(local.x + Math.sin(yw) * 2.5, 4, local.z + Math.cos(yw) * 2.5);
      }
      audio.setListener(local.x, local.z, yw);
    }

    // 6. Footsteps for nearby moving characters.
    if (local && v.phase === 'playing') {
      for (const p of v.players) {
        let s = strides.current.get(p.id);
        if (!s) {
          s = { x: p.x, z: p.z, acc: 0 };
          strides.current.set(p.id, s);
        }
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        s.x = p.x;
        s.z = p.z;
        if (!p.moving || d > 3) continue;
        s.acc += d;
        if (s.acc >= STRIDE) {
          s.acc = 0;
          if (Math.hypot(p.x - local.x, p.z - local.z) < 22) {
            audio.play(STEP_SOUND[p.team], { x: p.x, z: p.z, volume: p.isLocal ? 0.8 : 1 });
          }
        }
      }
    }

    // 6b. Effect trails: phasing wisps, hellfire embers, thief streaks, pumpkin
    // rainbow, speed sparks, slow-field wisps, Mega-Spirit sparkles, magnet pull.
    fxAcc.current += dt;
    magnetAcc.current += dt;
    if (fxAcc.current >= 0.05 && v.phase !== 'countdown') {
      fxAcc.current = 0;
      const t = rs.clock.elapsedTime;
      for (const p of v.players) {
        const f = p.flags;
        if (p.left || f & FX.STUN) continue;
        if (f & FX.DASH) emitVfx({ kind: 'trail', x: p.x, z: p.z, color: '#a5f3fc', count: 4, y: 1, spread: 0.9, rise: 0.15, size: 0.9 });
        if (f & FX.RUSH) emitVfx({ kind: 'trail', x: p.x, z: p.z, color: '#ff6a1a', count: 3, y: 0.7, spread: 1.1, rise: 2.4, size: 0.7, look: 'flame' });
        if (f & FX.BURST && p.moving) emitVfx({ kind: 'trail', x: p.x, z: p.z, color: '#8f88a8', count: 2, y: 0.4, spread: 0.7, rise: 0.3, size: 0.6, look: 'smoke' });
        if (f & FX.PUMPKIN) {
          const hue = `hsl(${Math.round((t * 140) % 360)}, 100%, 62%)`;
          emitVfx({ kind: 'trail', x: p.x, z: p.z, color: hue, count: 2, y: 1.1, spread: 1.4, rise: 1.2, size: 0.5 });
        }
        if (f & FX.SLOWED) emitVfx({ kind: 'trail', x: p.x, z: p.z, color: '#5f8a1e', count: 1, y: 0.3, spread: 0.8, rise: 1, size: 0.55, look: 'smoke' });
        if (f & FX.SPEED && p.moving && Math.random() < 0.35) {
          emitVfx({ kind: 'trail', x: p.x, z: p.z, color: '#ffd166', count: 1, y: 0.2, spread: 0.5, rise: 0.4, size: 0.35 });
        }
      }
      for (const m of v.megas) emitVfx({ kind: 'trail', x: m.x, z: m.z, color: '#e9dcff', count: 2, y: 1.1, spread: 1.8, rise: 0.6, size: 0.45 });
    }
    if (magnetAcc.current >= 0.14 && v.phase === 'playing') {
      magnetAcc.current = 0;
      for (const p of v.players) {
        if (p.left || !(p.flags & FX.MAGNET) || p.flags & FX.STUN) continue;
        const a = Math.random() * Math.PI * 2;
        const r = C.MAGNET_PULL_RADIUS * (0.6 + Math.random() * 0.4);
        emitVfx({ kind: 'stream', fromX: p.x + Math.cos(a) * r, fromZ: p.z + Math.sin(a) * r, toX: p.x, toZ: p.z, color: '#c4a7ff', count: 2, y: 0.4 });
      }
    }

    // 7. Name tags.
    const w = gl.domElement.clientWidth;
    const h = gl.domElement.clientHeight;
    for (const p of v.players) {
      const tag = tags.current.get(p.id);
      if (!tag) continue;
      const hidden = p.left || (p.flags & FX.STUN) !== 0;
      projected.set(p.x, 2.75, p.z).project(rs.camera);
      const off = hidden || projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2;
      if (off) {
        if (tag.el.style.display !== 'none') tag.el.style.display = 'none';
        continue;
      }
      if (tag.el.style.display === 'none') tag.el.style.display = '';
      const sx = (projected.x * 0.5 + 0.5) * w;
      const sy = (-projected.y * 0.5 + 0.5) * h;
      const dist = Math.hypot(p.x - (local?.x ?? 0), p.z - (local?.z ?? 0));
      const scale = clamp(1.25 - dist / 45, 0.6, 1.1);
      tag.el.style.transform = `translate(-50%, -100%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(${scale.toFixed(2)})`;
      const carry = p.carrying > 0 ? String(p.carrying) : '';
      if (carry !== tag.last) {
        tag.last = carry;
        tag.carry.textContent = carry;
        tag.el.classList.toggle('nametag--loaded', p.carrying >= 10);
      }
    }

    // 8. Throttled HUD sync (~10 Hz), and only when something it shows changed
    // (whole seconds on the clock, the cooldown ring at 0.05 steps): a React
    // re-render of the HUD every tick was steady main-thread work for nothing.
    hudAcc.current += delta;
    if (hudAcc.current >= 0.1 && local) {
      hudAcc.current = 0;
      const sig = [
        v.phase,
        Math.ceil(v.countdown),
        Math.ceil(v.timeRemaining),
        v.scores[0],
        v.scores[1],
        v.scores[2],
        v.scores[3],
        v.winner,
        local.carrying,
        local.flags,
        local.bankedTotal,
        Math.ceil(local.abilityCooldown * 20),
        local.team,
        local.character,
        v.bases.reduce((n, b) => n + (b.active ? 1 << b.team : 0), 0),
      ].join('|');
      if (sig === hudSig.current) return;
      hudSig.current = sig;
      const hud: HudState = {
        phase: v.phase,
        countdown: v.countdown,
        timeRemaining: v.timeRemaining,
        scores: [v.scores[0], v.scores[1], v.scores[2], v.scores[3]],
        winner: v.winner,
        carrying: local.carrying,
        flags: local.flags,
        bankedTotal: local.bankedTotal,
        abilityCooldown: local.abilityCooldown,
        team: local.team,
        character: local.character,
        activeTeams: v.bases.filter((b) => b.active).map((b) => b.team),
        rttMs: null,
      };
      useAppStore.getState().setHud(hud);
    }
  }, -2);

  const outcomeFor = (team: TeamId): 'victory' | 'defeat' | null =>
    outcome ? (outcome.winner === team ? 'victory' : 'defeat') : null;

  return (
    <group>
      <hemisphereLight args={[theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity]} />
      <ambientLight intensity={theme.ambient.intensity} color={theme.ambient.color} />
      <directionalLight
        position={[-30, 46, -26]}
        intensity={theme.sun.intensity}
        color={theme.sun.color}
        castShadow={high}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-bias={-0.0005}
      />
      <pointLight ref={heroLight} color="#fff2dd" intensity={3.2} distance={11} decay={2} />

      <MapFx theme={theme} half={session.view.arenaHalf} bases={session.view.bases} fires={propFires} />
      {/* Models and textures suspend while loading (GameView shows the loading card meanwhile). */}
      <Suspense fallback={null}>
        <Backdrop theme={theme} />
        <Scenery mapId={session.view.mapId} half={session.view.arenaHalf} dressing={dressing.scenery} />
        <Arena bases={session.view.bases} theme={theme} half={session.view.arenaHalf} dressing={dressing.arena} shadows={high} />
        <Flames view={view} yaw={yaw} />
        <Specials view={view} yaw={yaw} />
        <Vfx enabled />
        <Ready onReady={onReady} />
      </Suspense>

      <Suspense fallback={null}>
        {players.map((p, i) => (
          <group
            key={p.id}
            ref={(el) => {
              avatarRefs.current[i] = el;
            }}
          >
            <Creature player={p} outcome={outcomeFor(p.team)} />
          </group>
        ))}
      </Suspense>

      {high && <PostFX fog={theme.fx.groundFog} />}
    </group>
  );
}
