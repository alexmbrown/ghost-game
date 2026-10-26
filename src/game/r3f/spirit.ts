import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { PROPS } from './props/catalog';
import { usePropModel } from './props/PropSet';

// The spirit models (Meshy, assets/manifest.json: model.prop.spirit /
// mega_spirit) and the material that brings them to life: the body licks and
// sways like a flame, breathes, and the eyes blink, squeeze happily into ^ ^
// or flutter nervously, depending on the spirit's mood. The texture's eyes are
// scattered over many UV islands, so they're found on the model instead (dark
// texels on its front) and the eyelids are drawn in model space.

/** Shared clock for every spirit material (any component rendering spirits ticks it). */
export const SPIRIT_TIME = { value: 0 };

/** Loose spirits look about; carried ones are happy; the Mega-Spirit is a nervous wreck. */
export type SpiritMood = 'calm' | 'happy' | 'nervous';
const MOOD: Record<SpiritMood, number> = { calm: 0, happy: 1, nervous: 2 };

interface Eyes {
  left: THREE.Vector3;
  right: THREE.Vector3;
  /** Half-size of an eye (ellipsoid), padded a little. */
  half: THREE.Vector3;
  /** Body color around the eyes (linear), painted over them when they shut. */
  body: THREE.Color;
}

export interface SpiritModel {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
  eyes: Eyes | null;
  /** Bottom and height of the body (geometry units), for the flame flicker. */
  base: number;
  height: number;
}

/** Texture pixels for sampling (downscaled). */
function pixels(map: THREE.Texture | null): { data: Uint8ClampedArray; w: number; h: number } | null {
  const img = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width || typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 256, 256);
  return { data: ctx.getImageData(0, 0, 256, 256).data, w: 256, h: 256 };
}

/**
 * The two eyes: dark texels on the model's front, grouped into clusters, and
 * the best mirrored pair (left/right at the same height) — so a mouth, like
 * the Mega-Spirit's, isn't mistaken for one.
 */
function findEyes(geometry: THREE.BufferGeometry, map: THREE.Texture | null, height: number): Eyes | null {
  const px = pixels(map);
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!px || !uv) return null;
  const index = geometry.getIndex();
  const tris = (index ? index.count : pos.count) / 3;
  const vi = (k: number) => (index ? index.getX(k) : k);
  const sample = (u: number, v: number) => {
    const x = Math.min(px.w - 1, Math.max(0, Math.floor(u * px.w)));
    const y = Math.min(px.h - 1, Math.max(0, Math.floor(v * px.h))); // glTF UVs: v runs down the image
    const o = (y * px.w + x) * 4;
    return [px.data[o], px.data[o + 1], px.data[o + 2]];
  };
  const lum = (c: number[]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  const dark: { c: THREE.Vector3; verts: number[] }[] = [];
  const light: { c: THREE.Vector3; rgb: number[] }[] = [];
  for (let t = 0; t < tris; t++) {
    const ids = [vi(t * 3), vi(t * 3 + 1), vi(t * 3 + 2)];
    const c = new THREE.Vector3();
    let u = 0;
    let v = 0;
    for (const id of ids) {
      c.x += pos.getX(id) / 3;
      c.y += pos.getY(id) / 3;
      c.z += pos.getZ(id) / 3;
      u += uv.getX(id) / 3;
      v += uv.getY(id) / 3;
    }
    if (c.z <= 0) continue; // front half only
    const rgb = sample(u, v);
    if (lum(rgb) < 0.3) dark.push({ c, verts: ids });
    else light.push({ c, rgb });
  }

  // Single-linkage clusters of dark triangles.
  const parent = dark.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < dark.length; i++) {
    for (let j = i + 1; j < dark.length; j++) if (dark[i].c.distanceTo(dark[j].c) < 0.06 * height) parent[find(i)] = find(j);
  }
  const groups = new Map<number, typeof dark>();
  dark.forEach((d, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), d]);
  });
  const blobs = [...groups.values()]
    .filter((g) => g.length >= 3)
    .map((g) => {
      const box = new THREE.Box3();
      for (const d of g) for (const id of d.verts) box.expandByPoint(new THREE.Vector3(pos.getX(id), pos.getY(id), pos.getZ(id)));
      return { center: box.getCenter(new THREE.Vector3()), half: box.getSize(new THREE.Vector3()).multiplyScalar(0.5), n: g.length };
    });
  let best: { l: (typeof blobs)[number]; r: (typeof blobs)[number] } | null = null;
  let bestCost = Infinity;
  for (const l of blobs) {
    for (const r of blobs) {
      if (l.center.x >= -0.03 * height || r.center.x <= 0.03 * height) continue;
      const cost = (Math.abs(l.center.y - r.center.y) + Math.abs(l.center.x + r.center.x)) / height - 0.002 * (l.n + r.n);
      if (cost < bestCost) {
        bestCost = cost;
        best = { l, r };
      }
    }
  }
  if (!best) return null;
  const half = best.l.half.clone().max(best.r.half).multiplyScalar(1.15);

  // The body color right around the eyes.
  const near = light.filter((p) => Math.min(p.c.distanceTo(best!.l.center), p.c.distanceTo(best!.r.center)) < half.length() * 3);
  const avg = [0, 1, 2].map((k) => near.reduce((s, p) => s + p.rgb[k], 0) / Math.max(1, near.length) / 255);
  const body = new THREE.Color(avg[0], avg[1], avg[2]).convertSRGBToLinear();
  return { left: best.l.center, right: best.r.center, half, body };
}

