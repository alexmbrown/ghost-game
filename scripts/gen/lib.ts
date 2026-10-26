// Shared plumbing for the asset generators (scripts/gen/*.ts).
//
// Keys are read, in order, from: process.env, ./.env.local, then the file named
// by GHOST_SECRETS_FILE (default: %USERPROFILE%/.clean-factory/secrets.env —
// the same secrets file the clean-factory generators use). Keys are never
// printed and never accepted on the command line.
//
// Every generator is idempotent: an output that already exists is skipped, so
// a re-run never pays twice. Each output gets a .json sidecar with the exact
// request (prompt, model, params) so any asset can be reproduced or traced.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const ROOT = join(__dirname, '..', '..');

export interface Asset {
  id: string;
  kind: string;
  generator: string;
  priority: 'p0' | 'p1' | 'p2';
  status: string;
  output: string | string[];
  prompt: string;
  params?: Record<string, unknown>;
  dependsOn?: string[];
  notes?: string;
  [k: string]: unknown;
}

export interface Manifest {
  /** Prefix for character / prop prompts. */
  styleGuide: string;
  /** Prefixes for the other image kinds (texture, sky, vfx, cutout, ui, scene). */
  styles?: Record<string, string>;
  assets: Asset[];
  [k: string]: unknown;
}

const MANIFEST = join(ROOT, 'assets', 'manifest.json');

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST, 'utf-8')) as Manifest;
}

/** Re-read and patch statuses so concurrent edits to other fields aren't clobbered. */
export function markStatus(ids: string[], status: string): void {
  if (!ids.length) return;
  const m = loadManifest();
  const set = new Set(ids);
  for (const a of m.assets) if (set.has(a.id) && a.status === 'todo') a.status = status;
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}

export const outputs = (a: Asset): string[] => (Array.isArray(a.output) ? a.output : [a.output]);
export const exists = (rel: string): boolean => existsSync(join(ROOT, rel));

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

let cached: Record<string, string> | null = null;
export function key(name: 'GEMINI_API_KEY' | 'ELEVENLABS_API_KEY' | 'MESHY_API_KEY'): string {
  if (!cached) {
    cached = {};
    const secrets = process.env.GHOST_SECRETS_FILE ?? join(process.env.USERPROFILE ?? homedir(), '.clean-factory', 'secrets.env');
    for (const file of [secrets, join(ROOT, '.env.local')]) {
      if (existsSync(file)) Object.assign(cached, parseEnv(readFileSync(file, 'utf-8')));
    }
  }
  const v = process.env[name] || cached[name];
  if (!v) throw new Error(`${name} not found (env, .env.local, or GHOST_SECRETS_FILE)`);
  return v;
}

export function writeOut(rel: string, data: Buffer | Uint8Array, sidecar: Record<string, unknown>): void {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  writeFileSync(abs.replace(/\.[a-z0-9]+$/i, '.json'), JSON.stringify({ ...sidecar, bytes: data.byteLength, created: new Date().toISOString() }, null, 1) + '\n');
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/** fetch with timeout + retries on 429/5xx/network errors. Never logs headers. */
export async function request(url: string, init: RequestInit, opts: { timeoutMs?: number; retries?: number } = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 180_000);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      if (res.ok) return res;
      const body = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        last = new HttpError(res.status, body);
        await sleep(4000 * (attempt + 1));
        continue;
      }
      throw new HttpError(res.status, body);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      last = e;
      if (attempt < retries) await sleep(4000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run tasks with a concurrency limit; stops launching new work once `abort()` is called. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && !aborted) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

let aborted = false;
export function abort(reason: string): void {
  if (!aborted) console.error(`\n!! stopping: ${reason}`);
  aborted = true;
}
export const isAborted = () => aborted;

/** Fatal API errors (auth, quota) stop the whole run instead of failing every item. */
export function isFatal(e: unknown): boolean {
  if (!(e instanceof HttpError)) return false;
  // A prompt blocked by a safety filter only fails that one asset.
  if (/blocked_generation|safety/i.test(e.body)) return false;
  if (e.status === 401 || e.status === 402 || e.status === 403) return true;
  return /quota|insufficient|credits|billing/i.test(e.body);
}

export function parseArgs(argv: string[]): { only: string[]; prio: Set<string> | null; dry: boolean; flags: Set<string> } {
  const only: string[] = [];
  const flags = new Set<string>();
  let prio: Set<string> | null = null;
  for (const a of argv) {
    if (a.startsWith('--prio=')) prio = new Set(a.slice(7).split(','));
    else if (a.startsWith('--')) flags.add(a.slice(2));
    else only.push(a);
  }
  return { only, prio, dry: flags.has('dry'), flags };
}

export function selected(a: Asset, only: string[], prio: Set<string> | null): boolean {
  if (prio && !prio.has(a.priority)) return false;
  return only.length === 0 || only.some((o) => a.id.startsWith(o) || a.kind === o);
}
