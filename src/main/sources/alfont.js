// alfont.com listing. The site publishes a rendered specimen image per font, so cards show that
// image and link to the font's own page. Pages are fetched one at a time, on demand, and cached.

import { fetchText, decodeHtml, safeUrl } from './http.js';
import { classifyByName } from '../../shared/languages.js';

const BASE = 'https://alfont.com';
const HOSTS = ['alfont.com'];

// Section slug per category chip. '' is the main feed.
export const ALFONT_SECTIONS = {
  all: '', new: 'new-arabic-fonts', naskh: 'naskh-arabic-fonts', ruqaa: 'ruqaa-arabic-fonts',
  diwani: 'diwany-arabic-fonts', thuluth: 'thulth-arabic-fonts',
};

const CARD_RE = /<a\s+class="card-header[^"]*"\s+href="([^"]+)"[^>]*>\s*<h1>([\s\S]*?)<\/h1>[\s\S]*?<img[^>]*class="[^"]*postimgloop[^"]*"[^>]*src="([^"]+)"/g;

export function parseAlfontListing(html, { section = 'all', page = 1 } = {}) {
  const items = [];
  const seen = new Set();
  for (const m of html.matchAll(CARD_RE)) {
    const url = safeUrl(m[1], BASE, HOSTS);
    const image = safeUrl(m[3], BASE, HOSTS);
    const name = decodeHtml(m[2]);
    if (!url || !image || !name || seen.has(url)) continue;
    seen.add(url);
    items.push({
      id: `alfont:${url}`,
      source: 'alfont',
      name,
      langs: ['ar'],
      category: (section !== 'all' && section !== 'new' ? section : classifyByName(name)) || 'other',
      url,
      preview: { type: 'image', url: image },
    });
  }
  const hasMore = new RegExp(`/page/${page + 1}["'/]`).test(html);
  return { items, hasMore };
}

export async function listAlfont({ section = 'all', page = 1, force } = {}) {
  const slug = ALFONT_SECTIONS[section];
  if (slug === undefined) throw new Error('قسم غير معروف');
  const p = Math.max(1, Math.min(500, Number(page) || 1));
  const url = `${BASE}/${slug}${slug ? '/' : ''}${p > 1 ? `page/${p}` : ''}`;
  const { body, stale } = await fetchText(url, { force });
  return { ...parseAlfontListing(body, { section, page: p }), stale };
}
