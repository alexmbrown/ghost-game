import * as THREE from 'three';

// Procedural textures for VFX (glows, mist, runes). Cached: one copy each.

const cache = new Map<string, THREE.Texture>();

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Soft radial glow (white center → transparent), for additive halos and particles. */
export function glowTexture(): THREE.Texture {
  return cached('glow', () => {
    const [c, ctx] = canvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Runic magic circle: rings, glyph band and a star — tinted by material color. */
export function runeTexture(): THREE.Texture {
  return cached('runes', () => {
    const size = 512;
    const [c, ctx] = canvas(size, size);
    const cx = size / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.lineCap = 'round';
    const ring = (r: number, w: number) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cx, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(246, 6);
    ring(226, 3);
    ring(168, 4);
    ring(150, 2);
    // Glyph band between the outer rings.
    ctx.lineWidth = 3;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * 197, cx + Math.sin(a) * 197);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      const k = i % 4;
      if (k === 0) {
        ctx.moveTo(-8, -10);
        ctx.lineTo(0, 10);
        ctx.lineTo(8, -10);
      } else if (k === 1) {
        ctx.arc(0, 0, 8, 0, Math.PI * 1.5);
      } else if (k === 2) {
        ctx.moveTo(-9, 0);
        ctx.lineTo(9, 0);
        ctx.moveTo(0, -10);
        ctx.lineTo(0, 10);
      } else {
        ctx.moveTo(-8, 8);
        ctx.lineTo(0, -10);
        ctx.lineTo(8, 8);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();
    }
    // Five-point star inside.
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      const x = cx + Math.cos(a) * 146;
      const y = cx + Math.sin(a) * 146;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Dots at the star points.
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 168, cx + Math.sin(a) * 168, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

// --- shaders -------------------------------------------------------------------------

/** Value-noise + fbm GLSL shared by the fire and mist shaders. */
export const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`;
