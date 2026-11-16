import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFontFile } from '../src/main/fonts/sfnt.js';
import { scanLocalFonts, fontDirectories } from '../src/main/fonts/local-scan.js';
import { parseGoogleMetadata } from '../src/main/sources/google.js';
import { parseAlfontListing } from '../src/main/sources/alfont.js';
import { parseAndalusi } from '../src/main/sources/andalusi.js';
import { safeUrl, decodeHtml } from '../src/main/sources/http.js';
import { langPriority, classifyByName } from '../src/shared/languages.js';

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'fonts');

test('sfnt: reads names, weight and Arabic coverage', async () => {
  const [face] = await parseFontFile(path.join(FONTS, 'IBMPlexSansArabic-Bold.ttf'));
  assert.equal(face.family, 'IBM Plex Sans Arabic');
  assert.equal(face.weight, 700);
  assert.equal(face.italic, false);
  assert.ok(face.langs.includes('ar'));
  assert.ok(face.langs.includes('en'));
});

test('sfnt: non-font file yields no faces', async () => {
  assert.deepEqual(await parseFontFile(fileURLToPath(import.meta.url)), []);
  assert.deepEqual(await parseFontFile('/nonexistent/file.ttf'), []);
});

test('scan: groups faces into one family, Arabic-first', async () => {
  const { families, files, fileCount } = await scanLocalFonts({ dirs: [{ dir: FONTS }] });
  assert.equal(fileCount, 4);
  assert.equal(families.length, 1);
  const fam = families[0];
  assert.equal(fam.faces.length, 4);
  assert.deepEqual(fam.faces.map((f) => f.weight), [400, 500, 600, 700]);
  assert.equal(fam.faces.find((f) => f.id === fam.defaultFace).weight, 400);
  assert.ok(files.get(fam.defaultFace).endsWith('IBMPlexSansArabic-Regular.ttf'));
});

