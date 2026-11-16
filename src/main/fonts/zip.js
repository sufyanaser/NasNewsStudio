// Minimal ZIP reader: pulls font files out of an archive held in memory. No dependencies.
// Only stored (0) and deflate (8) entries are supported, which covers ordinary font archives.

import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

const FONT_EXT = new Set(['.ttf', '.otf', '.ttc', '.otc']);
const MAX_ENTRIES = 2000;
const MAX_FONTS = 60;
const MAX_FONT_BYTES = 40 * 1024 * 1024;

export const isZip = (buf) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;

/** @returns {Array<{name: string, data: Buffer}>} font files found in the archive (base names only) */
export function extractFontsFromZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ملف ZIP غير صالح');
  const count = Math.min(buf.readUInt16LE(eocd + 10), MAX_ENTRIES);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];

  for (let i = 0; i < count && out.length < MAX_FONTS; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    p += 46 + nameLen + extraLen + commentLen;

    // Base name only: an archive can never write outside the install folder.
    const base = path.posix.basename(rawName.replace(/\\/g, '/'));
    const ext = path.extname(base).toLowerCase();
    if (!FONT_EXT.has(ext) || base.startsWith('.') || rawName.includes('__MACOSX')) continue;
    if (flags & 0x1) continue;                         // encrypted
    if (size > MAX_FONT_BYTES || (method !== 0 && method !== 8)) continue;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) continue;

    const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    if (start + compSize > buf.length) continue;
    const raw = buf.subarray(start, start + compSize);
    try {
      const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: MAX_FONT_BYTES });
      out.push({ name: base, data });
    } catch { /* corrupt entry: skip it, keep the rest */ }
  }
  return out;
}
