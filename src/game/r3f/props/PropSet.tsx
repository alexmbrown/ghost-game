import { useGLTF } from '@react-three/drei';
import type { ThreeElements } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { PROPS, propUrl, type PropName } from './catalog';
import type { PropLayout, PropPlace } from './layout';

// Renders prop models: every copy of a model in one instanced draw (per
// material), with the model re-centered on X/Z and standing on y = 0 so
// layouts can place it by footprint.

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

interface PropModel {
  parts: Part[];
}

const built = new WeakMap<object, PropModel>();

/** Meshopt files quantize attributes (normalized int16 etc.); bake transforms in float. */
function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const n = a.itemSize;
  const out = new Float32Array(a.count * n);
  const get = [a.getX, a.getY, a.getZ, a.getW];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = get[k].call(a, i);
  return new THREE.BufferAttribute(out, n);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Emissive map holding only the texture's bright texels (in their own colors). */
function glowMap(map: THREE.Texture, threshold: number): THREE.Texture | null {
  const img = map.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img?.width || typeof document === 'undefined') return null;
  const k = Math.min(1, 512 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    const m = smooth(threshold, threshold + 0.12, lum);
    px[i] *= m;
    px[i + 1] *= m;
    px[i + 2] *= m;
  }
  ctx.putImageData(data, 0, 0);
  // A clone keeps the source's flipY, UV channel and texture transform.
  const t = map.clone();
  t.source = new THREE.TextureSource(c);
  t.needsUpdate = true;
  return t;
}

function withGlow(name: PropName, mat: THREE.Material): THREE.Material {
  const glow = (PROPS[name] as { glow?: { threshold: number; intensity: number } }).glow;
  const std = mat as THREE.MeshStandardMaterial;
  if (!glow || !std.map) return mat;
  const emissive = glowMap(std.map, glow.threshold);
  if (!emissive) return mat;
  const out = std.clone();
  out.emissive = new THREE.Color('#ffffff');
  out.emissiveMap = emissive;
  out.emissiveIntensity = glow.intensity;
  return out;
}

function build(name: PropName, scene: THREE.Object3D): PropModel {
  scene.updateMatrixWorld(true);
  const parts: Part[] = [];
  const box = new THREE.Box3();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = new THREE.BufferGeometry();
    for (const [key, attr] of Object.entries(mesh.geometry.attributes)) geometry.setAttribute(key, toFloat(attr));
    if (mesh.geometry.index) geometry.setIndex(mesh.geometry.index.clone());
    for (const g of mesh.geometry.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox!);
    const material = Array.isArray(mesh.material) ? mesh.material.map((m) => withGlow(name, m)) : withGlow(name, mesh.material);
    parts.push({ geometry, material });
  });
  const center = box.getCenter(new THREE.Vector3());
  for (const p of parts) {
    p.geometry.translate(-center.x, -box.min.y, -center.z);
    p.geometry.computeBoundingBox();
    p.geometry.computeBoundingSphere();
  }
  return { parts };
}

/** A prop model, re-centered with its base on y = 0 (suspends while loading). */
export function usePropModel(name: PropName): PropModel {
  const gltf = useGLTF(propUrl(name));
  let model = built.get(gltf.scene);
  if (!model) {
    model = build(name, gltf.scene);
    built.set(gltf.scene, model);
  }
  return model;
}

export function preloadProps(names: readonly PropName[]): void {
  for (const n of names) useGLTF.preload(propUrl(n));
}

function Instances({ part, items, shadows }: { part: Part; items: readonly PropPlace[]; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    o.rotation.order = 'YXZ';
    items.forEach((p, i) => {
      o.position.set(p.x, p.y ?? 0, p.z);
      o.rotation.set(p.tilt?.[0] ?? 0, p.rot ?? 0, p.tilt?.[1] ?? 0);
      o.scale.set(p.s[0], p.s[1], p.s[2]);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    // Cull by where the copies are, not by the model at the origin.
    m.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[part.geometry, part.material, items.length]} castShadow={shadows} receiveShadow />;
}

/** World units per culling chunk. */
const CHUNK = 20;

/**
 * Big sets split into spatial chunks: an instanced mesh is culled as a whole,
 * so one spanning the arena (120 fence posts, 64 wall segments) was drawn in
 * full whenever any piece was on screen. Chunks the camera can't see are skipped.
 */
function chunks(items: readonly PropPlace[]): PropPlace[][] {
  if (items.length <= 12) return [items as PropPlace[]];
  const cells = new Map<string, PropPlace[]>();
  for (const p of items) {
    const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = []));
    cell.push(p);
  }
  return [...cells.values()];
}

/** Every copy of one model. */
export function PropSet({ name, items, shadows = true }: { name: PropName; items: readonly PropPlace[]; shadows?: boolean }) {
  const model = usePropModel(name);
  const groups = useMemo(() => chunks(items), [items]);
  if (!items.length) return null;
  return (
    <group>
      {groups.map((group, c) =>
        model.parts.map((part, k) => <Instances key={`${c}:${k}:${group.length}`} part={part} items={group} shadows={shadows} />),
      )}
    </group>
  );
}

/** A whole layout (one PropSet per model). */
export function Props({ layout, shadows = true }: { layout: PropLayout; shadows?: boolean }) {
  return (
    <group>
      {(Object.entries(layout) as [PropName, PropPlace[]][]).map(([name, items]) => (
        <PropSet key={name} name={name} items={items} shadows={shadows} />
      ))}
    </group>
  );
}

/**
 * A single prop for animated or one-off pieces (pumpkin, projectiles,
 * chandeliers, portals): `height` world units tall, or `width` wide with its
 * height scaled by `yMul`.
 */
export function PropMesh({
  name,
  height,
  width,
  yMul = 1,
  shadows = true,
  ...group
}: { name: PropName; height?: number; width?: number; yMul?: number; shadows?: boolean } & ThreeElements['group']) {
  const model = usePropModel(name);
  const [w, h] = PROPS[name].size;
  const s = width ? width / w : (height ?? h) / h;
  return (
    <group {...group}>
      <group scale={[s, s * yMul, s]}>
        {model.parts.map((p, k) => (
          <mesh key={k} geometry={p.geometry} material={p.material} castShadow={shadows} receiveShadow />
        ))}
      </group>
    </group>
  );
}
