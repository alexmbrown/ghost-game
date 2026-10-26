import * as THREE from 'three';

import type { MapTheme } from './mapThemes';

// The one procedural texture left: the sky dome's gradient (above the painted
// panoramas, and the whole sky on maps without one). Everything else uses the
// generated textures in public/textures (see mapAssets.ts).

/** Vertical sky gradient, mapped onto a backdrop sphere (canvas top = zenith). */
export function makeSkyTexture(stops: MapTheme['sky']): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  const at = [0, 0.45, 0.72, 0.88, 1];
  stops.forEach((col, i) => grad.addColorStop(at[i], col));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
