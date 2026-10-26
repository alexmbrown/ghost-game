import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import * as C from '@/game/core/constants';
import { FACTIONS } from '@/game/core/factions';
import type { BaseState } from '@/game/core/types';
import type { MapTheme } from '../mapThemes';
import { torchSpots } from '../props/layout';
import { MagicCircle, Motes } from './Atmosphere';
import { Fire, type FireSpot } from './Fire';

interface Props {
  theme: MapTheme;
  half: number;
  bases: readonly BaseState[];
  /** Flames that belong to props (braziers, candles, lanterns; from the map's dressing). */
  fires: readonly FireSpot[];
}

/**
 * Per-map atmosphere and fire: magic motes, perimeter torches or wall sconces
 * (lamp-lit maps use lamppost models instead), the props' own flames, and a
 * ring of team-colored flames + a runic circle at every active base.
 */
export function MapFx({ theme, half, bases, fires }: Props) {
  const torchStyle = theme.fx.torch;
  const torches = useMemo(() => (torchStyle === 'lamp' ? [] : torchSpots(half, torchStyle)), [half, torchStyle]);
  const spots = useMemo<FireSpot[]>(() => {
    const out: FireSpot[] = [...fires];
    const torchY = torchStyle === 'sconce' ? 2.25 : 2.35;
    for (const t of torches) out.push({ x: t.x, y: torchY, z: t.z, scale: 0.9, color: theme.fx.torchColor });
    for (const b of bases) {
      if (!b.active) continue;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        out.push({
          x: b.pos.x + Math.cos(a) * (C.BASE_RADIUS + 0.15),
          y: 0.18,
          z: b.pos.z + Math.sin(a) * (C.BASE_RADIUS + 0.15),
          scale: 0.6,
          color: FACTIONS[b.team].color,
        });
      }
    }
    return out;
  }, [fires, torches, torchStyle, bases, theme]);

  return (
    <group>
      <Motes half={half} color={theme.fx.motes} />
      {torchStyle !== 'lamp' && <TorchMounts torches={torches} style={torchStyle} />}
      <Fire spots={spots} />
      {bases
        .filter((b) => b.active)
        .map((b) => (
          <group key={b.team} position={[b.pos.x, 0, b.pos.z]}>
            <MagicCircle radius={C.BASE_RADIUS + 0.9} color={FACTIONS[b.team].color} speed={0.18} opacity={0.55} y={0.06} />
          </group>
        ))}
    </group>
  );
}

/** Iron torch posts or wall sconce brackets (instanced). */
function TorchMounts({ torches, style }: { torches: { x: number; z: number; rot: number }[]; style: 'post' | 'sconce' }) {
  const posts = useRef<THREE.InstancedMesh>(null);
  const bowls = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    torches.forEach((t, i) => {
      if (style === 'post') {
        o.position.set(t.x, 1.1, t.z);
        o.rotation.set(0, 0, 0);
        o.scale.set(1, 1, 1);
      } else {
        // Bracket sticking out of the wall.
        o.position.set(t.x, 1.75, t.z);
        o.rotation.set(0, t.rot, 0);
        o.scale.set(1, 0.32, 1);
      }
      o.updateMatrix();
      posts.current?.setMatrixAt(i, o.matrix);
      o.position.set(t.x, style === 'post' ? 2.25 : 2.12, t.z);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      bowls.current?.setMatrixAt(i, o.matrix);
    });
    for (const m of [posts.current, bowls.current]) if (m) m.instanceMatrix.needsUpdate = true;
  }, [torches, style]);
  return (
    <group>
      <instancedMesh ref={posts} args={[undefined, undefined, torches.length]} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 2.2, 6]} />
        <meshStandardMaterial color="#26222f" roughness={0.6} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={bowls} args={[undefined, undefined, torches.length]}>
        <cylinderGeometry args={[0.22, 0.1, 0.22, 8]} />
        <meshStandardMaterial color="#3a3446" roughness={0.5} metalness={0.7} />
      </instancedMesh>
    </group>
  );
}
