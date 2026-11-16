import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLocalFonts } from './fonts/local-scan.js';
import { configureHttp } from './sources/http.js';
import { listGoogle } from './sources/google.js';
import { listAlfont } from './sources/alfont.js';
import { listAndalusi } from './sources/andalusi.js';
import { createAggregator } from './sources/all.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(__dirname, '..', 'renderer', 'index.html');
const EXTERNAL_HOSTS = ['alfont.com', 'andalusi.app', 'fonts.google.com'];
const aggregator = createAggregator({ google: listGoogle, alfont: listAlfont, andalusi: listAndalusi });
const SOURCES = {
  google: listGoogle, alfont: listAlfont, andalusi: listAndalusi,
  all: (params) => aggregator.list({ ...params, onProgress: (p) => win?.webContents.send('source:progress', p) }),
};

/** faceId -> absolute font file path. Only files found by the scanner can ever be served. */
let fontFiles = new Map();
let scanInFlight = null;
let win = null;

const log = (...a) => console.log('[nas-font-studio]', ...a);

protocol.registerSchemesAsPrivileged([
  { scheme: 'nasfont', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function registerFontProtocol() {
  protocol.handle('nasfont', async (request) => {
    const headers = { 'access-control-allow-origin': '*' };
    try {
      const id = new URL(request.url).pathname.replace(/^\//, '');
      const file = fontFiles.get(id);
      if (!file) return new Response('not found', { status: 404, headers });
      const data = await readFile(file);
      return new Response(data, { headers: { ...headers, 'content-type': 'font/sfnt', 'cache-control': 'max-age=86400' } });
    } catch (err) {
      log('font read failed:', err.message);
      return new Response('error', { status: 500, headers });
    }
  });
}

function isAllowedExternal(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && EXTERNAL_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

function registerIpc() {
  ipcMain.handle('fonts:scan', async (_e, opts) => {
    if (!scanInFlight) {
      const started = Date.now();
      scanInFlight = scanLocalFonts({
        cacheFile: path.join(app.getPath('userData'), 'local-fonts-cache.json'),
        force: !!opts?.force,
        onProgress: (done, total) => win?.webContents.send('fonts:progress', { done, total }),
      }).then((res) => {
        fontFiles = res.files;
        log(`scanned ${res.fileCount} files -> ${res.families.length} families in ${Date.now() - started}ms`);
        return { families: res.families, fileCount: res.fileCount };
      }).finally(() => { scanInFlight = null; });
    }
    return scanInFlight;
  });

  ipcMain.handle('source:list', async (_e, id, params) => {
    const fn = SOURCES[id];
    if (!fn) throw new Error('مصدر غير معروف');
    try {
      return await fn(params && typeof params === 'object' ? params : {});
    } catch (err) {
      log(`source ${id} failed:`, err.message);
      throw err;
    }
  });

  ipcMain.handle('shell:open', async (_e, url) => {
    if (!isAllowedExternal(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('shell:reveal', (_e, faceId) => {
    const file = fontFiles.get(String(faceId));
    if (!file) return false;
    shell.showItemInFolder(file);
    return true;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 420, minHeight: 560,
    backgroundColor: '#070708',
    title: 'NAS Font Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  // The window only ever shows the bundled UI; every other destination goes to the OS browser (allowlisted).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
  win.loadFile(RENDERER);
}

app.whenReady().then(() => {
  configureHttp({ dir: path.join(app.getPath('userData'), 'http-cache') });
  registerFontProtocol();
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
