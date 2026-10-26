// Procedural placeholder SFX (Web Audio). Used only when the real generated
// file for a sound id is missing, so the game has feedback before assets land.
// Music, ambience, footsteps and voice have no placeholder (silence is better
// than a beepy stand-in there).

type Recipe = (ctx: AudioContext, out: AudioNode, t: number) => void;

function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  f0: number,
  f1: number,
  dur: number,
  type: OscillatorType = 'sine',
  gain = 0.25,
): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function whoosh(ctx: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, gain = 0.35): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.6;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const arp = (notes: number[], step: number, type: OscillatorType = 'triangle', gain = 0.2): Recipe => (ctx, out, t) =>
  notes.forEach((f, i) => tone(ctx, out, t + i * step, f, f * 1.01, step * 2.2, type, gain));

export const SYNTH: Record<string, Recipe> = {
  'sfx.flame.pickup': (c, o, t) => tone(c, o, t, 880, 1760, 0.09, 'sine', 0.18),
  'sfx.flame.pickupMega': arp([523, 659, 784, 1047, 1319], 0.05, 'triangle', 0.2),
  'sfx.flame.bankSmall': arp([392, 523, 659], 0.06),
  'sfx.flame.bankBig': arp([392, 523, 659, 784, 1047], 0.06, 'triangle', 0.24),
  'sfx.steal.thief': (c, o, t) => whoosh(c, o, t, 900, 4200, 0.28),
  'sfx.steal.victim': (c, o, t) => whoosh(c, o, t, 1400, 220, 0.4),
  'sfx.buddy': arp([659, 880], 0.07, 'sine', 0.22),
  'sfx.stun': (c, o, t) => {
    tone(c, o, t, 300, 60, 0.45, 'sawtooth', 0.18);
    whoosh(c, o, t, 2000, 200, 0.4, 0.25);
  },
  'sfx.knock': (c, o, t) => {
    tone(c, o, t, 220, 90, 0.18, 'square', 0.14);
    whoosh(c, o, t, 3000, 800, 0.25, 0.2);
  },
  'sfx.respawn': (c, o, t) => whoosh(c, o, t, 300, 2400, 0.35, 0.2),
  'sfx.power': arp([523, 784, 1047, 1568], 0.08, 'square', 0.12),
  'sfx.ability.phaseDash': (c, o, t) => whoosh(c, o, t, 500, 5000, 0.3, 0.32),
  'sfx.ability.graveGrasp': (c, o, t) => {
    tone(c, o, t, 90, 50, 0.6, 'sawtooth', 0.2);
    whoosh(c, o, t, 200, 120, 0.6, 0.25);
  },
  'sfx.ability.boneToss': (c, o, t) => {
    tone(c, o, t, 1200, 600, 0.05, 'square', 0.12);
    whoosh(c, o, t + 0.03, 1800, 900, 0.22, 0.2);
  },
  'sfx.ability.hellfireRush': (c, o, t) => {
    whoosh(c, o, t, 150, 1200, 0.5, 0.35);
    tone(c, o, t, 110, 70, 0.5, 'sawtooth', 0.12);
  },
  'sfx.ability.ready': (c, o, t) => tone(c, o, t, 1320, 1320, 0.07, 'sine', 0.08),
  'sfx.pumpkin.spawn': arp([392, 466, 587], 0.09, 'triangle', 0.16),
  'sfx.pumpkin.get': arp([523, 659, 784, 988, 1175, 1568], 0.045, 'square', 0.12),
  'sfx.mega.spawn': arp([1047, 988, 1175, 1319], 0.07, 'sine', 0.16),
  'sfx.countdown.tick': (c, o, t) => tone(c, o, t, 660, 660, 0.12, 'square', 0.12),
  'sfx.countdown.go': (c, o, t) => tone(c, o, t, 990, 990, 0.35, 'square', 0.14),
  'sfx.hurry': (c, o, t) => {
    tone(c, o, t, 880, 880, 0.25, 'triangle', 0.2);
    tone(c, o, t + 0.28, 880, 880, 0.25, 'triangle', 0.2);
  },
  'sfx.round.end': (c, o, t) => {
    tone(c, o, t, 196, 190, 1.4, 'triangle', 0.28);
    tone(c, o, t, 294, 290, 1.4, 'sine', 0.14);
  },
  'music.victory': arp([523, 659, 784, 1047, 784, 1047], 0.11, 'triangle', 0.2),
  'music.defeat': arp([392, 370, 349, 262], 0.18, 'triangle', 0.18),
  'music.draw': arp([440, 440, 523], 0.15, 'triangle', 0.16),
  'ui.click': (c, o, t) => tone(c, o, t, 700, 500, 0.05, 'triangle', 0.15),
  'ui.hover': (c, o, t) => tone(c, o, t, 1100, 1100, 0.025, 'sine', 0.05),
  'ui.back': (c, o, t) => tone(c, o, t, 500, 300, 0.08, 'triangle', 0.14),
  'ui.join': arp([660, 990], 0.07, 'sine', 0.16),
  'ui.leave': arp([660, 440], 0.08, 'sine', 0.14),
  'ui.error': (c, o, t) => tone(c, o, t, 220, 180, 0.25, 'square', 0.12),
  'ui.copy': (c, o, t) => tone(c, o, t, 880, 1320, 0.07, 'sine', 0.14),
};
