// AudioManager: buses (master/music/sfx/voice/ambient/ui), lazy decoding,
// simple 2D spatialization (distance + stereo pan from the camera), seamless
// music loops, ambience crossfades, and a voice queue so announcer lines never
// overlap.
//
// Which generated files exist is listed in public/audio/index.json (written by
// the asset pipeline), so we never spam the console with 404s for missing ones.

import { findLoopPoints, type LoopPoints } from './loopPoints';
import { SOUNDS, soundUrls, type Bus, type SoundDef, type SoundId } from './sounds';
import { SYNTH } from './synth';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  ambient: number;
  muted: boolean;
}

interface PlayOpts {
  /** World position for spatialized playback. */
  x?: number;
  z?: number;
  volume?: number;
  rate?: number;
}

interface LoopHandle {
  id: SoundId;
  /** Master gain for the whole loop (fades in/out). */
  gain: GainNode;
  /** Every scheduled source (crossfaded music loops schedule overlapping passes). */
  sources: AudioBufferSourceNode[];
  timer: ReturnType<typeof setTimeout> | null;
  stopped?: boolean;
}

/** Equal-power crossfade curves (constant loudness through the seam). */
const FADE_IN = Float32Array.from({ length: 33 }, (_, i) => Math.sin((i / 32) * (Math.PI / 2)));
const FADE_OUT = Float32Array.from({ length: 33 }, (_, i) => Math.cos((i / 32) * (Math.PI / 2)));

