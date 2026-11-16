// Enumerates fonts installed on this machine by walking the OS font folders and parsing each file.
// Per-file results are cached on disk (keyed by path + mtime + size) so rescans are near-instant.

import { readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parseFontFile } from './sfnt.js';
import { langPriority } from '../../shared/languages.js';

const FONT_EXT = new Set(['.ttf', '.otf', '.ttc', '.otc']);
const MAX_DEPTH = 6;
const CONCURRENCY = 16;
const CACHE_VERSION = 2;

/** @returns {Array<{dir: string, anyExt?: boolean}>} */
export function fontDirectories(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    const win = env.WINDIR || env.SystemRoot || 'C:\\Windows';
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      { dir: path.join(win, 'Fonts') },
      { dir: path.join(local, 'Microsoft', 'Windows', 'Fonts') },
      { dir: path.join(roaming, 'Adobe', 'CoreSync', 'plugins', 'livetype'), anyExt: true }, // Adobe Fonts sync
    ];
  }
  if (platform === 'darwin') {
    return [
      { dir: '/System/Library/Fonts' },
      { dir: '/Library/Fonts' },
      { dir: path.join(home, 'Library', 'Fonts') },
      { dir: path.join(home, 'Library', 'Application Support', 'Adobe', 'CoreSync', 'plugins', 'livetype'), anyExt: true },
    ];
  }
  return [
    { dir: '/usr/share/fonts' },
    { dir: '/usr/local/share/fonts' },
    { dir: path.join(home, '.fonts') },
    { dir: path.join(home, '.local', 'share', 'fonts') },
  ];
}

async function walk(dir, anyExt, depth, out) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH) await walk(full, anyExt, depth + 1, out);
    } else if (e.isFile() || e.isSymbolicLink()) {
      const ext = path.extname(e.name).toLowerCase();
      if (FONT_EXT.has(ext) || (anyExt && ext === '')) out.push(full);
    }
  }
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

const shortId = (s) => createHash('sha1').update(s).digest('hex').slice(0, 14);

function pickDefaultFace(faces) {
  return [...faces].sort((a, b) =>
    (a.italic - b.italic) || (Math.abs(a.weight - 400) - Math.abs(b.weight - 400)))[0];
}

function groupFamilies(faces) {
  const map = new Map();
  for (const f of faces) {
    const key = f.family.toLowerCase();
    if (!map.has(key)) map.set(key, { family: f.family, faces: [], seen: new Set() });
    const fam = map.get(key);
    const dedupe = `${f.fullName}|${f.weight}|${f.italic}`;
    if (fam.seen.has(dedupe)) continue;
    fam.seen.add(dedupe);
    fam.faces.push(f);
  }
  const families = [];
  for (const fam of map.values()) {
    fam.faces.sort((a, b) => (a.weight - b.weight) || (a.italic - b.italic));
    const def = pickDefaultFace(fam.faces);
    families.push({
      id: `local:${shortId(fam.family.toLowerCase())}`,
      source: 'local',
      name: fam.family,
      langs: [...new Set(fam.faces.flatMap((f) => f.langs))],
      category: def.category,
      defaultFace: def.id,
      faces: fam.faces.map((f) => ({
        id: f.id, style: f.style, weight: f.weight, italic: f.italic,
        fullName: f.fullName, postscriptName: f.postscriptName,
        // A single face inside a .ttc cannot be addressed by URL, so those rely on local() only.
        loadable: !f.collection,
      })),
    });
  }
  families.sort((a, b) => (langPriority(a.langs) - langPriority(b.langs)) || a.name.localeCompare(b.name));
  return families;
}

/**
 * @param {object} opts
 * @param {string} opts.cacheFile  absolute path of the JSON cache
 * @param {boolean} [opts.force]   ignore the cache and reparse everything
 * @param {(done:number,total:number)=>void} [opts.onProgress]
 * @param {Array} [opts.dirs]      override the OS font folders (tests)
 * @returns {Promise<{families: Array, files: Map<string,string>, fileCount: number}>}
 */
export async function scanLocalFonts({ cacheFile, force = false, onProgress, dirs } = {}) {
  const roots = dirs || fontDirectories();
  const paths = [];
  for (const r of roots) await walk(r.dir, !!r.anyExt, 0, paths);
  const unique = [...new Set(paths)];

  let cache = {};
  if (cacheFile && !force) {
    try {
      const raw = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (raw.version === CACHE_VERSION) cache = raw.entries || {};
    } catch { /* no cache yet */ }
  }

  const entries = {};
  const faces = [];
  let done = 0;
  await mapLimit(unique, CONCURRENCY, async (file) => {
    try {
      const st = await stat(file);
      const sig = `${st.mtimeMs}|${st.size}`;
      const hit = cache[file];
      const parsed = hit && hit.sig === sig ? hit.faces : await parseFontFile(file);
      entries[file] = { sig, faces: parsed };
      for (const f of parsed) faces.push({ ...f, file, id: shortId(`${file}#${f.ttcIndex}`) });
    } catch { /* unreadable file: skip */ }
    done++;
    if (onProgress && (done % 25 === 0 || done === unique.length)) onProgress(done, unique.length);
  });

  if (cacheFile) {
    try {
      await mkdir(path.dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, JSON.stringify({ version: CACHE_VERSION, entries }));
    } catch { /* cache is best-effort */ }
  }

  const files = new Map(faces.map((f) => [f.id, f.file]));
  return { families: groupFamilies(faces), files, fileCount: unique.length };
}