test('scan: platform font folders', () => {
  const win = fontDirectories('win32', { WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\U\\L', APPDATA: 'C:\\U\\R' }, 'C:\\U');
  assert.ok(win[0].dir.includes('Windows'));
  assert.ok(win.some((d) => d.dir.includes('Microsoft')));
  assert.ok(fontDirectories('darwin', {}, '/Users/x').some((d) => d.dir === '/Library/Fonts'));
});

test('google: maps subsets to languages and sorts Arabic first', () => {
  const body = ")]}'\n" + JSON.stringify({ familyMetadataList: [
    { family: 'Roboto', category: 'Sans Serif', subsets: ['menu', 'latin', 'cyrillic'], fonts: { 400: {}, 700: {} }, popularity: 1 },
    { family: 'Reem Kufi', category: 'Sans Serif', subsets: ['arabic', 'latin'], fonts: { 400: {} }, popularity: 300 },
    { family: 'Menu Only', category: 'Serif', subsets: ['menu'], fonts: {} },
  ] });
  const items = parseGoogleMetadata(body);
  assert.deepEqual(items.map((i) => i.name), ['Reem Kufi', 'Roboto']);
  assert.equal(items[0].category, 'kufi');
  assert.deepEqual(items[1].langs, ['en', 'ru']);
  assert.equal(items[0].url, 'https://fonts.google.com/specimen/Reem+Kufi');
});

test('alfont: parses cards, rejects foreign hosts, detects next page', () => {
  const card = (href, name, img) => `<div class="card card-post"><a class="card-header pb-0 m-0 " href="${href}" title="x"><h1>${name} <i class="fas"></i></h1></a>
    <div><a href="${href}"><img class="img-responsive postimgloop m-0 imgthisfont-1" src="${img}" alt="${name}" ></a></div></div>`;
  const html = card('https://alfont.com/a-font.html', 'Zain &amp; Co', 'https://alfont.com/t/a.png')
    + card('https://evil.example/x.html', 'Bad', 'https://alfont.com/t/b.png')
    + '<a href="https://alfont.com/page/2">2</a>';
  const { items, hasMore } = parseAlfontListing(html, { section: 'naskh', page: 1 });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Zain & Co');
  assert.equal(items[0].category, 'naskh');
  assert.deepEqual(items[0].langs, ['ar']);
  assert.equal(hasMore, true);
  assert.equal(parseAlfontListing(html, { page: 2 }).hasMore, false);
});

test('andalusi: parses cards and tags language from category', () => {
  const card = (slug, img, a, b, cat) => `<a href="/fonts/${slug}" class="group" data-desktop-href="https://design.andalusi.app/x"><div class="h-16"><img src="${img}" alt="${a}" loading="lazy" class="x"></div><p class="t">${a}</p><p class="t">${b}</p><span class="s">${cat}</span></a>`;
  const html = card('Abel', 'https://storage.andalusi.app/f/a@2x.png', 'Abel', 'Abel', 'Sans Serif')
    + card('راكان', 'https://storage.andalusi.app/f/b.png', 'راكان', 'Rakan', 'الكوفي')
    + card('x', 'http://storage.andalusi.app/insecure.png', 'X', 'X', 'Serif');
  const items = parseAndalusi(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'راكان');
  assert.deepEqual(items[0].langs, ['ar']);
  assert.equal(items[0].category, 'kufi');
  assert.equal(items[0].altName, 'Rakan');
  assert.deepEqual(items[1].langs, ['en']);
});

test('helpers', () => {
  assert.equal(safeUrl('javascript:alert(1)', 'https://alfont.com', ['alfont.com']), null);
  assert.equal(safeUrl('/x', 'https://alfont.com', ['alfont.com']), 'https://alfont.com/x');
  assert.equal(safeUrl('https://notalfont.com/x', 'https://alfont.com', ['alfont.com']), null);
  assert.equal(decodeHtml('<b>A&amp;B</b> &#1575;'), 'A&B ا');
  assert.ok(langPriority(['en', 'ar']) < langPriority(['en']));
  assert.equal(classifyByName('Noto Kufi Arabic'), 'kufi');
  assert.equal(classifyByName('Whatever'), null);
});

test('all: merges sources without duplicates and fills to the Arabic target', async () => {
  const { createAggregator, normalizeKey } = await import('../src/main/sources/all.js');
  assert.equal(normalizeKey('Reem-Kufi  '), normalizeKey('reem kufi'));
  assert.equal(normalizeKey('خـط الـمشرف'), normalizeKey('خط المشرف'));
  const mk = (source, name, lang = 'ar', altName = '') => ({ id: `${source}:${name}`, source, name, altName, langs: [lang], category: 'other' });
  let calls = 0;
  const agg = createAggregator({
    google: async () => ({ items: [mk('google', 'Cairo'), mk('google', 'Roboto', 'en'), mk('google', 'Rakan')] }),
    andalusi: async () => ({ items: [mk('andalusi', 'راكان', 'ar', 'RAKAN'), mk('andalusi', 'cairo'), mk('andalusi', 'سميك', 'ar', 'Sameek')] }),
    alfont: async ({ page }) => {
      calls++;
      // every page repeats one earlier name -> must be dropped
      return { items: [mk('alfont', 'Sameek'), ...Array.from({ length: 10 }, (_, i) => mk('alfont', `AF ${page}-${i}`))], hasMore: page < 100 };
    },
  });
  const first = await agg.list({ target: 500 });
  const arabic = first.items.filter((i) => i.langs.includes('ar'));
  assert.ok(arabic.length >= 500);
  assert.equal(first.arabicCount, arabic.length);
  assert.equal(calls, 50); // 3 unique from google/andalusi + 10 per page
  const keys = first.items.flatMap((i) => [i.name, i.altName].filter(Boolean).map(normalizeKey));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(first.items[0].source, 'google');           // live-preview source wins the clash and leads
  assert.equal(first.items.at(-1).name, 'Roboto');         // non-Arabic last
  assert.equal(first.hasMore, true);
  const more = await agg.list({ page: 2 });
  assert.equal(more.items.length, 50);
  assert.ok(more.items.every((i) => !keys.includes(normalizeKey(i.name))));
});

test('all: a failing source degrades to a warning, not an error', async () => {
  const { createAggregator } = await import('../src/main/sources/all.js');
  const agg = createAggregator({
    google: async () => { throw new Error('offline'); },
    andalusi: async () => ({ items: [{ id: 'a', source: 'andalusi', name: 'خط', altName: 'Khat', langs: ['ar'] }] }),
    alfont: async () => { throw new Error('alfont down'); },
  });
  const res = await agg.list({ target: 500 });
  assert.equal(res.items.length, 1);
  assert.deepEqual(res.warnings, ['offline', 'alfont down']);
  assert.equal(res.hasMore, true);
});

test('zip + install: extracts fonts from an archive and installs only real fonts', async () => {
  const { deflateRawSync } = await import('node:zlib');
  const { readFile, mkdtemp, readdir, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const { extractFontsFromZip, isZip } = await import('../src/main/fonts/zip.js');
  const { installFontFiles, fontsFromDownload, safeFileName, userFontDir } = await import('../src/main/fonts/install.js');

  const font = await readFile(path.join(FONTS, 'IBMPlexSansArabic-Regular.ttf'));
  const entries = [
    { name: '../../evil/Plex Regular.ttf', data: font, method: 8 },   // path traversal attempt
    { name: 'docs/readme.txt', data: Buffer.from('hi'), method: 0 },
    { name: '__MACOSX/._junk.ttf', data: Buffer.from('x'), method: 0 },
    { name: 'fake.otf', data: Buffer.from('not a font at all'), method: 0 },
  ];
  const locals = []; const central = []; let offset = 0;
  for (const e of entries) {
    const body = e.method === 8 ? deflateRawSync(e.data) : e.data;
    const n = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(e.method, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(e.method, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, body); central.push(ch, n); offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...locals, cd, eocd]);

  assert.equal(isZip(zip), true);
  const fonts = extractFontsFromZip(zip);
  assert.deepEqual(fonts.map((f) => f.name), ['Plex Regular.ttf', 'fake.otf']);
  assert.ok(fonts[0].data.equals(font));

  const dir = await mkdtemp(path.join(os.tmpdir(), 'nfs-test-'));
  try {
    const res = await installFontFiles(fontsFromDownload('pack.zip', zip), { dir, platform: 'linux' });
    assert.deepEqual(res.installed.map((i) => i.family), ['IBM Plex Sans Arabic']);
    assert.deepEqual(res.skipped, ['fake.otf']);
    assert.deepEqual(await readdir(dir), ['Plex Regular.ttf']);   // nothing escaped the folder, fake not written
  } finally { await rm(dir, { recursive: true, force: true }); }

  assert.equal(safeFileName('..\\..\\x/Cairo-700.TTF'), 'Cairo-700.ttf');
  assert.equal(safeFileName('خط عربي.otf'), 'خط عربي.otf');
  assert.equal(safeFileName('run.exe'), null);
  assert.ok(userFontDir('win32', { LOCALAPPDATA: 'C:\\L' }, 'C:\\U').endsWith('Fonts'));
  assert.equal(userFontDir('darwin', {}, '/Users/x'), '/Users/x/Library/Fonts');
});

test('all: keeps pulling alfont until 250 fonts no other source has', async () => {
  const { createAggregator } = await import('../src/main/sources/all.js');
  const mk = (source, name) => ({ id: `${source}:${name}`, source, name, altName: '', langs: ['ar'], category: 'other' });
  const agg = createAggregator({
    google: async () => ({ items: Array.from({ length: 2000 }, (_, i) => mk('google', `G ${i}`)) }),
    andalusi: async () => ({ items: Array.from({ length: 200 }, (_, i) => mk('andalusi', `A ${i}`)) }),
    // half of every alfont page already exists in Google -> must not count toward the 250
    alfont: async ({ page }) => ({ items: Array.from({ length: 10 }, (_, i) => (i % 2 ? mk('alfont', `G ${page * 10 + i}`) : mk('alfont', `AF ${page}-${i}`))), hasMore: true }),
  });
  const res = await agg.list({});
  const alfont = res.items.filter((i) => i.source === 'alfont');
  assert.equal(alfont.length, 250);
  assert.equal(res.alfontCount, 250);
  assert.ok(alfont.every((i) => i.name.startsWith('AF ')));
  assert.equal(alfont[0].name, 'AF 1-0'); // newest first
});