class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private available: Set<string> | null = null;
  private availableLoad: Promise<void> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private music: LoopHandle | null = null;
  private ambient: LoopHandle | null = null;
  private wantMusic: SoundId | null = null;
  private wantAmbient: SoundId | null = null;
  private listener = { x: 0, z: 0, yaw: 0 };
  private volumes: Volumes = { master: 0.8, music: 0.6, sfx: 0.9, voice: 1, ambient: 0.7, muted: false };
  /** Seamless loop regions of music tracks (public/audio/loops.json), by URL. */
  private loops = new Map<string, LoopPoints>();
  /** Loop regions worked out in the browser for tracks loops.json doesn't list. */
  private analysed = new WeakMap<AudioBuffer, LoopPoints | null>();
  private voiceBusyUntil = 0;
  private lastPlayed = new Map<string, number>();

  /** Must be called from a user gesture (autoplay policy). Safe to call repeatedly. */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const bus of ['music', 'sfx', 'voice', 'ambient', 'ui'] as Bus[]) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.buses[bus] = g;
      }
      this.applyVolumes();
      this.loadIndex();
      // Start anything requested before the first gesture.
      if (this.wantMusic) this.playMusic(this.wantMusic);
      if (this.wantAmbient) this.playAmbient(this.wantAmbient);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolumes(v: Volumes): void {
    const { master, music, sfx, voice, ambient, muted } = v;
    this.volumes = { master, music, sfx, voice, ambient: ambient ?? sfx * 0.8, muted: !!muted };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.volumes;
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(v.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(v.voice, t, 0.05);
    this.buses.ambient.gain.setTargetAtTime(v.ambient, t, 0.05);
  }

  setListener(x: number, z: number, yaw: number): void {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  // --- loading -----------------------------------------------------------------

  private loadIndex(): Promise<void> {
    if (!this.availableLoad) {
      const files = fetch(`${BASE}/audio/index.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : { files: [] }))
        .then((j: { files?: string[] }) => {
          this.available = new Set((j.files ?? []).map((f) => `${BASE}/audio/${f}`));
        })
        .catch(() => {
          this.available = new Set();
        });
      const loops = fetch(`${BASE}/audio/loops.json`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : {}))
        .then((j: Record<string, LoopPoints>) => {
          for (const [f, p] of Object.entries(j)) this.loops.set(`${BASE}/audio/${f}`, p);
        })
        .catch(() => {});
      this.availableLoad = Promise.all([files, loops]).then(() => {});
    }
    return this.availableLoad;
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(url);
    if (!p) {
      p = this.loadIndex().then(async () => {
        if (!this.ctx || !this.available?.has(url)) return null;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          return null;
        }
      });
      this.buffers.set(url, p);
    }
    return p;
  }

  /** Warm the cache (call on match start for gameplay sounds). */
  preload(ids: SoundId[]): void {
    if (!this.ctx) return;
    for (const id of ids) for (const url of soundUrls(id, BASE)) void this.load(url);
  }

  // --- playback ----------------------------------------------------------------

  private spatial(opts: PlayOpts): { gain: number; pan: number } {
    if (opts.x === undefined || opts.z === undefined) return { gain: 1, pan: 0 };
    const dx = opts.x - this.listener.x;
    const dz = opts.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = d < 5 ? 1 : Math.max(0, 1 - (d - 5) / 32);
    if (d < 1e-3) return { gain, pan: 0 };
    const rx = Math.cos(this.listener.yaw);
    const rz = -Math.sin(this.listener.yaw);
    const pan = Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / d) * 0.75));
    return { gain, pan };
  }

  play(id: SoundId, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const def: SoundDef = SOUNDS[id];
    const { gain: sg, pan } = this.spatial(opts);
    const vol = (def.volume ?? 1) * (opts.volume ?? 1) * sg;
    if (vol <= 0.01) return;

    // Throttle identical sounds stacking in the same instant.
    const now = ctx.currentTime;
    if (now - (this.lastPlayed.get(id) ?? -1) < 0.03) return;
    this.lastPlayed.set(id, now);

    const urls = soundUrls(id, BASE);
    const url = urls[Math.floor(Math.random() * urls.length)];
    const out = this.chain(def.bus, vol, pan);

    void this.load(url).then((buf) => {
      if (!this.ctx) return;
      if (!buf) {
        SYNTH[id]?.(this.ctx, out, this.ctx.currentTime);
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const pv = def.pitchVar ?? 0;
      src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * pv);
      src.connect(out);
      src.start();
    });
  }

  private chain(bus: Bus, vol: number, pan: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.buses[bus]);
    } else {
      g.connect(this.buses[bus]);
    }
    return g;
  }

  /** Voice lines: one at a time. Low-priority lines are dropped if busy. */
  say(id: SoundId, priority: 'high' | 'low' = 'high'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (priority === 'low' && ctx.currentTime < this.voiceBusyUntil) return;
    const url = soundUrls(id, BASE)[0];
    void this.load(url).then((buf) => {
      if (!buf || !this.ctx) return;
      const start = Math.max(this.ctx.currentTime, priority === 'high' ? this.voiceBusyUntil : 0);
      if (start - this.ctx.currentTime > 2.5) return; // too stale to be useful
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.chain('voice', SOUNDS[id].volume ?? 1, 0));
      src.start(start);
      this.voiceBusyUntil = start + buf.duration + 0.08;
    });
  }

  private startLoop(id: SoundId, fade: number, as: SoundId = id): Promise<LoopHandle | null> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    const def: SoundDef = SOUNDS[id];
    const url = soundUrls(id, BASE)[0];
    return this.load(url).then((buf) => {
      if (!buf || !this.ctx) {
        // Not generated yet: borrow another track, or a synth stinger.
        if (def.fallback) return this.startLoop(def.fallback as SoundId, fade, as);
        if (!def.loop) SYNTH[id]?.(ctx, this.buses[def.bus], ctx.currentTime);
        return null;
      }
      const c = this.ctx;
      const master = c.createGain();
      const t = c.currentTime;
      master.gain.setValueAtTime(0.0001, t);
      master.gain.exponentialRampToValueAtTime(def.volume ?? 1, t + Math.max(0.05, fade));
      master.connect(this.buses[def.bus]);
      const handle: LoopHandle = { id: as, gain: master, sources: [], timer: null };

      if (def.loop && def.bus === 'music') {
        this.musicLoop(handle, buf, url);
        return handle;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = !!def.loop;
      src.connect(master);
      src.start();
      handle.sources.push(src);
      return handle;
    });
  }

  /**
   * Music plays its intro once, then repeats the loop region found by
   * loopPoints.ts (after the intro, before any baked fade-out), jumping from
   * its end back to its start through a short equal-power crossfade, so it never
   * audibly fades or restarts. Each pass is queued a whole loop ahead.
   */
  private musicLoop(h: LoopHandle, buf: AudioBuffer, url: string): void {
    const c = this.ctx!;
    const t0 = c.currentTime + 0.02;
    const first = c.createBufferSource();
    first.buffer = buf;
    const g0 = c.createGain();
    first.connect(g0).connect(h.gain);
    first.start(t0);
    h.sources.push(first);

    const handOver = (g: GainNode, src: AudioBufferSourceNode, seam: number, xf: number) => {
      g.gain.setValueCurveAtTime(FADE_OUT, seam - xf / 2, xf);
      src.stop(seam + xf / 2 + 0.05);
    };
    const run = (p: LoopPoints | null) => {
      if (h.stopped) return;
      const seam = t0 + (p?.end ?? 0);
      if (!p || seam - 1 < c.currentTime) {
        // Too short to analyse (or found too late): plain gapless loop.
        first.loop = true;
        if (p) {
          first.loopStart = p.start;
          first.loopEnd = p.end;
        }
        return;
      }
      // A clean match needs only a click-free splice; a loose one gets a longer blend.
      const xf = p.quality >= 0.5 ? 0.12 : 0.8;
      handOver(g0, first, seam, xf);
      const pass = (at: number) => {
        if (h.stopped) return;
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        src.connect(g).connect(h.gain);
        const begin = at - xf / 2;
        g.gain.setValueCurveAtTime(FADE_IN, begin, xf);
        src.start(begin, p.start - xf / 2);
        const next = at + (p.end - p.start);
        handOver(g, src, next, xf);
        h.sources = [...h.sources.slice(-2), src];
        h.timer = setTimeout(() => pass(next), Math.max(0, (begin - c.currentTime) * 1000));
      };
      pass(seam);
    };

    const known = this.loops.get(url) ?? this.analysed.get(buf);
    if (known !== undefined) run(known);
    else {
      // Not in loops.json: analyse once, after playback has started (~0.1 s of work).
      h.timer = setTimeout(() => {
        const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
        const p = findLoopPoints(channels, buf.sampleRate);
        this.analysed.set(buf, p);
        run(p);
      }, 100);
    }
  }

  private stopLoop(h: LoopHandle | null, fade: number): void {
    if (!h || !this.ctx) return;
    h.stopped = true;
    if (h.timer) clearTimeout(h.timer);
    const t = this.ctx.currentTime;
    h.gain.gain.cancelScheduledValues(t);
    h.gain.gain.setValueAtTime(Math.max(h.gain.gain.value, 0.0001), t);
    h.gain.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    for (const s of h.sources) {
      try {
        s.stop(t + fade + 0.1);
      } catch {
        /* already stopped */
      }
    }
  }

  /** Crossfade to a music track (null = silence). Stingers (non-loop) play once. */
  playMusic(id: SoundId | null, fade = 1.2): void {
    this.wantMusic = id;
    if (!this.ctx) return;
    if (this.music?.id === id) return;
    const old = this.music;
    this.music = null;
    this.stopLoop(old, fade);
    if (!id) return;
    void this.startLoop(id, fade).then((h) => {
      if (this.wantMusic !== id) {
        this.stopLoop(h, 0.2);
        return;
      }
      this.music = h;
    });
  }

  playAmbient(id: SoundId | null, fade = 2): void {
    this.wantAmbient = id;
    if (!this.ctx) return;
    if (this.ambient?.id === id) return;
    const old = this.ambient;
    this.ambient = null;
    this.stopLoop(old, fade);
    if (!id) return;
    void this.startLoop(id, fade).then((h) => {
      if (this.wantAmbient !== id) {
        this.stopLoop(h, 0.2);
        return;
      }
      this.ambient = h;
    });
  }
}

export const audio = new AudioManager();