/** A spirit model as one geometry + its texture, sized like a teardrop of `radius` (base at -radius, ~3.1 radius tall). */
export function useSpiritModel(name: 'spirit' | 'mega_spirit', radius: number): SpiritModel {
  const model = usePropModel(name);
  const spirit = useMemo(() => {
    const part = model.parts[0];
    const geometry = part.geometry.clone();
    const height = radius * 3.1;
    const s = height / PROPS[name].size[1];
    geometry.scale(s, s, s);
    geometry.translate(0, -radius, 0);
    const mat = (Array.isArray(part.material) ? part.material[0] : part.material) as THREE.MeshStandardMaterial;
    return { geometry, map: mat.map, eyes: findEyes(geometry, mat.map, height), base: -radius, height };
  }, [model, name, radius]);
  useEffect(() => () => spirit.geometry.dispose(), [spirit]);
  return spirit;
}

const VERT_HEAD = /* glsl */ `
uniform float uSpiritTime;
uniform float uBase;
uniform float uHeight;
uniform float uSeed;
#ifdef SPIRIT_INSTANCED
attribute float aSeed;
#endif
varying vec3 vSpiritPos;
varying float vSpiritSeed;
`;

const VERT_BODY = /* glsl */ `
#include <begin_vertex>
#ifdef SPIRIT_INSTANCED
  float seed = aSeed;
#else
  float seed = uSeed;
#endif
vSpiritSeed = seed;
vSpiritPos = transformed;
{
  // Flame: the upper body licks side to side and the tip whips most; the base stays put.
  float h = clamp((transformed.y - uBase) / uHeight, 0.0, 1.0);
  float hh = h * h;
  float t = uSpiritTime + seed * 17.0;
  float lick = sin(t * 6.3 + h * 5.0) * 0.6 + sin(t * 10.1 + h * 8.5 + 1.3) * 0.4;
  transformed.x += lick * hh * uHeight * 0.075;
  transformed.z += sin(t * 7.7 + h * 6.0) * hh * uHeight * 0.04;
  // Breathing: stretch up and slim down, a little ragged like a real flame.
  float breath = sin(t * 3.2) * 0.045 + sin(t * 8.9 + 0.7) * 0.02;
  transformed.y = uBase + (transformed.y - uBase) * (1.0 + breath * h);
  transformed.xz *= 1.0 - breath * 0.5 * h;
}
`;

const FRAG_HEAD = /* glsl */ `
uniform float uSpiritTime;
uniform float uMood;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform vec3 uEyeHalf;
uniform vec3 uBody;
varying vec3 vSpiritPos;
varying float vSpiritSeed;
`;

const FRAG_BODY = /* glsl */ `
#include <map_fragment>
#ifdef SPIRIT_EYES
{
  float t = uSpiritTime + vSpiritSeed * 17.0;
  // Blink every few seconds (nervous spirits flutter: two quick blinks, more often).
  float nervous = step(1.5, uMood);
  float period = mix(3.2 + fract(vSpiritSeed * 7.31) * 2.2, 1.7, nervous);
  float ph = fract(t / period);
  float shut = max(step(ph, 0.045), nervous * step(abs(ph - 0.13), 0.03));
  // Happy spirits now and then squeeze their eyes into little arcs: ^ ^
  float happy = step(0.5, uMood) * (1.0 - nervous) * step(0.64, fract(t * 0.21 + vSpiritSeed * 0.53));
  if (shut + happy > 0.0) {
    for (int i = 0; i < 2; i++) {
      vec3 d = (vSpiritPos - (i == 0 ? uEyeL : uEyeR)) / uEyeHalf;
      if (dot(d.xy, d.xy) < 1.4 && abs(d.z) < 3.0) {
        // Shut: a soft downward lid line. Happy: an upward arc.
        float curve = happy > 0.0 ? 0.3 - d.x * d.x * 0.6 : -0.2 + d.x * d.x * 0.3;
        float line = 1.0 - smoothstep(0.1, 0.22, abs(d.y - curve));
        diffuseColor.rgb = diffuse * mix(uBody, vec3(0.04, 0.025, 0.06), line);
      }
    }
  }
}
#endif
`;

/**
 * An unlit, tinted spirit material that flickers like a flame and blinks.
 * `instanced` reads a per-instance `aSeed` attribute (add one to the geometry);
 * otherwise `seed` sets the phase.
 */
export function makeSpiritMaterial(
  spirit: SpiritModel,
  opts: { color: THREE.ColorRepresentation; mood: SpiritMood; instanced?: boolean; seed?: number },
): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map: spirit.map, color: opts.color, toneMapped: false });
  const e = spirit.eyes;
  m.defines = { ...(opts.instanced ? { SPIRIT_INSTANCED: '' } : {}), ...(e ? { SPIRIT_EYES: '' } : {}) };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uSpiritTime: SPIRIT_TIME,
      uBase: { value: spirit.base },
      uHeight: { value: spirit.height },
      uSeed: { value: opts.seed ?? 0 },
      uMood: { value: MOOD[opts.mood] },
      uEyeL: { value: e?.left ?? new THREE.Vector3() },
      uEyeR: { value: e?.right ?? new THREE.Vector3() },
      uEyeHalf: { value: e?.half ?? new THREE.Vector3(1, 1, 1) },
      uBody: { value: e?.body ?? new THREE.Color(1, 1, 1) },
    });
    m.userData.shader = shader; // handy when debugging
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('#include <map_fragment>', FRAG_BODY);
  };
  m.customProgramCacheKey = () => `spirit:${opts.instanced ? 1 : 0}:${e ? 1 : 0}`;
  return m;
}

/** Stable pseudo-random phase in [0, 1) for an id. */
export const spiritSeed = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
