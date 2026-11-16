// Merged catalog: Google Fonts + andalusi + alfont, de-duplicated by font name.
// alfont's newest-first feed is pulled until the list holds at least `alfontTarget` alfont fonts that
// exist in no other source AND at least `target` unique Arabic fonts overall.

import { langPriority, normalizeKey } from '../../shared/languages.js';

export { normalizeKey };

export const DEFAULT_TARGET = 500;        // unique Arabic fonts across all sources
export const DEFAULT_ALFONT_TARGET = 250; // newest alfont fonts not present in any other source
const MAX_FILL_PAGES = 80;   // hard stop for the initial fill (1 request/second, cached for 24h)
const PAGES_PER_MORE = 5;    // pages fetched per "load more"

/**
 * @param {{google: Function, andalusi: Function, alfont: Function}} sources  list functions (injectable for tests)
 */
export function createAggregator(sources) {
  let seen = new Set();
  let arabicCount = 0;
  let alfontCount = 0;
  let nextPage = 1;
  let alfontDone = false;

  function addUnique(items, out) {
    for (const item of items) {
      const keys = [item.name, item.altName].map(normalizeKey).filter((k) => k.length > 1);
      if (!keys.length || keys.some((k) => seen.has(k))) continue;
      for (const k of keys) seen.add(k);
      if (item.langs.includes('ar')) arabicCount++;
      if (item.source === 'alfont') alfontCount++;
      out.push(item);
    }
  }

  async function pullAlfont({ maxPages, until, force, out, warnings, onProgress }) {
    for (let i = 0; i < maxPages && !alfontDone && !until(); i++) {
      try {
        const res = await sources.alfont({ section: 'all', page: nextPage, force });
        addUnique(res.items, out);
        onProgress?.({ page: nextPage, arabicCount, alfontCount });
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
   * @returns {Promise<{items: Array, hasMore: boolean, stale: boolean, arabicCount: number, alfontCount: number, warnings: string[]}>}
   */
  async function list({ page = 1, force = false, target = DEFAULT_TARGET, alfontTarget = DEFAULT_ALFONT_TARGET, onProgress } = {}) {
    const out = [];
    const warnings = [];
    let stale = false;

    if (page <= 1) {
      seen = new Set(); arabicCount = 0; alfontCount = 0; nextPage = 1; alfontDone = false;
      // Order = priority on a name clash: live-preview source first.
      const settled = await Promise.allSettled([sources.google({ force }), sources.andalusi({ force })]);
      for (const r of settled) {
        if (r.status === 'fulfilled') { addUnique(r.value.items, out); stale = stale || !!r.value.stale; }
        else warnings.push(r.reason?.message || String(r.reason));
      }
      onProgress?.({ page: 0, arabicCount, alfontCount });
      await pullAlfont({ maxPages: MAX_FILL_PAGES, until: () => arabicCount >= target && alfontCount >= alfontTarget, force, out, warnings, onProgress });
      const order = new Map(out.map((it, i) => [it, i]));
      out.sort((a, b) => (langPriority(a.langs) - langPriority(b.langs)) || (order.get(a) - order.get(b)));
    } else {
      await pullAlfont({ maxPages: PAGES_PER_MORE, until: () => false, force: false, out, warnings, onProgress });
    }
    return { items: out, hasMore: !alfontDone, stale, arabicCount, alfontCount, target, alfontTarget, warnings };
  }

  return { list };
}
