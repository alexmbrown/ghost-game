import { Float } from '@react-three/drei';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { useAssetTexture } from './mapAssets';
import { seeded, type Dressing } from './props/layout';
import { PropMesh, Props } from './props/PropSet';

// Decoration around the arena edges, outside and overhead, so it never
// interferes with play (collisions only use obstacles). The static models are
// placed by props/layout.ts (dressScenery); this adds the animated and
// non-model pieces.

type V3 = [number, number, number];

export function Scenery({ mapId, half, dressing }: { mapId: string; half: number; dressing: Dressing }) {
  return (
    <group>
      {/* Decoration sits at or beyond the edges: shadows there cost a lot (every
          fence post and pine redrawn into the shadow map each frame) for nothing seen. */}
      <Props layout={dressing.props} shadows={false} />
      {mapId === 'graveyard' && <Wisps half={half} color="#d8c8ff" count={8} />}
      {mapId === 'cornmaze' && (
        <>
          <CornField half={half} />
          <Wisps half={half} color="#ffd9a0" count={6} />
        </>
      )}
      {mapId === 'mansion' && <MansionExtras half={half} />}
      {mapId === 'forest' && <Wisps half={half} color="#d9ff8a" count={18} height={1.4} />}
      {mapId === 'library' && <LibraryExtras half={half} />}
    </group>
  );
}

/** Instanced ring of something just outside the arena walls. */
function OuterRing({
  half,
  count,
  depth,
  seed,
  geometry,
  color,
  height,
}: {
  half: number;
  count: number;
  depth: number;
  seed: number;
  geometry: THREE.BufferGeometry;
  color: string;
  height: [number, number];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const rand = seeded(seed);
    for (let i = 0; i < count; i++) {
      const side = i % 4;
      const t = (rand() * 2 - 1) * (half + depth);
      const dd = half + 2.2 + rand() * depth;
      const [x, z] = side === 0 ? [t, -dd] : side === 1 ? [t, dd] : side === 2 ? [-dd, t] : [dd, t];
      const h = height[0] + rand() * (height[1] - height[0]);
      o.position.set(x, h / 2, z);
      o.scale.set(h / 3, h / 3, h / 3);
      o.rotation.set((rand() - 0.5) * 0.12, rand() * 3, (rand() - 0.5) * 0.12);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [count, depth, half, height, seed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, count]}>
      <meshStandardMaterial color={color} roughness={1} />
    </instancedMesh>
  );
}

/** Floating glow motes drifting over the arena. */
function Wisps({ half, color, count, height = 2.6 }: { half: number; color: string; count: number; height?: number }) {
  const spots = useMemo(() => {
    const rand = seeded(count * 31 + Math.round(half));
    return Array.from({ length: count }, () => [(rand() * 2 - 1) * (half - 8), height + rand() * 1.6, (rand() * 2 - 1) * (half - 8)] as V3);
  }, [half, count, height]);
  return (
    <group>
      {spots.map((p, i) => (
        <Float key={i} speed={2 + (i % 3) * 0.4} floatIntensity={2} rotationIntensity={0} position={p}>
          <mesh>
            <sphereGeometry args={[0.14, 10, 10]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

/** Two crossed quads (a corn-stalk card reads from every angle), standing on y = 0. */
function crossedCards(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const out = new THREE.BufferGeometry();
  for (const key of ['position', 'normal', 'uv'] as const) {
    const x = a.getAttribute(key);
    const y = b.getAttribute(key);
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array);
    arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(key, new THREE.BufferAttribute(arr, x.itemSize));
  }
  const ia = a.getIndex()!.array;
  out.setIndex([...ia, ...Array.from(ia, (i) => i + a.getAttribute('position').count)]);
  a.dispose();
  b.dispose();
  return out;
}

/** Fields of corn beyond the maze walls: instanced cut-out corn cards. */
function CornField({ half }: { half: number }) {
  const tex = useAssetTexture('corn_card');
  const geo = useMemo(() => crossedCards(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  const count = 520;
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const rand = seeded(1);
    for (let i = 0; i < count; i++) {
      const side = i % 4;
      const t = (rand() * 2 - 1) * (half + 12);
      const dd = half + 2.4 + rand() * 11;
      const [x, z] = side === 0 ? [t, -dd] : side === 1 ? [t, dd] : side === 2 ? [-dd, t] : [dd, t];
      const h = 3 + rand() * 1.4;
      o.position.set(x, 0, z);
      o.rotation.set(0, rand() * Math.PI, 0);
      o.scale.set(h * 1.1, h, h * 1.1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [half]);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, count]}>
      <meshStandardMaterial map={tex} alphaTest={0.5} side={THREE.DoubleSide} roughness={1} color="#b8a8c8" />
    </instancedMesh>
  );
}

/** The chandelier model, hovering over the room's center with its warm light. */
function Chandelier({ pos }: { pos: V3 }) {
  return (
    <Float speed={0.8} floatIntensity={0.4} rotationIntensity={0.1} position={pos}>
      <PropMesh name="chandelier" width={4.6} shadows={false} />
      <pointLight position-y={1} color="#ffc46b" intensity={14} distance={20} decay={2} />
    </Float>
  );
}

function MansionExtras({ half }: { half: number }) {
  const spire = useMemo(() => new THREE.ConeGeometry(0.9, 3, 6), []);
  return (
    <group>
      <Chandelier pos={[0, 6, 0]} />
      {/* rugs */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} receiveShadow>
        <planeGeometry args={[17, 17]} />
        <meshStandardMaterial color="#5a1e2e" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.025}>
        <ringGeometry args={[6.5, 7.2, 4, 1]} />
        <meshStandardMaterial color="#c9a94a" roughness={0.8} />
      </mesh>
      <Wisps half={half} color="#e9d5ff" count={6} height={3.4} />
      {/* the manor's rooftops and spires beyond the walls */}
      <OuterRing half={half} count={260} depth={8} seed={9} geometry={spire} color="#1a1426" height={[3, 6]} />
    </group>
  );
}

function LibraryExtras({ half }: { half: number }) {
  const stack = useMemo(() => new THREE.BoxGeometry(2.4, 3, 0.8), []);
  const books = useMemo(() => {
    const rand = seeded(23);
    return Array.from({ length: 16 }, () => ({
      pos: [(rand() * 2 - 1) * (half - 6), 4 + rand() * 2.5, (rand() * 2 - 1) * (half - 6)] as V3,
      rot: rand() * Math.PI * 2,
    }));
  }, [half]);
  return (
    <group>
      <Chandelier pos={[0, 6.4, 0]} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} receiveShadow>
        <circleGeometry args={[8.5, 40]} />
        <meshStandardMaterial color="#3a1a2a" roughness={1} />
      </mesh>
      {books.map((b, i) => (
        <Float key={i} speed={1.4 + (i % 4) * 0.3} floatIntensity={1.6} rotationIntensity={0.6} position={b.pos}>
          <PropMesh name="floating_book" width={0.9} rotation-y={b.rot} shadows={false} />
        </Float>
      ))}
      <Wisps half={half} color="#ffe2a8" count={8} height={3.2} />
      <OuterRing half={half} count={200} depth={6} seed={13} geometry={stack} color="#2a1608" height={[3.4, 5]} />
    </group>
  );
}
