// Per-user font installation (no admin rights): copies validated font files into the user's font
// folder and registers them with the OS where that is required.

import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { parseFontFile } from './sfnt.js';
import { extractFontsFromZip, isZip } from './zip.js';

const run = promisify(execFile);
const FONT_EXT = new Set(['.ttf', '.otf', '.ttc', '.otc']);
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const WIN_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';

export function userFontDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts');
  if (platform === 'darwin') return path.join(home, 'Library', 'Fonts');
  return path.join(home, '.local', 'share', 'fonts');
}

/** Keeps letters/digits (any script), space, dot, dash, underscore; everything else is dropped. */
export function safeFileName(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const ext = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - ext.length).replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80);
  return FONT_EXT.has(ext) && stem ? `${stem}${ext}` : null;
}

/** A downloaded payload is either a font file or a zip of font files. */
export function fontsFromDownload(fileName, data) {
  if (isZip(data)) return extractFontsFromZip(data);
  return [{ name: fileName, data }];
}

/**
 * Validate and install font files for the current user.
 * @param {Array<{name: string, data: Buffer}>} files
 * @param {{dir?: string, platform?: string}} [opts]  overrides for tests
 * @returns {Promise<{installed: Array<{file: string, family: string, fullName: string}>, skipped: string[], dir: string}>}
 */
export async function installFontFiles(files, opts = {}) {
  const platform = opts.platform || process.platform;
  const dir = opts.dir || userFontDir(platform);
  const installed = [];
  const skipped = [];
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nfs-'));
  try {
    await mkdir(dir, { recursive: true });
    for (const f of files) {
      const name = safeFileName(f.name);
      if (!name || !Buffer.isBuffer(f.data) || f.data.length === 0 || f.data.length > MAX_FILE_BYTES) { skipped.push(String(f.name)); continue; }
      // Parse from a temp copy first: only real, readable fonts ever reach the font folder.
      const probe = path.join(tmp, name);
      await writeFile(probe, f.data);
      const faces = await parseFontFile(probe);
      if (!faces.length) { skipped.push(name); continue; }

      const dest = path.join(dir, name);
      await writeFile(dest, f.data);
      if (platform === 'win32') {
        const label = `${faces[0].fullName} (${path.extname(name).toLowerCase() === '.otf' ? 'OpenType' : 'TrueType'})`;
        await run('reg', ['add', WIN_REG_KEY, '/v', label, '/t', 'REG_SZ', '/d', dest, '/f'], { windowsHide: true });
      }
      installed.push({ file: dest, family: faces[0].family, fullName: faces[0].fullName });
    }
    if (platform === 'linux' && installed.length && !opts.dir) {
      await run('fc-cache', ['-f', dir]).catch(() => {}); // best-effort
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  return { installed, skipped, dir };
}
