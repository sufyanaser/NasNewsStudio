// Merged catalog: Google Fonts + andalusi + alfont, de-duplicated by font name.
// alfont pages are pulled until the list holds at least `target` unique Arabic fonts.

import { langPriority } from '../../shared/languages.js';

export const DEFAULT_TARGET = 500;
const MAX_FILL_PAGES = 80;   // hard stop for the initial fill (1 request/second, cached for 24h)
const PAGES_PER_MORE = 5;    // pages fetched per "load more"

/** Name key used for duplicate detection: case, spacing, punctuation and tatweel are ignored. */
export function normalizeKey(name) {
  return String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ـً-ٟ]/g, '')        // tatweel + harakat
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * @param {{google: Function, andalusi: Function, alfont: Function}} sources  list functions (injectable for tests)
 */
export function createAggregator(sources) {
  let seen = new Set();
  let arabicCount = 0;
  let nextPage = 1;
  let alfontDone = false;

  function addUnique(items, out) {
    for (const item of items) {
      const keys = [item.name, item.altName].map(normalizeKey).filter((k) => k.length > 1);
      if (!keys.length || keys.some((k) => seen.has(k))) continue;
      for (const k of keys) seen.add(k);
      if (item.langs.includes('ar')) arabicCount++;
      out.push(item);
    }
  }

  async function pullAlfont({ maxPages, until, force, out, warnings, onProgress }) {
    for (let i = 0; i < maxPages && !alfontDone && !until(); i++) {
      try {
        const res = await sources.alfont({ section: 'all', page: nextPage, force });
        addUnique(res.items, out);
        onProgress?.({ page: nextPage, arabicCount });
        nextPage++;
        if (!res.hasMore || !res.items.length) alfontDone = true;
      } catch (err) {
        warnings.push(err.message);
        break; // keep what we have; "load more" can retry this page later
      }
    }
  }

  /**
   * page 1 = fresh merged list (resets state); page > 1 = the next batch of alfont pages only.
   * @returns {Promise<{items: Array, hasMore: boolean, stale: boolean, arabicCount: number, target: number, warnings: string[]}>}
   */
  async function list({ page = 1, force = false, target = DEFAULT_TARGET, onProgress } = {}) {
    const out = [];
    const warnings = [];
    let stale = false;

    if (page <= 1) {
      seen = new Set(); arabicCount = 0; nextPage = 1; alfontDone = false;
      // Order = priority on a name clash: live-preview source first.
      const settled = await Promise.allSettled([sources.google({ force }), sources.andalusi({ force })]);
      for (const r of settled) {
        if (r.status === 'fulfilled') { addUnique(r.value.items, out); stale = stale || !!r.value.stale; }
        else warnings.push(r.reason?.message || String(r.reason));
      }
      onProgress?.({ page: 0, arabicCount });
      await pullAlfont({ maxPages: MAX_FILL_PAGES, until: () => arabicCount >= target, force, out, warnings, onProgress });
      const order = new Map(out.map((it, i) => [it, i]));
      out.sort((a, b) => (langPriority(a.langs) - langPriority(b.langs)) || (order.get(a) - order.get(b)));
    } else {
      await pullAlfont({ maxPages: PAGES_PER_MORE, until: () => false, force: false, out, warnings, onProgress });
    }
    return { items: out, hasMore: !alfontDone, stale, arabicCount, target, warnings };
  }

  return { list };
}
