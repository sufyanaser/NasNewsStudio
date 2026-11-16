import { app, BrowserWindow, ipcMain, protocol, session, shell } from 'electron';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLocalFonts } from './fonts/local-scan.js';
import { configureHttp, fetchBinary } from './sources/http.js';
import { installFontFiles, fontsFromDownload } from './fonts/install.js';
import { listGoogle, googleFontFiles } from './sources/google.js';
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

/* ---------- install: source page window + download capture ---------- */
// Hosts whose font pages may be opened in the in-app download window.
const PAGE_HOSTS = ['alfont.com', 'fonnts.com'];
// Development only (never honoured in a packaged build): extra "host:port" entries for local testing.
const DEV_PAGE_HOSTS = app.isPackaged ? [] : (process.env.NAS_FONT_STUDIO_DEV_HOSTS || '').split(',').filter(Boolean);
const DOWNLOAD_EXT = new Set(['.ttf', '.otf', '.ttc', '.otc', '.zip']);
const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;
let pageWin = null;
let pendingInstall = null; // { id, name }

function isSourcePage(raw) {
  try {
    const u = new URL(raw);
    if (DEV_PAGE_HOSTS.includes(u.host)) return true;
    return u.protocol === 'https:' && PAGE_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

function finishInstall(payload) {
  const job = pendingInstall;
  pendingInstall = null;
  if (job) win?.webContents.send('install:event', { id: job.id, ...payload });
  if (pageWin && !pageWin.isDestroyed()) pageWin.close();
}

function onSourceDownload(event, item) {
  const name = item.getFilename();
  const ext = path.extname(name).toLowerCase();
  if (!pendingInstall) { event.preventDefault(); return; }
  if (!DOWNLOAD_EXT.has(ext) || item.getTotalBytes() > MAX_DOWNLOAD_BYTES) {
    event.preventDefault();
    finishInstall({ status: 'error', message: `نوع الملف غير مدعوم للتنصيب المباشر (${name}). حمّله من صفحة الخط في المتصفح.` });
    return;
  }
  const tmp = path.join(app.getPath('temp'), `nfs-dl-${Date.now()}${ext}`);
  item.setSavePath(tmp);
  item.once('done', async (_e, state) => {
    try {
      if (state !== 'completed') throw new Error('لم يكتمل التحميل');
      const res = await installFontFiles(fontsFromDownload(name, await readFile(tmp)));
      if (!res.installed.length) throw new Error('لا يوجد ملف خط صالح داخل التحميل');
      log(`installed ${res.installed.length} file(s) from ${name}`);
      finishInstall({ status: 'done', count: res.installed.length, families: [...new Set(res.installed.map((i) => i.family))] });
    } catch (err) {
      log('install failed:', err.message);
      finishInstall({ status: 'error', message: err.message });
    } finally {
      rm(tmp, { force: true }).catch(() => {});
    }
  });
}

function openSourcePage(job, url) {
  // Isolated in-memory session: no access to the app, its storage, or node.
  const ses = session.fromPartition('source-pages');
  if (!ses.listenerCount('will-download')) {
    ses.on('will-download', onSourceDownload);
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  }
  if (pageWin && !pageWin.isDestroyed()) { pendingInstall = null; pageWin.close(); }
  pendingInstall = job;
  pageWin = new BrowserWindow({
    width: 1100, height: 820, parent: win ?? undefined, autoHideMenuBar: true, backgroundColor: '#ffffff',
    title: `تنصيب: ${job.name}`,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const thisWin = pageWin;
  // Pop-ups (ads) are refused; a same-site link that wants a new tab is opened in place.
  thisWin.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isSourcePage(target)) thisWin.loadURL(target);
    return { action: 'deny' };
  });
  thisWin.on('closed', () => {
    if (pageWin === thisWin) pageWin = null;
    if (pendingInstall === job) finishInstall({ status: 'cancelled' });
  });
  thisWin.loadURL(url).catch((err) => { if (pendingInstall === job) finishInstall({ status: 'error', message: err.message }); });
}

async function installGoogle(name, variants) {
  const files = await googleFontFiles(name, variants);
  const payload = [];
  for (const f of files) payload.push({ name: f.name, data: await fetchBinary(f.url, ['fonts.gstatic.com']) });
  const res = await installFontFiles(payload);
  if (!res.installed.length) throw new Error('لم يُنصَّب أي ملف');
  log(`installed ${res.installed.length} file(s) for ${name}`);
  return { status: 'done', count: res.installed.length, families: [...new Set(res.installed.map((i) => i.family))] };
}

function registerIpc() {
  ipcMain.handle('fonts:install', async (_e, item) => {
    const name = typeof item?.name === 'string' ? item.name.slice(0, 200) : '';
    const id = typeof item?.id === 'string' ? item.id.slice(0, 600) : '';
    if (!name || !id) throw new Error('طلب غير صالح');
    if (item.source === 'google') {
      const variants = Array.isArray(item.variants) ? item.variants.filter((v) => typeof v === 'string').slice(0, 40) : [];
      return installGoogle(name, variants);
    }
    if (item.source === 'alfont') {
      if (!isSourcePage(item.url)) throw new Error('رابط غير مسموح');
      openSourcePage({ id, name }, item.url);
      return { status: 'pending' };
    }
    throw new Error('هذا المصدر لا يدعم التنصيب المباشر');
  });

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
