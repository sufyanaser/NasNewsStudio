// andalusi.app/fonts catalog. One public page lists every font with a rendered specimen image.

import { fetchText, decodeHtml, safeUrl } from './http.js';
import { classifyByName } from '../../shared/languages.js';

const PAGE_URL = 'https://andalusi.app/fonts';
const BASE = 'https://andalusi.app';
const IMG_HOSTS = ['storage.andalusi.app'];

const CATEGORY = {
  'الكوفي': 'kufi', 'كوفي حديث': 'kufi', 'النسخ': 'naskh', 'نسخ حديث': 'naskh', 'الثلث': 'thuluth',
  'الرقعة': 'ruqaa', 'الديواني': 'diwani', 'النستعليق': 'nastaliq', 'الخط الحر': 'hand',
  'Sans Serif': 'sans', Serif: 'serif', Handwritten: 'hand', Script: 'hand', Display: 'display', Monospaced: 'mono',
};
const ARABIC_RE = /[؀-ۿ]/;

const CARD_RE = /<a href="(\/fonts\/[^"]+)"[^>]*>[\s\S]*?<img src="([^"]+)"[^>]*>[\s\S]*?<p[^>]*>([^<]*)<\/p><p[^>]*>([^<]*)<\/p><span[^>]*>([^<]*)<\/span><\/a>/g;

export function parseAndalusi(html) {
  const items = [];
  const seen = new Set();
  for (const m of html.matchAll(CARD_RE)) {
    const url = safeUrl(m[1], BASE, ['andalusi.app']);
    const image = safeUrl(decodeHtml(m[2]), BASE, IMG_HOSTS);
    const name = decodeHtml(m[3]);
    const alt = decodeHtml(m[4]);
    const label = decodeHtml(m[5]);
    if (!url || !image || !name || seen.has(url)) continue;
    seen.add(url);
    const isArabic = ARABIC_RE.test(label) || ARABIC_RE.test(name);
    items.push({
      id: `andalusi:${url}`,
      source: 'andalusi',
      name,
      altName: alt && alt !== name ? alt : '',
      langs: [isArabic ? 'ar' : 'en'],
      category: CATEGORY[label] || classifyByName(`${name} ${alt}`) || 'other',
      url,
      preview: { type: 'image', url: image },
    });
  }
  // Arabic first, original site order otherwise.
  items.sort((a, b) => (a.langs[0] === 'ar' ? 0 : 1) - (b.langs[0] === 'ar' ? 0 : 1));
  return items;
}

export async function listAndalusi({ force } = {}) {
  const { body, stale } = await fetchText(PAGE_URL, { force });
  return { items: parseAndalusi(body), hasMore: false, stale };
}
