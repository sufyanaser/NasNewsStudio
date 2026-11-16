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
