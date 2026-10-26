'use client';

// Cartoon "sticker" icon set (thick outline, bright fills) used everywhere in
// the UI instead of emoji. Each icon can be replaced by its generated image
// (assets/manifest.json: ui.*) — once the file exists and is listed in
// public/ui/index.json, <Icon> renders the image instead of the SVG.

import { useSyncExternalStore, type CSSProperties, type ReactElement } from 'react';

import type { TeamId } from '@/game/core/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
const O = '#1b1030'; // outline
const SW = 3.5;

// --- generated-image overrides ------------------------------------------------

let uiFiles: Set<string> | null = null;
let uiLoading = false;
const uiListeners = new Set<() => void>();

function subscribeUi(l: () => void): () => void {
  uiListeners.add(l);
  if (!uiLoading && typeof window !== 'undefined') {
    uiLoading = true;
    fetch(`${BASE}/ui/index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((j: { files?: string[] }) => {
        uiFiles = new Set(j.files ?? []);
      })
      .catch(() => {
        uiFiles = new Set();
      })
      .finally(() => uiListeners.forEach((fn) => fn()));
  }
  return () => uiListeners.delete(l);
}

/** URL of a generated UI image if it exists (public/ui/<file>), else null. */
export function useUiImage(file: string | undefined): string | null {
  return useSyncExternalStore(
    subscribeUi,
    () => (file && uiFiles?.has(file) ? `${BASE}/ui/${file}` : null),
    () => null,
  );
}

// --- icons ------------------------------------------------------------------------

type Draw = (c?: string) => ReactElement;

const flamePath = 'M32 5c7 11 19 20 18 36-1 12-8 19-18 19S15 53 14 41C13 25 25 16 32 5z';

const ICONS = {
  flame: (c = '#b48cff') => (
    <>
      <path d={flamePath} fill={c} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M32 16c4 7 11 13 10 23" fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" />
      <ellipse cx="26.5" cy="42" rx="3" ry="4.2" fill={O} />
      <ellipse cx="37.5" cy="42" rx="3" ry="4.2" fill={O} />
      <circle cx="27.6" cy="40.6" r="1.1" fill="#fff" />
      <circle cx="38.6" cy="40.6" r="1.1" fill="#fff" />
    </>
  ),
  mega: () => (
    <>
      <path d="M32 3c9 12 24 21 23 39-1 13-10 20-23 20S10 55 9 42C8 24 23 15 32 3z" fill="#d6c2ff" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <ellipse cx="24" cy="38" rx="4.6" ry="6" fill="#fff" stroke={O} strokeWidth={2.5} />
      <ellipse cx="40" cy="38" rx="4.6" ry="6" fill="#fff" stroke={O} strokeWidth={2.5} />
      <circle cx="24" cy="39" r="2.2" fill={O} />
      <circle cx="40" cy="39" r="2.2" fill={O} />
      <ellipse cx="32" cy="51" rx="4" ry="3" fill={O} />
      <path d="M50 22c3 3 3 7 0 9-3-2-3-6 0-9z" fill="#7dd3fc" stroke={O} strokeWidth={2} />
    </>
  ),
  ghost: (c = '#e9fdff') => (
    <>
      <path d="M13 55V30a19 19 0 0 1 38 0v25l-6.3-5-6.3 5-6.4-5-6.3 5-6.4-5z" fill={c} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <ellipse cx="25" cy="31" rx="4" ry="5.5" fill={O} />
      <ellipse cx="39" cy="31" rx="4" ry="5.5" fill={O} />
      <circle cx="26.3" cy="29.2" r="1.4" fill="#fff" />
      <circle cx="40.3" cy="29.2" r="1.4" fill="#fff" />
      <ellipse cx="32" cy="42" rx="3.4" ry="4" fill={O} />
    </>
  ),
  zombie: (c = '#a3e635') => (
    <>
      <rect x="12" y="13" width="40" height="42" rx="13" fill={c} stroke={O} strokeWidth={SW} />
      <path d="M13 24c4-9 10-12 19-12s16 3 19 12l-6-3-4 4-5-5-4 5-5-5-4 5z" fill="#3b2a4a" stroke={O} strokeWidth={2.5} strokeLinejoin="round" />
      <circle cx="24" cy="33" r="7" fill="#fff" stroke={O} strokeWidth={2.5} />
      <circle cx="25.5" cy="34" r="3" fill={O} />
      <circle cx="41" cy="34" r="4" fill="#fff" stroke={O} strokeWidth={2.5} />
      <path d="M37.5 31.5h7" stroke={O} strokeWidth={2.5} strokeLinecap="round" />
      <path d="M21 46c5 3 14 3 22-1" fill="none" stroke={O} strokeWidth={3} strokeLinecap="round" />
      <path d="M26 44v5M32 45v5M38 44v5" stroke={O} strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  skull: (c = '#fff7dc') => (
    <>
      <path d="M32 8c13 0 22 9 22 21 0 8-4 12-8 14v8H18v-8c-4-2-8-6-8-14C10 17 19 8 32 8z" fill={c} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M17 30c0-5 4-8 8-7s5 6 2 9-10 3-10-2zM47 30c0-5-4-8-8-7s-5 6-2 9 10 3 10-2z" fill={O} />
      <circle cx="23" cy="29" r="2" fill="#fcd34d" />
      <circle cx="41" cy="29" r="2" fill="#fcd34d" />
      <path d="M32 35l-3 5h6z" fill={O} />
      <path d="M24 46v5M29 46v5M35 46v5M40 46v5" stroke={O} strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  demon: (c = '#f87171') => (
    <>
      <path d="M15 24C10 18 10 10 14 5c1 7 5 11 10 13zM49 24c5-6 5-14 1-19-1 7-5 11-10 13z" fill="#fde68a" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx="32" cy="36" r="20" fill={c} stroke={O} strokeWidth={SW} />
      <path d="M20 31l9 3-1 4c-4 0-7-3-8-7zM44 31l-9 3 1 4c4 0 7-3 8-7z" fill="#fde047" stroke={O} strokeWidth={2} strokeLinejoin="round" />
      <path d="M21 44c6 6 16 6 22 0" fill={O} stroke={O} strokeWidth={2.5} strokeLinejoin="round" />
      <path d="M25 45l2 4 2-3M35 46l2 3 2-4" fill="#fff" />
    </>
  ),
  phaseDash: () => (
    <>
      <path d="M6 22h12M4 32h14M6 42h12" stroke="#67e8f9" strokeWidth={4} strokeLinecap="round" opacity={0.85} />
      <g transform="rotate(12 38 34)">
        <path d="M22 56V32a16 16 0 0 1 32 0v24l-5.3-4.2-5.4 4.2-5.3-4.2-5.4 4.2-5.3-4.2z" fill="#e9fdff" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
        <ellipse cx="33" cy="33" rx="3.2" ry="4.4" fill={O} />
        <ellipse cx="44" cy="33" rx="3.2" ry="4.4" fill={O} />
      </g>
    </>
  ),
  graveGrasp: () => (
    <>
      <path d="M6 56c6-8 46-8 52 0z" fill="#5b3a29" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M24 52V30c0-3 4-3 4 0v-9c0-3 4-3 4 0v-3c0-3 4-3 4 0v5c0-3 4-3 4 0v14l3-4c2-2 5 0 4 2l-6 11v6z" fill="#a3e635" stroke={O} strokeWidth={3} strokeLinejoin="round" />
      <path d="M30 42h7" stroke={O} strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  boneToss: () => (
    <>
      <path d="M10 46c4 6 10 8 14 6M42 10c6 2 10 7 10 13" fill="none" stroke="#fcd34d" strokeWidth={3.5} strokeLinecap="round" />
      <g transform="rotate(-40 32 32)">
        <path d="M18 27a6 6 0 1 1 6-6h16a6 6 0 1 1 6 6 6 6 0 1 1-6 6H24a6 6 0 1 1-6-6z" fill="#fff7dc" stroke={O} strokeWidth={SW} strokeLinejoin="round" transform="translate(0 11)" />
      </g>
    </>
  ),
  hellfireRush: () => (
    <>
      <path d="M32 4c4 8 14 12 16 24 2 10-2 18-8 22 1-6-2-10-6-12 1 6-2 10-6 12-6-3-10-9-9-18 1-7 5-10 7-15 1 5 4 7 6 8-2-8 0-14 0-21z" fill="#fb923c" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M32 24c2 5 7 7 7 14 0 5-3 9-7 10-4-1-7-5-7-10 0-6 5-9 7-14z" fill="#fde047" />
      <path d="M16 60c2-4 6-6 10-6M48 60c-2-4-6-6-10-6" stroke="#f87171" strokeWidth={3.5} strokeLinecap="round" />
    </>
  ),
  speed: () => <path d="M36 4L14 36h14l-4 24 26-36H36z" fill="#fde047" stroke={O} strokeWidth={SW} strokeLinejoin="round" />,
  magnet: () => (
    <>
      <path d="M14 10h12v22a6 6 0 0 0 12 0V10h12v22a18 18 0 0 1-36 0z" fill="#f87171" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M14 10h12v9H14zM38 10h12v9H38z" fill="#e2e8f0" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M6 54c1-4 3-6 3-9 2 3 3 5 3 9a3 3 0 0 1-6 0zM52 56c1-4 3-6 3-9 2 3 3 5 3 9a3 3 0 0 1-6 0z" fill="#b48cff" stroke={O} strokeWidth={2} />
    </>
  ),
  phase: () => (
    <>
      <path d="M30 8h26v48H30z" fill="#6b5b8a" stroke={O} strokeWidth={SW} />
      <path d="M30 20h26M30 32h26M30 44h26M43 8v12M38 20v12M48 32v12M40 44v12" stroke={O} strokeWidth={2} />
      <path d="M8 54V30a14 14 0 0 1 28 0v24l-4.7-4-4.6 4-4.7-4-4.7 4-4.6-4z" fill="#e9fdff" fillOpacity={0.85} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <ellipse cx="17" cy="31" rx="2.8" ry="4" fill={O} />
      <ellipse cx="27" cy="31" rx="2.8" ry="4" fill={O} />
    </>
  ),
  pumpkin: () => (
    <>
      <path d="M30 14c0-5 3-9 8-10" fill="none" stroke="#3f6212" strokeWidth={4} strokeLinecap="round" />
      <ellipse cx="32" cy="38" rx="25" ry="20" fill="#fb923c" stroke={O} strokeWidth={SW} />
      <path d="M32 18c-7 8-7 32 0 40M32 18c7 8 7 32 0 40" fill="none" stroke="#c2410c" strokeWidth={2.5} />
      <path d="M19 33l6-5 3 6zM45 33l-6-5-3 6z" fill="#fde047" stroke={O} strokeWidth={1.5} />
      <path d="M19 43c4 6 22 6 26 0l-4 2-3-2-3 3-3-3-3 3-3-3-3 2z" fill="#fde047" stroke={O} strokeWidth={1.5} strokeLinejoin="round" />
    </>
  ),
  crown: () => (
    <path d="M8 48L5 18l14 12 13-18 13 18 14-12-3 30z" fill="#fcd34d" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
  ),
  trophy: () => (
    <>
      <path d="M18 8h28v14a14 14 0 0 1-28 0z" fill="#fcd34d" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M18 14H8c0 8 4 12 10 12M46 14h10c0 8-4 12-10 12" fill="none" stroke={O} strokeWidth={SW} />
      <path d="M28 36h8v10h-8zM18 56c0-6 4-10 14-10s14 4 14 10z" fill="#f59e0b" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
    </>
  ),
  steal: () => (
    <>
      <path d="M40 8c4 6 10 10 10 18 0 6-4 10-10 10s-10-4-10-10c0-8 6-12 10-18z" fill="#b48cff" stroke={O} strokeWidth={3} strokeLinejoin="round" />
      <path d="M8 44c6-6 14-8 20-6l8 3c3 1 3 5-1 5h-9l12 2c3 0 6-2 8-4l6-5c3-2 6 1 4 4l-8 10c-3 3-6 5-11 5H8z" fill="#fde2c4" stroke={O} strokeWidth={3} strokeLinejoin="round" />
    </>
  ),
  stun: () => (
    <>
      <path d="M32 6l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z" fill="#fde047" stroke={O} strokeWidth={3} strokeLinejoin="round" />
      <path d="M12 38l2.5 5 5.5.6-4 3.8 1 5.6-5-2.8-5 2.8 1-5.6-4-3.8 5.5-.6zM52 38l2.5 5 5.5.6-4 3.8 1 5.6-5-2.8-5 2.8 1-5.6-4-3.8 5.5-.6z" fill="#fde047" stroke={O} strokeWidth={2.5} strokeLinejoin="round" />
    </>
  ),
  knock: () => (
    <path d="M32 4l6 14 15-6-6 15 14 5-14 6 7 14-15-5-5 15-6-15-14 7 5-15-15-5 15-6-7-14 15 6z" fill="#fb923c" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
  ),
  bank: (c = '#b48cff') => (
    <>
      <ellipse cx="32" cy="46" rx="26" ry="12" fill={c} stroke={O} strokeWidth={SW} />
      <ellipse cx="32" cy="46" rx="15" ry="6" fill="#fff" fillOpacity={0.6} />
      <path d="M32 6v28M24 26l8 9 8-9" fill="none" stroke={O} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 6v28M24 26l8 9 8-9" fill="none" stroke="#fde047" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  buddy: () => (
    <>
      <g transform="translate(-8 4) scale(0.75)">{ICON_FLAME_SMALL('#67e8f9')}</g>
      <g transform="translate(24 4) scale(0.75)">{ICON_FLAME_SMALL('#a3e635')}</g>
      <path d="M32 46v14M25 53h14" stroke={O} strokeWidth={7} strokeLinecap="round" />
      <path d="M32 46v14M25 53h14" stroke="#fde047" strokeWidth={3.5} strokeLinecap="round" />
    </>
  ),
  leave: () => (
    <>
      <path d="M10 6h26v52H10z" fill="#6b5b8a" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx="29" cy="33" r="2.5" fill={O} />
      <path d="M36 32h22M50 24l8 8-8 8" fill="none" stroke={O} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M36 32h22M50 24l8 8-8 8" fill="none" stroke="#f87171" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  gear: () => (
    <>
      <path
        d="M27 4h10l2 7 6 3 7-3 6 8-5 6v6l5 6-6 8-7-3-6 3-2 7H27l-2-7-6-3-7 3-6-8 5-6v-6l-5-6 6-8 7 3 6-3z"
        fill="#c4b5fd"
        stroke={O}
        strokeWidth={SW}
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="9" fill="#2a1f55" stroke={O} strokeWidth={SW} />
    </>
  ),
  close: () => (
    <path d="M14 14l36 36M50 14L14 50" stroke="currentColor" strokeWidth={8} strokeLinecap="round" />
  ),
  copy: () => (
    <>
      <rect x="20" y="6" width="34" height="38" rx="7" fill="#c4b5fd" stroke={O} strokeWidth={SW} />
      <rect x="10" y="20" width="34" height="38" rx="7" fill="#ede9fe" stroke={O} strokeWidth={SW} />
    </>
  ),
  link: () => (
    <>
      <path d="M28 36a10 10 0 0 0 14 0l9-9a10 10 0 0 0-14-14l-4 4" fill="none" stroke={O} strokeWidth={8} strokeLinecap="round" />
      <path d="M36 28a10 10 0 0 0-14 0l-9 9a10 10 0 0 0 14 14l4-4" fill="none" stroke={O} strokeWidth={8} strokeLinecap="round" />
      <path d="M28 36a10 10 0 0 0 14 0l9-9a10 10 0 0 0-14-14l-4 4M36 28a10 10 0 0 0-14 0l-9 9a10 10 0 0 0 14 14l4-4" fill="none" stroke="#c4b5fd" strokeWidth={4} strokeLinecap="round" />
    </>
  ),
  bot: () => (
    <>
      <path d="M32 6v8" stroke={O} strokeWidth={SW} />
      <circle cx="32" cy="6" r="4" fill="#f87171" stroke={O} strokeWidth={2.5} />
      <rect x="10" y="14" width="44" height="36" rx="10" fill="#94a3b8" stroke={O} strokeWidth={SW} />
      <circle cx="23" cy="31" r="5.5" fill="#67e8f9" stroke={O} strokeWidth={2.5} />
      <circle cx="41" cy="31" r="5.5" fill="#67e8f9" stroke={O} strokeWidth={2.5} />
      <path d="M24 42h16" stroke={O} strokeWidth={3} strokeLinecap="round" />
      <path d="M20 50v8h24v-8" fill="#64748b" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
    </>
  ),
  signal: () => (
    <>
      <rect x="8" y="40" width="10" height="16" rx="2" fill="#86efac" stroke={O} strokeWidth={3} />
      <rect x="27" y="28" width="10" height="28" rx="2" fill="#86efac" stroke={O} strokeWidth={3} />
      <rect x="46" y="14" width="10" height="42" rx="2" fill="#86efac" stroke={O} strokeWidth={3} />
    </>
  ),
  play: () => <path d="M18 8l38 24-38 24z" fill="currentColor" stroke={O} strokeWidth={SW} strokeLinejoin="round" />,
  users: () => (
    <>
      <circle cx="22" cy="22" r="10" fill="#c4b5fd" stroke={O} strokeWidth={SW} />
      <path d="M4 54c0-12 8-18 18-18s18 6 18 18z" fill="#c4b5fd" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx="44" cy="20" r="9" fill="#a78bfa" stroke={O} strokeWidth={SW} />
      <path d="M40 34c10-1 20 4 20 18H44" fill="#a78bfa" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
    </>
  ),
  castle: () => (
    <>
      <path d="M8 58V24h8v6h6v-6h8v6h6v-6h8v6h6v-6h6v34z" fill="#8b7bb3" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M26 58V44a6 6 0 0 1 12 0v14z" fill="#2a1f55" stroke={O} strokeWidth={SW} />
      <path d="M32 6v14" stroke={O} strokeWidth={3} />
      <path d="M32 6l12 4-12 4z" fill="#fb923c" stroke={O} strokeWidth={2} strokeLinejoin="round" />
    </>
  ),
  clock: () => (
    <>
      <circle cx="32" cy="34" r="24" fill="#ede9fe" stroke={O} strokeWidth={SW} />
      <path d="M32 18v16l10 7" fill="none" stroke={O} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 4h16" stroke={O} strokeWidth={5} strokeLinecap="round" />
    </>
  ),
  check: () => <path d="M10 34l14 14 30-32" fill="none" stroke="currentColor" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />,
  sound: () => (
    <>
      <path d="M8 24h12l14-12v40L20 40H8z" fill="#c4b5fd" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M42 22c5 5 5 15 0 20M49 15c9 9 9 25 0 34" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
    </>
  ),
  muted: () => (
    <>
      <path d="M8 24h12l14-12v40L20 40H8z" fill="#c4b5fd" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M42 24l14 16M56 24L42 40" fill="none" stroke="#f87171" strokeWidth={5} strokeLinecap="round" />
    </>
  ),
  mouse: () => (
    <>
      <rect x="16" y="6" width="32" height="52" rx="16" fill="#ede9fe" stroke={O} strokeWidth={SW} />
      <path d="M32 6v18M16 24h32" stroke={O} strokeWidth={3} />
      <rect x="29" y="12" width="6" height="8" rx="3" fill="#a78bfa" stroke={O} strokeWidth={2} />
    </>
  ),
  book: () => (
    <>
      <path d="M6 12c10-4 18-2 26 4v40c-8-6-16-8-26-4z" fill="#ede9fe" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M58 12c-10-4-18-2-26 4v40c8-6 16-8 26-4z" fill="#c4b5fd" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
    </>
  ),
  graveyard: () => (
    <>
      <circle cx="46" cy="16" r="9" fill="#e0e7ff" stroke={O} strokeWidth={3} />
      <path d="M14 56V30a10 10 0 0 1 20 0v26z" fill="#8b7bb3" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M20 38h8" stroke={O} strokeWidth={3} strokeLinecap="round" />
      <path d="M40 56V40h-5v-6h5v-6h6v6h5v6h-5v16z" fill="#a39ecd" stroke={O} strokeWidth={3} strokeLinejoin="round" />
      <path d="M4 58h56" stroke={O} strokeWidth={SW} strokeLinecap="round" />
    </>
  ),
  corn: () => (
    <>
      <path d="M22 58c-2-14 2-30 10-46 8 16 12 32 10 46z" fill="#fde047" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M27 24h10M25 32h14M24 40h16M25 48h14M32 14v40" stroke="#ca8a04" strokeWidth={2} />
      <path d="M22 58C10 50 8 36 12 24c4 10 8 20 12 34zM42 58c12-8 14-22 10-34-4 10-8 20-12 34z" fill="#84cc16" stroke={O} strokeWidth={3} strokeLinejoin="round" />
    </>
  ),
  tree: () => (
    <>
      <path d="M28 50h8v10h-8z" fill="#5b3a29" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M32 4L12 30h8L8 46h48L44 30h8z" fill="#2f6b4f" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <circle cx="27" cy="33" r="2.6" fill="#d9ff8a" />
      <circle cx="37" cy="33" r="2.6" fill="#d9ff8a" />
    </>
  ),
  edit: () => (
    <>
      <path d="M40 8l16 16-30 30H10V38z" fill="#fde68a" stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M34 14l16 16" stroke={O} strokeWidth={SW} />
    </>
  ),
} satisfies Record<string, Draw>;

function ICON_FLAME_SMALL(c: string): ReactElement {
  return (
    <>
      <path d={flamePath} fill={c} stroke={O} strokeWidth={SW + 1} strokeLinejoin="round" />
      <ellipse cx="26.5" cy="42" rx="3" ry="4.2" fill={O} />
      <ellipse cx="37.5" cy="42" rx="3" ry="4.2" fill={O} />
    </>
  );
}

export type IconName = keyof typeof ICONS;

/** Generated-image filenames (assets/manifest.json ui.*) that replace an icon when present. */
const GENERATED: Partial<Record<IconName, string>> = {
  flame: 'icon_flame.webp',
  phaseDash: 'icon_phaseDash.webp',
  graveGrasp: 'icon_graveGrasp.webp',
  boneToss: 'icon_boneToss.webp',
  hellfireRush: 'icon_hellfireRush.webp',
  speed: 'icon_power_speed.webp',
  magnet: 'icon_power_magnet.webp',
  phase: 'icon_power_phase.webp',
  pumpkin: 'icon_pumpkin.webp',
  mega: 'icon_mega.webp',
  trophy: 'award_mvp.webp',
};

interface IconProps {
  name: IconName;
  size?: number | string;
  /** Fill color for icons that take one (flame, ghost, bank…). */
  color?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({ name, size = 24, color, className, style, title }: IconProps) {
  const img = useUiImage(color ? undefined : GENERATED[name]);
  const s = typeof size === 'number' ? `${size}px` : size;
  if (img) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={img} alt={title ?? ''} width={s} height={s} className={className} style={style} draggable={false} />;
  }
  const draw = ICONS[name] as Draw;
  return (
    <svg
      viewBox="0 0 64 64"
      width={s}
      height={s}
      className={className}
      style={{ flexShrink: 0, overflow: 'visible', ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {draw(color)}
    </svg>
  );
}

// --- faction crests -------------------------------------------------------------------

const FACE: Record<TeamId, IconName> = { 0: 'ghost', 1: 'zombie', 2: 'skull', 3: 'demon' };
const CREST_COLORS: Record<TeamId, [string, string]> = {
  0: ['#a5f3fc', '#0e7490'],
  1: ['#d9f99d', '#3f6212'],
  2: ['#fef08a', '#a16207'],
  3: ['#fecaca', '#b91c1c'],
};
const CREST_FILES: Record<TeamId, string> = {
  0: 'crest_ghosts.webp',
  1: 'crest_zombies.webp',
  2: 'crest_skeletons.webp',
  3: 'crest_demons.webp',
};

/** A generated UI image (public/ui/<file>), or the SVG icon until it exists. */
export function UiArt({ file, icon, size = 24, className }: { file: string; icon: IconName; size?: number; className?: string }) {
  const img = useUiImage(file);
  if (!img) return <Icon name={icon} size={size} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={img} alt="" width={size} height={size} className={className} draggable={false} />;
}

/** A character's portrait (public/ui/portraits/<id>.webp); the faction crest until it exists. */
export function Portrait({ character, team, size = 64, className }: { character: string; team: TeamId; size?: number; className?: string }) {
  const img = useUiImage(`portraits/${character}.webp`);
  if (!img) return <Crest team={team} size={size} className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={img} alt="" width={size} height={size} className={className} draggable={false} />;
}

/** Shield crest with the faction's face. */
export function Crest({ team, size = 40, className }: { team: TeamId; size?: number; className?: string }) {
  const img = useUiImage(CREST_FILES[team]);
  if (img) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={img} alt="" width={size} height={size} className={className} draggable={false} />;
  }
  const [light, dark] = CREST_COLORS[team];
  const id = `crest-grad-${team}`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} style={{ flexShrink: 0, overflow: 'visible' }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <path d="M32 2l26 8v22c0 15-11 25-26 30C17 57 6 47 6 32V10z" fill={`url(#${id})`} stroke={O} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M32 7l21 6.5V32c0 12-9 20.5-21 25C20 52.5 11 44 11 32V13.5z" fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={2} />
      <g transform="translate(13 12) scale(0.6)">{(ICONS[FACE[team]] as Draw)()}</g>
    </svg>
  );
}
