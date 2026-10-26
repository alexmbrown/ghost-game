'use client';

import { useEffect, useRef } from 'react';

import * as C from '@/game/core/constants';
import { FACTIONS, FLAME_COLOR } from '@/game/core/factions';
import { FX } from '@/game/core/movement';
import type { GameSession } from '@/game/session/types';

const SIZE = 196; // CSS px
const RANGE = 34; // world units from center to rim

/**
 * Rotating radar centered on the local player ("up" = where the camera looks).
 * Off-radar home base and Magic Pumpkin get arrows on the rim.
 */
export function Minimap({ session }: { session: GameSession }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    const ctx = c.getContext('2d')!;

    const draw = () => {
      const v = session.view;
      const me = v.players.find((p) => p.isLocal);
      if (!me) return;
      const R = SIZE / 2;
      const k = R / RANGE;
      // Camera basis from the local heading (aim = camera yaw + π).
      const fx = Math.sin(me.heading);
      const fz = Math.cos(me.heading);
      const rx = -fz;
      const rz = fx;
      const toScreen = (x: number, z: number): [number, number] => {
        const dx = x - me.x;
        const dz = z - me.z;
        return [R + (dx * rx + dz * rz) * k, R - (dx * fx + dz * fz) * k];
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(14, 9, 34, 0.86)';
      ctx.fillRect(0, 0, SIZE, SIZE);

      // Arena floor + bounds.
      const H = v.arenaHalf;
      ctx.beginPath();
      const corners: [number, number][] = [
        [-H, -H],
        [H, -H],
        [H, H],
        [-H, H],
      ];
      corners.forEach(([x, z], i) => {
        const [sx, sy] = toScreen(x, z);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(70, 52, 130, 0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Obstacles.
      for (const o of v.obstacles) {
        ctx.beginPath();
        const pts: [number, number][] = [
          [o.min.x, o.min.z],
          [o.max.x, o.min.z],
          [o.max.x, o.max.z],
          [o.min.x, o.max.z],
        ];
        pts.forEach(([x, z], i) => {
          const [sx, sy] = toScreen(x, z);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.fillStyle = o.kind === 'water' ? '#1e6a6a' : o.kind === 'tree' ? '#2d5a3a' : '#8f86c4';
        ctx.fill();
      }

      // Bases.
      for (const b of v.bases) {
        if (!b.active) continue;
        const [sx, sy] = toScreen(b.pos.x, b.pos.z);
        ctx.beginPath();
        ctx.arc(sx, sy, C.BASE_BLOCK_RADIUS * k, 0, Math.PI * 2);
        ctx.fillStyle = FACTIONS[b.team].color + '66';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = FACTIONS[b.team].color;
        ctx.stroke();
      }

      // Grave Grasp fields.
      for (const f of v.fields) {
        const [sx, sy] = toScreen(f.x, f.z);
        ctx.beginPath();
        ctx.arc(sx, sy, f.radius * k, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(132, 204, 22, 0.25)';
        ctx.fill();
      }

      // Loose spirits.
      ctx.fillStyle = FLAME_COLOR;
      for (const f of v.flames) {
        const [sx, sy] = toScreen(f.pos.x, f.pos.z);
        if (sx < -4 || sy < -4 || sx > SIZE + 4 || sy > SIZE + 4) continue;
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      }

      const t = performance.now() / 1000;
      // Mega-Spirits + pumpkin.
      for (const m of v.megas) {
        const [sx, sy] = toScreen(m.x, m.z);
        ctx.beginPath();
        ctx.arc(sx, sy, 4.5 + Math.sin(t * 6) * 1, 0, Math.PI * 2);
        ctx.fillStyle = '#ede4ff';
        ctx.fill();
      }
      if (v.pumpkin.available) {
        const [sx, sy] = toScreen(v.pumpkin.x, v.pumpkin.z);
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8c1a';
        ctx.fill();
        ctx.strokeStyle = '#1b1030';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Players (others first, local on top).
      for (const p of v.players) {
        if (p.isLocal || p.left || p.flags & FX.STUN) continue;
        const [sx, sy] = toScreen(p.x, p.z);
        ctx.beginPath();
        ctx.arc(sx, sy, p.carrying >= 10 ? 5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = FACTIONS[p.team].color;
        ctx.fill();
        ctx.lineWidth = p.carrying >= 10 ? 2.5 : 1.5;
        ctx.strokeStyle = p.carrying >= 10 ? '#ffd166' : '#1b1030';
        ctx.stroke();
      }
      ctx.restore();

      // Rim arrows for off-radar home base and pumpkin.
      const rim = (x: number, z: number, color: string) => {
        const [sx, sy] = toScreen(x, z);
        const dx = sx - R;
        const dy = sy - R;
        const d = Math.hypot(dx, dy);
        if (d < R - 10) return;
        const a = Math.atan2(dy, dx);
        ctx.save();
        ctx.translate(R + Math.cos(a) * (R - 11), R + Math.sin(a) * (R - 11));
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, -7);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-6, 7);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1b1030';
        ctx.stroke();
        ctx.restore();
      };
      const home = v.bases[me.team];
      rim(home.pos.x, home.pos.z, FACTIONS[me.team].color);
      if (v.pumpkin.available) rim(v.pumpkin.x, v.pumpkin.z, '#ff8c1a');

      // Local player arrow (always center, pointing up).
      ctx.save();
      ctx.translate(R, R);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(7, 7);
      ctx.lineTo(0, 3);
      ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = FACTIONS[me.team].color;
      ctx.stroke();
      ctx.restore();
    };

    draw();
    const id = setInterval(draw, 80);
    return () => clearInterval(id);
  }, [session]);

  return (
    <div className="minimap" aria-hidden>
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
    </div>
  );
}
