// Minimal, dependency-free SFNT reader (TTF / OTF / TTC / OTC).
// Reads only what the browser needs: names, weight/style, panose, fixed-pitch and cmap coverage.
// Reads table slices straight from disk, never the whole file.

import { open } from 'node:fs/promises';
import { LANGS, classifyByName } from '../../shared/languages.js';

const MAX_CMAP_BYTES = 4 * 1024 * 1024;
const MAX_NAME_BYTES = 512 * 1024;
const MAX_FACES = 64;
const utf16be = new TextDecoder('utf-16be');

async function readAt(fh, offset, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

function parseNames(buf) {
  if (buf.length < 6) return {};
  const count = buf.readUInt16BE(2);
  const strOff = buf.readUInt16BE(4);
  const best = {}; // nameID -> { score, value }
  for (let i = 0; i < count; i++) {
    const p = 6 + i * 12;
    if (p + 12 > buf.length) break;
    const pid = buf.readUInt16BE(p), lang = buf.readUInt16BE(p + 4), id = buf.readUInt16BE(p + 6);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    const len = buf.readUInt16BE(p + 8), off = strOff + buf.readUInt16BE(p + 10);
    if (off + len > buf.length || len === 0) continue;
    let score, value;
    const raw = buf.subarray(off, off + len);
    if (pid === 3 || pid === 0) {
      score = pid === 3 ? (lang === 0x409 ? 4 : (lang & 0xff) === 0x09 ? 3 : 1) : 2;
      value = utf16be.decode(raw);
    } else if (pid === 1) {
      score = lang === 0 ? 2 : 0;
      value = raw.toString('latin1');
    } else continue;
    value = value.replace(/\0/g, '').trim();
    if (!value) continue;
    if (!best[id] || score > best[id].score) best[id] = { score, value };
  }
  const out = {};
  for (const id of Object.keys(best)) out[id] = best[id].value;
  return out;
}

/** Returns sorted, merged [start, end] codepoint ranges plus a symbol-encoding flag. */
function parseCmap(buf) {
  if (buf.length < 4) return { ranges: [], symbol: false };
  const n = buf.readUInt16BE(2);
  let best = -1, bestOff = 0, symbol = false;
  for (let i = 0; i < n; i++) {
    const p = 4 + i * 8;
    if (p + 8 > buf.length) break;
    const pid = buf.readUInt16BE(p), eid = buf.readUInt16BE(p + 2), off = buf.readUInt32BE(p + 4);
    if (off + 16 > buf.length) continue;
    const fmt = buf.readUInt16BE(off);
    if (pid === 3 && eid === 0) symbol = true;
    let score = -1;
    if (fmt === 12 && (pid === 0 || (pid === 3 && eid === 10))) score = 3;
    else if (fmt === 4 && (pid === 0 || (pid === 3 && eid === 1))) score = 2;
    if (score > best) { best = score; bestOff = off; }
  }
  const ranges = [];
  if (best === 3) {
    const groups = buf.readUInt32BE(bestOff + 12);
    for (let i = 0; i < groups; i++) {
      const p = bestOff + 16 + i * 12;
      if (p + 12 > buf.length) break;
      ranges.push([buf.readUInt32BE(p), buf.readUInt32BE(p + 4)]);
    }
  } else if (best === 2) {
    const segX2 = buf.readUInt16BE(bestOff + 6);
    const endOff = bestOff + 14, startOff = endOff + segX2 + 2;
    for (let i = 0; i < segX2; i += 2) {
      if (startOff + i + 2 > buf.length) break;
      const s = buf.readUInt16BE(startOff + i), e = buf.readUInt16BE(endOff + i);
      if (s !== 0xffff) ranges.push([s, e]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { ranges, symbol: symbol && best < 0 };
}

function hasCodepoint(ranges, cp) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

export function detectLangs(ranges) {
  return LANGS.filter((l) => l.cps.every((cp) => hasCodepoint(ranges, cp))).map((l) => l.id);
}

function classify(name, face) {
  const p = face.panose || [0, 0, 0, 0];
  if (face.symbol || p[0] === 5) return 'symbol';
  const byName = classifyByName(name);
  if (byName) return byName;
  if (p[0] === 3) return 'hand';
  if (face.fixed || p[3] === 9) return 'mono';
  if (p[0] === 4) return 'display';
  if (p[0] === 2 && p[1] >= 11 && p[1] <= 15) return 'sans';
  if (p[0] === 2 && p[1] >= 2 && p[1] <= 10) return 'serif';
  return 'other';
}

async function parseFace(fh, faceOffset, tableCache) {
  const head = await readAt(fh, faceOffset, 12);
  if (head.length < 12) return null;
  const numTables = head.readUInt16BE(4);
  if (numTables === 0 || numTables > 512) return null;
  const dir = await readAt(fh, faceOffset + 12, numTables * 16);
  const tables = {};
  for (let i = 0; i + 16 <= dir.length; i += 16) {
    tables[dir.toString('latin1', i, i + 4)] = [dir.readUInt32BE(i + 8), dir.readUInt32BE(i + 12)];
  }
  const table = async (tag, cap) => {
    const t = tables[tag];
    if (!t) return null;
    const key = `${tag}@${t[0]}`;
    if (!tableCache.has(key)) tableCache.set(key, await readAt(fh, t[0], Math.min(t[1], cap)));
    return tableCache.get(key);
  };

  const nameBuf = await table('name', MAX_NAME_BYTES);
  if (!nameBuf) return null;
  const names = parseNames(nameBuf);
  const family = names[16] || names[1];
  if (!family) return null;

  const face = {
    family,
    style: names[17] || names[2] || 'Regular',
    fullName: names[4] || family,
    postscriptName: names[6] || '',
    weight: 400, italic: false, panose: null, fixed: false, symbol: false, langs: [],
  };

  const os2 = await table('OS/2', 96);
  if (os2 && os2.length >= 64) {
    const w = os2.readUInt16BE(4);
    if (w >= 1 && w <= 1000) face.weight = w;
    face.panose = [os2[32], os2[33], os2[34], os2[35]];
    face.italic = (os2.readUInt16BE(62) & 0x201) !== 0;
  }
  const post = await table('post', 16);
  if (post && post.length >= 16) face.fixed = post.readUInt32BE(12) !== 0;

  const cmapBuf = await table('cmap', MAX_CMAP_BYTES);
  if (cmapBuf) {
    const { ranges, symbol } = parseCmap(cmapBuf);
    face.symbol = symbol;
    face.langs = detectLangs(ranges);
  }
  face.category = classify(`${face.family} ${face.fullName}`, face);
  return face;
}

/**
 * Parse every face in a font file.
 * @returns {Promise<Array<object>>} faces (empty when the file is not a readable SFNT font)
 */
export async function parseFontFile(filePath) {
  let fh;
  try {
    fh = await open(filePath, 'r');
    const sig = await readAt(fh, 0, 16);
    if (sig.length < 12) return [];
    const tag = sig.readUInt32BE(0);
    const offsets = [];
    if (tag === 0x74746366) { // 'ttcf'
      const n = Math.min(sig.readUInt32BE(8), MAX_FACES);
      const tbl = await readAt(fh, 12, n * 4);
      for (let i = 0; i + 4 <= tbl.length; i += 4) offsets.push(tbl.readUInt32BE(i));
    } else if (tag === 0x00010000 || tag === 0x4f54544f || tag === 0x74727565) {
      offsets.push(0);
    } else return [];

    const cache = new Map();
    const faces = [];
    for (let i = 0; i < offsets.length; i++) {
      try {
        const face = await parseFace(fh, offsets[i], cache);
        if (face) faces.push({ ...face, ttcIndex: i, collection: offsets.length > 1 });
      } catch { /* one broken face must not hide the others */ }
    }
    return faces;
  } catch {
    return [];
  } finally {
    await fh?.close().catch(() => {});
  }
}
