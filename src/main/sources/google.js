// Google Fonts catalog. Previews are rendered live in the renderer through the public CSS2 API.

import { fetchText } from './http.js';
import { GOOGLE_SUBSET_LANG, classifyByName, langPriority } from '../../shared/languages.js';

const METADATA_URL = 'https://fonts.google.com/metadata/fonts';
const CATEGORY = { 'Sans Serif': 'sans', Serif: 'serif', Display: 'display', Handwriting: 'hand', Monospace: 'mono' };

export function parseGoogleMetadata(body) {
  const json = JSON.parse(body.slice(body.indexOf('{')));
  const items = [];
  for (const f of json.familyMetadataList || []) {
    if (!f.family) continue;
    const langs = [...new Set((f.subsets || []).map((s) => GOOGLE_SUBSET_LANG[s]).filter(Boolean))];
    if (!langs.length) continue;
    const isArabic = langs.includes('ar');
    items.push({
      id: `google:${f.family}`,
      source: 'google',
      name: f.family,
      langs,
      category: (isArabic && classifyByName(f.family)) || CATEGORY[f.category] || 'other',
      faceCount: Object.keys(f.fonts || {}).length,
      variants: Object.keys(f.fonts || {}),
      popularity: f.popularity ?? 99999,
      url: `https://fonts.google.com/specimen/${encodeURIComponent(f.family).replace(/%20/g, '+')}`,
      preview: { type: 'google', family: f.family },
    });
  }
  items.sort((a, b) => (langPriority(a.langs) - langPriority(b.langs)) || (a.popularity - b.popularity));
  return items;
}

const CSS_API = 'https://fonts.googleapis.com/css2';
const MAX_VARIANTS = 18;

/**
 * Resolve a family's static TTF files through the public CSS API.
 * @param {string} family
 * @param {string[]} variants  metadata keys such as "400", "700", "400i"
 * @returns {Promise<Array<{url: string, name: string}>>}
 */
export async function googleFontFiles(family, variants = []) {
  if (!/^[\p{L}\p{N} ._-]{1,80}$/u.test(family)) throw new Error('اسم خط غير صالح');
  const tuples = [...new Set(variants.filter((v) => /^\d{3}i?$/.test(v)))]
    .map((v) => [v.endsWith('i') ? 1 : 0, parseInt(v, 10)])
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
    .slice(0, MAX_VARIANTS);
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  const axis = tuples.length ? `:ital,wght@${tuples.map((t) => t.join(',')).join(';')}` : '';
  // The CSS API answers a non-browser client with plain TTF sources, which is what an OS install needs.
  const { body } = await fetchText(`${CSS_API}?family=${fam}${axis}`, { ttlMs: 3600_000 });
  const files = [];
  const seen = new Set();
  for (const block of body.split('@font-face').slice(1)) {
    const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.(?:ttf|otf))\)/.exec(block)?.[1];
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] || '400';
    const italic = /font-style:\s*italic/.test(block);
    files.push({ url, name: `${family.replace(/\s+/g, '')}-${weight}${italic ? 'Italic' : ''}${url.slice(url.lastIndexOf('.'))}` });
  }
  if (!files.length) throw new Error('لم يتم العثور على ملفات لهذا الخط');
  return files;
}

export async function listGoogle({ force } = {}) {
  const { body, stale } = await fetchText(METADATA_URL, { force });
  return { items: parseGoogleMetadata(body), hasMore: false, stale };
}
