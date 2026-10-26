// Finds where a generated music track can loop without anyone noticing.
//
// The tracks weren't written as loops: some open with a quieter intro, some
// end on a baked fade-out, and the bar the track ends on rarely lines up with
// the bar it starts on. So we look for a pair of points, `start` after the
// intro and `end` before the fade, where the music *leading into* each point
// matches (same rhythm, same loudness, same rough tone), and jump from `end`
// back to `start` with a very short crossfade. Pure math on the decoded
// samples, so it runs on whatever the browser decoded (no encoder-delay drift).

export interface LoopPoints {
  /** Seconds: where each repeat picks up. */
  start: number;
  /** Seconds: where each pass hands over to the next. */
  end: number;
  /** How well the two sides matched (0..1); low means use a longer crossfade. */
  quality: number;
}

const HOP = 0.02; // analysis frame (s)
const WINDOW = 4; // music compared before each point (s)
const MIN_LOOP = 24; // shortest loop worth having (s)

/** Per-frame features of a mono signal: loudness, transients and a rough low/high tone balance. */
function features(x: Float32Array, sr: number) {
  const hop = Math.max(1, Math.round(sr * HOP));
  const n = Math.floor(x.length / hop);
  const rms = new Float32Array(n);
  const onset = new Float32Array(n);
  const tone = new Float32Array(n);
  let prevHi = 0;
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 250) / sr); // one-pole low-pass at ~250 Hz
  let prev = 0;
  for (let f = 0; f < n; f++) {
    let e = 0;
    let hi = 0;
    let lo = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const v = x[i];
      e += v * v;
      const d = v - prev; // first difference: emphasises attacks
      prev = v;
      hi += d * d;
      lp = a * lp + (1 - a) * v;
      lo += lp * lp;
    }
    rms[f] = Math.sqrt(e / hop);
    const logHi = Math.log(1e-6 + hi);
    onset[f] = f ? Math.max(0, logHi - prevHi) : 0;
    prevHi = logHi;
    tone[f] = Math.log((1e-6 + lo) / (1e-6 + e));
  }
  return { rms, onset, tone, n };
}

/** Moving average over `w` frames (centered). */
function smooth(v: Float32Array, w: number): Float32Array {
  const out = new Float32Array(v.length);
  let acc = 0;
  const half = Math.floor(w / 2);
  for (let i = 0; i < v.length + half; i++) {
    if (i < v.length) acc += v[i];
    if (i - w >= 0) acc -= v[i - w];
    const j = i - half;
    if (j >= 0 && j < v.length) out[j] = acc / Math.min(w, i + 1);
  }
  return out;
}

/** Pearson correlation of v[a-len..a) and v[b-len..b). */
function corr(v: Float32Array, a: number, b: number, len: number, step = 1): number {
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  let k = 0;
  for (let i = 0; i < len; i += step) {
    const x = v[a - len + i];
    const y = v[b - len + i];
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
    k++;
  }
  const cov = sab - (sa * sb) / k;
  const den = Math.sqrt((saa - (sa * sa) / k) * (sbb - (sb * sb) / k));
  return den > 1e-9 ? cov / den : 0;
}

/** How well the music leading into frame `s` matches the music leading into frame `e`. */
function score(F: ReturnType<typeof features>, L: Float32Array, s: number, e: number, w: number, step: number): number {
  const rhythm = corr(F.onset, s, e, w, step);
  const level = -Math.abs(Math.log((L[s] + 1e-6) / (L[e] + 1e-6)));
  let toneDiff = 0;
  for (let i = 1; i <= 25; i++) toneDiff += Math.abs(F.tone[s - i] - F.tone[e - i]);
  return rhythm + 0.8 * level - 0.05 * toneDiff;
}

/** Sample-level nudge of `end` (± a few ms) so the waveforms meet in phase. */
function refine(x: Float32Array, sr: number, s: number, e: number): number {
  const span = Math.round(sr * 0.012);
  const len = Math.round(sr * 0.03);
  let best = 0;
  let bestV = -Infinity;
  for (let lag = -span; lag <= span; lag++) {
    let v = 0;
    for (let i = 0; i < len; i += 2) v += x[s - len + i] * x[e + lag - len + i];
    if (v > bestV) {
      bestV = v;
      best = lag;
    }
  }
  return e + best;
}

/** Loop region for a decoded track (mono or stereo channels), or null if it's too short to bother. */
export function findLoopPoints(channels: readonly Float32Array[], sr: number): LoopPoints | null {
  const len = channels[0]?.length ?? 0;
  if (len / sr < MIN_LOOP + 2 * WINDOW) return null;
  const x = new Float32Array(len);
  for (const c of channels) for (let i = 0; i < len; i++) x[i] += c[i] / channels.length;

  const F = features(x, sr);
  const fps = 1 / HOP;
  const L = smooth(F.rms, Math.round(fps)); // ~1 s loudness
  const body = [...L.slice(Math.floor(F.n * 0.1), Math.floor(F.n * 0.9))].sort((p, q) => p - q)[Math.floor(F.n * 0.4)] || 0;
  if (body <= 0) return null;

  // The loud body of the track: after any quiet intro, before any fade-out.
  let first = 0;
  while (first < F.n && L[first] < body * 0.75) first++;
  let last = F.n - 1;
  while (last > 0 && L[last] < body * 0.75) last--;
  last -= Math.round(fps * 0.5); // stay clear of the ramp itself

  const w = Math.round(WINDOW * fps);
  const minS = Math.max(first + w, w);
  const minLoop = Math.round(MIN_LOOP * fps);
  const maxS = Math.min(minS + Math.round(30 * fps), last - minLoop);
  const minE = Math.max(minS + minLoop, last - Math.round(30 * fps));
  if (maxS <= minS || last <= minE) return null;

  // Coarse search (every 3rd frame, every 2nd sample of the window), then a fine pass around the best pair.
  let bestS = minS;
  let bestE = last;
  let best = -Infinity;
  for (let s = minS; s <= maxS; s += 3) {
    for (let e = Math.max(minE, s + minLoop); e <= last; e += 3) {
      const v = score(F, L, s, e, w, 2);
      if (v > best) {
        best = v;
        bestS = s;
        bestE = e;
      }
    }
  }
  const cs = bestS;
  const ce = bestE;
  for (let s = Math.max(minS, cs - 3); s <= Math.min(maxS, cs + 3); s++) {
    for (let e = Math.max(minE, ce - 3, s + minLoop); e <= Math.min(last, ce + 3); e++) {
      const v = score(F, L, s, e, w, 1);
      if (v > best) {
        best = v;
        bestS = s;
        bestE = e;
      }
    }
  }

  const hop = Math.round(sr * HOP);
  const sSample = bestS * hop;
  const eSample = refine(x, sr, sSample, bestE * hop);
  return { start: sSample / sr, end: eSample / sr, quality: Math.max(0, Math.min(1, corr(F.onset, bestS, bestE, w))) };
}
