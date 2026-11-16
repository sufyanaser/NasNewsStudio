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
      popularity: f.popularity ?? 99999,
      url: `https://fonts.google.com/specimen/${encodeURIComponent(f.family).replace(/%20/g, '+')}`,
      preview: { type: 'google', family: f.family },
    });
  }
  items.sort((a, b) => (langPriority(a.langs) - langPriority(b.langs)) || (a.popularity - b.popularity));
  return items;
}

export async function listGoogle({ force } = {}) {
  const { body, stale } = await fetchText(METADATA_URL, { force });
  return { items: parseGoogleMetadata(body), hasMore: false, stale };
}
