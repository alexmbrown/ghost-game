import { useFrame, useThree } from '@react-three/fiber';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * Ground fog as a screen effect. For each pixel we rebuild its world position
 * from the depth buffer and integrate exponential height fog along the camera
 * ray, so the mist is thick at ground level, thins with height, and wraps
 * around characters and obstacles with no intersection lines. Drifting noise
 * breaks it into wisps, and a tiny dither keeps the dark gradient from banding.
 * (It replaces three stacked transparent mist planes, which showed tiling
 * seams and hard stripes where they cut through geometry.)
 */
const FRAG = /* glsl */ `
uniform mat4 projInv;
uniform mat4 viewInv;
uniform vec3 camPos;
uniform vec3 fogColor;
uniform float density;
uniform float falloff;
uniform float maxFog;
uniform float maxDist;
uniform float time;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return v;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = projInv * clip;
  view /= view.w;
  vec3 world = (viewInv * vec4(view.xyz, 1.0)).xyz;
  vec3 ray = world - camPos;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  if (depth >= 0.9999) dist = maxDist; // sky: fog toward the horizon only
  dist = min(dist, maxDist);

  // Integral of density * exp(-falloff * height) along the ray (ground at y = 0).
  float k = falloff * rd.y;
  float along = abs(k) < 1e-4 ? dist : (1.0 - exp(-k * dist)) / k;
  float amount = density * exp(-falloff * camPos.y) * along;

  // Wisps: drifting noise sampled where the ray meets the fog layer.
  vec2 p = (camPos.xz + rd.xz * dist) * 0.07 + vec2(time * 0.025, time * 0.017);
  float n = fbm(p) * 0.65 + fbm(p * 2.7 - vec2(time * 0.04, 0.0)) * 0.35;
  amount *= mix(0.15, 1.9, smoothstep(0.2, 0.8, n));

  float fog = min(1.0 - exp(-max(amount, 0.0)), maxFog);
  vec3 col = mix(inputColor.rgb, fogColor, fog);
  // About half an 8-bit step of noise hides banding in the dark gradient.
  col += (hash(gl_FragCoord.xy + fract(time) * 61.0) - 0.5) / 255.0;
  outputColor = vec4(col, inputColor.a);
}
`;

export interface HeightFogSettings {
  color: string;
  /** Fog per world unit at ground level. */
  density: number;
  /** How quickly the fog thins with height (per world unit). */
  falloff: number;
  /** Most fog any pixel can get (0..1). */
  max: number;
}

class HeightFogEffect extends Effect {
  constructor(s: HeightFogSettings) {
    super('HeightFogEffect', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['projInv', new THREE.Uniform(new THREE.Matrix4())],
        ['viewInv', new THREE.Uniform(new THREE.Matrix4())],
        ['camPos', new THREE.Uniform(new THREE.Vector3())],
        ['fogColor', new THREE.Uniform(new THREE.Color(s.color))],
        ['density', new THREE.Uniform(s.density)],
        ['falloff', new THREE.Uniform(s.falloff)],
        ['maxFog', new THREE.Uniform(s.max)],
        ['maxDist', new THREE.Uniform(140)],
        ['time', new THREE.Uniform(0)],
      ]),
    });
  }
}

/** Mount inside <EffectComposer>. */
export function HeightFog({ settings }: { settings: HeightFogSettings }) {
  const camera = useThree((s) => s.camera);
  const effect = useMemo(() => new HeightFogEffect(settings), [settings]);
  useEffect(() => () => effect.dispose(), [effect]);
  useFrame((rs) => {
    const u = effect.uniforms;
    u.get('projInv')!.value.copy(camera.projectionMatrixInverse);
    u.get('viewInv')!.value.copy(camera.matrixWorld);
    u.get('camPos')!.value.setFromMatrixPosition(camera.matrixWorld);
    u.get('time')!.value = rs.clock.elapsedTime;
  });
  return <primitive object={effect} dispose={null} />;
}
