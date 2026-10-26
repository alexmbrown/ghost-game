import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Static export: the whole game ships as static files (Cloudflare Pages / GitHub Pages).
// No backend, no server runtime. Multiplayer is serverless via Trystero (WebRTC).
//
// For GitHub Pages project sites the app is served from a sub-path; set
// NEXT_PUBLIC_BASE_PATH="/<repo>" at build time. Cloudflare Pages serves from root.
// "/" means "serve from the domain root" (custom domains, <user>.github.io repos).
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');
// Runtime asset URLs (models, audio, UI images) read the same normalized value.
process.env.NEXT_PUBLIC_BASE_PATH = basePath;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // GitHub Pages serves /foo as /foo/index.html; trailing slashes keep links working.
  trailingSlash: true,
  images: {
    // No image optimization server in a static export.
    unoptimized: true,
  },
  // Pin the workspace root (a stray lockfile higher up the tree confuses detection).
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
