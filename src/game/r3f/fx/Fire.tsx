import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { NOISE_GLSL } from './fxTextures';

export interface FireSpot {
  x: number;
  y: number;
  z: number;
  /** Flame height in world units (~1 = torch). */
  scale: number;
  /** Tint (hex). Defaults to warm orange. */
  color?: string;
}

const VERT = /* glsl */ `
attribute float aPhase;
attribute vec3 aTint;
varying vec2 vUv;
varying float vPhase;
varying vec3 vTint;
void main() {
  vUv = uv;
  vPhase = aPhase;
  vTint = aTint;
  // Cylindrical billboard: always face the camera, stay upright.
  vec4 center = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sx = length(instanceMatrix[0].xyz);
  float sy = length(instanceMatrix[1].xyz);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 world = center.xyz + right * position.x * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
varying vec3 vTint;
${NOISE_GLSL}
void main() {
  float y = vUv.y;
  float t = uTime * 1.7 + vPhase * 10.0;
  // Teardrop silhouette that sways and licks upward.
  float width = mix(0.36, 0.03, pow(y, 1.15));
  float sway = (vnoise(vec2(y * 2.5 - t * 0.8, vPhase * 5.0)) - 0.5) * 0.22 * y;
  float dx = abs(vUv.x - 0.5 - sway);
  float body = smoothstep(width, width * 0.25, dx);
  float n = fbm(vec2(vUv.x * 3.2 + vPhase, y * 3.6 - t * 1.5));
  float flame = body * smoothstep(1.0, 0.2, y + (n - 0.5) * 0.6) * smoothstep(0.0, 0.1, y);
  vec3 col = mix(vTint * 0.5, vTint, smoothstep(0.05, 0.45, flame));
  col = mix(col, vec3(1.0, 0.96, 0.82), smoothstep(0.5, 0.95, flame) * (1.0 - y * 0.8));
  gl_FragColor = vec4(col * flame * 1.7, flame);
}
`;

/** All fires in one instanced draw call (additive, bloom does the glow). */
export function Fire({ spots }: { spots: readonly FireSpot[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const res = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.7, 1, 1, 1);
    geo.translate(0, 0.5, 0); // base of the flame at the spot
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geo, mat };
  }, []);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );

  const count = Math.max(1, spots.length);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const phases = new Float32Array(count);
    const tints = new Float32Array(count * 3);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    spots.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z);
      o.scale.set(s.scale, s.scale, s.scale);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      phases[i] = Math.random();
      c.set(s.color ?? '#ff7a1a');
      tints.set([c.r, c.g, c.b], i * 3);
    });
    m.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    m.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    m.count = spots.length;
    m.instanceMatrix.needsUpdate = true;
  }, [spots, count]);

  useFrame((rs) => {
    res.mat.uniforms.uTime.value = rs.clock.elapsedTime;
  });

  if (!spots.length) return null;
  return <instancedMesh ref={mesh} args={[res.geo, res.mat, count]} frustumCulled={false} />;
}
