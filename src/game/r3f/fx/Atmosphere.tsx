import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { makeRng } from '@/game/core/math';
import { runeTexture } from './fxTextures';

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uSize;
attribute float aPhase;
attribute float aSpeed;
varying float vFade;
void main() {
  vec3 p = position;
  float rise = mod(uTime * aSpeed + aPhase * uHeight, uHeight);
  p.y += rise;
  p.x += sin(uTime * 0.6 + aPhase * 12.0) * 0.8;
  p.z += cos(uTime * 0.5 + aPhase * 9.0) * 0.8;
  // Fade in at the bottom, out at the top, and twinkle.
  vFade = smoothstep(0.0, 0.15, rise / uHeight) * (1.0 - smoothstep(0.7, 1.0, rise / uHeight));
  vFade *= 0.6 + 0.4 * sin(uTime * 3.0 + aPhase * 30.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(uColor * a * vFade * 1.6, a * vFade);
}
`;

/** Floating magic motes drifting up through the arena (one draw call). */
export function Motes({ half, color, count = 260 }: { half: number; color: string; count?: number }) {
  const res = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    const rand = makeRng(count * 7919 + Math.round(half)); // deterministic: render stays pure
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() * 2 - 1) * half;
      pos[i * 3 + 1] = 0.2;
      pos[i * 3 + 2] = (rand() * 2 - 1) * half;
      phase[i] = rand();
      speed[i] = 0.25 + rand() * 0.5;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: 6 },
        uSize: { value: 0.32 },
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geo, mat };
  }, [half, color, count]);
  useEffect(
    () => () => {
      res.geo.dispose();
      res.mat.dispose();
    },
    [res],
  );
  useFrame((rs) => {
    res.mat.uniforms.uTime.value = rs.clock.elapsedTime;
  });
  return <points args={[res.geo, res.mat]} frustumCulled={false} />;
}

/** Rotating runic circle on the ground (additive, tinted). */
export function MagicCircle({
  radius,
  color,
  speed = 0.25,
  opacity = 0.6,
  y = 0.05,
  visible = true,
}: {
  radius: number;
  color: string;
  speed?: number;
  opacity?: number;
  y?: number;
  visible?: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((rs, dt) => {
    if (ref.current) ref.current.rotation.z += dt * speed;
    if (mat.current) mat.current.opacity = opacity * (0.8 + Math.sin(rs.clock.elapsedTime * 2) * 0.2);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position-y={y} visible={visible}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial
        ref={mat}
        map={runeTexture()}
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}
