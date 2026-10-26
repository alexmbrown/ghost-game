// Music loop points. Run: npm test

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findLoopPoints } from './loopPoints';

const SR = 8000;

/** 120 bpm drums + bass over 70 s: an 8 s quiet intro without kick, and a 6 s fade-out. */
function track(): Float32Array {
  const x = new Float32Array(SR * 70);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const bass = [55, 82.4, 110, 73.4];
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const beat = t % 0.5;
    const intro = t < 8;
    let v = 0;
    if (!intro && Math.floor(t / 0.5) % 2 === 0) v += Math.sin(2 * Math.PI * 60 * beat) * Math.exp(-beat * 18); // kick on 1 and 3
    if (Math.floor(t / 0.5) % 2 === 1) v += noise() * 0.5 * Math.exp(-beat * 30); // snare on 2 and 4
    v += noise() * 0.15 * Math.exp(-(t % 0.25) * 60); // hats on eighths
    v += Math.sin(2 * Math.PI * bass[Math.floor(t / 2) % 4] * t) * 0.25; // a bass note per bar
    x[i] = v * (intro ? 0.3 : 1) * Math.min(1, (70 - t) / 6);
  }
  return x;
}

describe('music loop points', () => {
  const p = findLoopPoints([track()], SR);

  it('loops the loud body: after the intro, before the fade-out', () => {
    assert.ok(p, 'found a loop');
    assert.ok(p.start >= 8, `start ${p.start.toFixed(2)} is in the intro`);
    assert.ok(p.end <= 64, `end ${p.end.toFixed(2)} is in the fade-out`);
    assert.ok(p.end - p.start >= 24, 'loop long enough not to feel repetitive');
  });

  it('keeps the beat: the loop is a whole number of bars', () => {
    const bars = (p!.end - p!.start) / 2;
    assert.ok(Math.abs(bars - Math.round(bars)) * 2 < 0.03, `loop is ${bars.toFixed(3)} bars`);
    assert.ok(p!.quality > 0.5, `rhythm match ${p!.quality.toFixed(2)}`);
  });

  it('leaves short clips alone', () => {
    assert.equal(findLoopPoints([new Float32Array(SR * 10)], SR), null);
  });
});
