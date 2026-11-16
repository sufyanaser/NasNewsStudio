// Polite HTTP client for the catalog sources: timeout, per-host throttle, on-disk cache with stale fallback.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const USER_AGENT = 'NasFontStudio/1.0 (desktop font browser)';
const TIMEOUT_MS = 20_000;
const MIN_GAP_MS = 1_000; // at most one request per second per host
const MAX_BYTES = 12 * 1024 * 1024;

let cacheDir = null;
const lastHit = new Map();

export function configureHttp({ dir }) { cacheDir = dir; }

const cachePath = (url) => path.join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);

async function readCache(url) {
  if (!cacheDir) return null;
  try { return JSON.parse(await readFile(cachePath(url), 'utf8')); } catch { return null; }
}

async function throttle(host) {
  const wait = (lastHit.get(host) || 0) + MIN_GAP_MS - Date.now();
  lastHit.set(host, Date.now() + Math.max(0, wait));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * GET a text resource. Serves from cache while fresh; on network failure falls back to a stale copy.
 * @returns {Promise<{body: string, stale: boolean, fetchedAt: number}>}
 */
export async function fetchText(url, { ttlMs = 24 * 3600_000, force = false } = {}) {
  const cached = await readCache(url);
  if (cached && !force && Date.now() - cached.fetchedAt < ttlMs) return { ...cached, stale: false };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    await throttle(new URL(url).host);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json;q=0.9,*/*;q=0.5' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > MAX_BYTES) throw new Error('response too large');
    const entry = { body, fetchedAt: Date.now() };
    if (cacheDir) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath(url), JSON.stringify(entry)).catch(() => {});
    }
    return { ...entry, stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    throw new Error(`تعذّر الاتصال بـ ${new URL(url).host}: ${err.name === 'AbortError' ? 'انتهت المهلة' : err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Only https URLs on an expected host survive; anything else becomes null. */
export function safeUrl(raw, base, allowedHosts) {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'https:') return null;
    if (!allowedHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return null;
    return u.href;
  } catch { return null; }
}
