import { LANGS, LANG_BY_ID, DEFAULT_LANG, CATEGORIES, langPriority } from '../shared/languages.js';

const $ = (id) => document.getElementById(id);
const api = window.api;
const PAGE = 48;
const store = {
  get(k, d) { try { const v = localStorage.getItem(`nfs.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`nfs.${k}`, JSON.stringify(v)); } catch { /* storage is optional */ } },
};

const SOURCES = {
  local: { label: 'خطوط الجهاز', live: true },
  all: { label: 'كل المصادر', live: true, mixed: true },
  google: { label: 'Google Fonts', live: true },
  alfont: { label: 'الفونت العربي', live: false, paged: true,
    sections: [['all', 'الكل'], ['new', 'الجديد'], ['naskh', 'نسخ'], ['ruqaa', 'رقعة'], ['diwani', 'ديواني'], ['thuluth', 'ثلث']] },
  andalusi: { label: 'أندلسي', live: false },
};
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/></svg>',
};

const S = {
  source: store.get('source', 'local'),
  lang: store.get('lang', DEFAULT_LANG),
  cat: 'all',
  q: '',
  size: store.get('size', 40),
  sample: store.get('sample', ''), // '' = follow the selected language
  favOnly: false,
  fav: new Set(store.get('fav', [])),
  rendered: 0,
  view: [],
};
if (!SOURCES[S.source]) S.source = 'local';
if (S.lang !== 'all' && !LANG_BY_ID[S.lang]) S.lang = DEFAULT_LANG;

/** key -> { items, hasMore, page, loading, error, stale } */
const data = new Map();
const dataKey = () => (S.source === 'alfont' ? `alfont:${S.cat}` : S.source);
const current = () => data.get(dataKey());

/* ---------------- helpers ---------------- */
function toast(msg, ms = 1800) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
}
function setStatus(text, mode = '') { $('statusText').textContent = text; $('status').className = `status ${mode}`; }
const cssStr = (s) => `"${String(s).replace(/[\\"\n\r]/g, (c) => (c === '"' || c === '\\' ? `\\${c}` : ' '))}"`;
function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v; /* static icons only */ else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
}
function sampleText() {
  if (S.sample) return S.sample;
  return (LANG_BY_ID[S.lang] || LANG_BY_ID[DEFAULT_LANG]).sample;
}

/* ---------------- font activation (lazy) ---------------- */
const faceSheet = document.head.appendChild(document.createElement('style')).sheet;
const loaded = new Set();

function activateLocal(face) {
  const alias = `nf-${face.id}`;
  if (!loaded.has(alias)) {
    loaded.add(alias);
    const src = [`local(${cssStr(face.fullName)})`];
    if (face.postscriptName) src.push(`local(${cssStr(face.postscriptName)})`);
    if (face.loadable) src.push(`url("nasfont://f/${face.id}")`);
    try { faceSheet.insertRule(`@font-face{font-family:"${alias}";src:${src.join(',')};}`, faceSheet.cssRules.length); } catch { /* bad name */ }
  }
  return `"${alias}"`;
}
function activateGoogle(family) {
  if (!loaded.has(`g:${family}`)) {
    loaded.add(`g:${family}`);
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
    document.head.append(el('link', { rel: 'stylesheet', href }));
  }
  return cssStr(family);
}
function activate(card) {
  const item = card._item;
  const pv = card.querySelector('.pv');
  if (item.source === 'local') {
    const face = item.faces.find((f) => f.id === card._face) || item.faces[0];
    pv.style.fontFamily = activateLocal(face);
    pv.style.fontWeight = face.weight;
    pv.style.fontStyle = face.italic ? 'italic' : 'normal';
  } else if (item.preview?.type === 'google') {
    pv.style.fontFamily = activateGoogle(item.preview.family);
  }
  pv.classList.remove('pending');
}
const cardIO = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { cardIO.unobserve(e.target); activate(e.target); }
}, { rootMargin: '400px' });

/* ---------------- cards ---------------- */
function buildCard(item) {
  const isLocal = item.source === 'local';
  const sub = [];
  if (item.altName) sub.push(item.altName);
  const n = isLocal ? item.faces.length : item.faceCount;
  if (n > 1) sub.push(`${n} أوزان`);

  const fav = el('button', { class: 'ic', type: 'button', title: 'مفضلة', 'aria-label': 'مفضلة', 'aria-pressed': String(S.fav.has(item.id)), html: ICON.star });
  fav.onclick = () => {
    const on = !S.fav.has(item.id);
    on ? S.fav.add(item.id) : S.fav.delete(item.id);
    store.set('fav', [...S.fav]);
    fav.setAttribute('aria-pressed', String(on));
    if (S.favOnly && !on) refresh();
  };
  const copy = el('button', { class: 'ic', type: 'button', title: 'نسخ اسم الخط', 'aria-label': 'نسخ اسم الخط', html: ICON.copy });
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(item.name); toast(`تم النسخ: ${item.name}`); } catch { toast('تعذّر النسخ'); }
  };
  const open = el('button', { class: 'ic', type: 'button', title: isLocal ? 'إظهار ملف الخط' : 'فتح صفحة الخط', 'aria-label': isLocal ? 'إظهار ملف الخط' : 'فتح صفحة الخط', html: isLocal ? ICON.folder : ICON.open });

  let pv;
  if (item.preview?.type === 'image') {
    pv = el('div', { class: 'pv img' });
    const img = el('img', { alt: item.name, loading: 'lazy', referrerpolicy: 'no-referrer', src: item.preview.url });
    img.style.maxHeight = `${S.size * 2}px`;
    img.onerror = () => { pv.classList.add('fail'); pv.textContent = 'تعذّر تحميل المعاينة'; };
    pv.append(img);
  } else {
    pv = el('div', { class: 'pv pending', dir: 'auto', text: sampleText() });
    pv.style.fontSize = `${S.size}px`;
  }

  const foot = el('footer');
  for (const id of LANGS.map((l) => l.id).filter((id) => item.langs.includes(id)).slice(0, 4)) {
    foot.append(el('span', { class: `tag${id === 'ar' ? ' ar' : ''}`, text: LANG_BY_ID[id].label }));
  }
  if (item.langs.length > 4) foot.append(el('span', { class: 'tag', text: `+${item.langs.length - 4}` }));
  if (CAT_LABEL[item.category] && item.category !== 'other') foot.append(el('span', { class: 'tag', text: CAT_LABEL[item.category] }));
  if (S.source === 'all') foot.append(el('span', { class: 'tag src', text: SOURCES[item.source].label }));

  const card = el('article', { class: 'card' }, [
    el('header', {}, [
      el('div', { class: 'nm' }, [el('b', { text: item.name, title: item.name }), sub.length ? el('small', { text: sub.join(' · ') }) : null]),
      el('div', { class: 'acts' }, [fav, copy, open]),
    ]),
    pv, foot,
  ]);
  card._item = item;

  if (isLocal) {
    card._face = item.defaultFace;
    if (item.faces.length > 1) {
      const sel = el('select', { 'aria-label': 'الوزن' });
      for (const f of item.faces) sel.append(el('option', { value: f.id, text: `${f.style} · ${f.weight}` }));
      sel.value = item.defaultFace;
      sel.onchange = () => { card._face = sel.value; activate(card); };
      foot.append(sel);
    }
    open.onclick = async () => { if (!(await api.reveal(card._face))) toast('الملف غير متاح'); };
  } else {
    open.onclick = async () => { if (!(await api.openExternal(item.url))) toast('رابط غير مسموح'); };
  }
  return card;
}

/* ---------------- filtering + rendering ---------------- */
function computeView() {
  const d = current();
  if (!d) return [];
  const q = S.q.trim().toLowerCase();
  const remoteCats = !!SOURCES[S.source].sections;
  let out = d.items.filter((it) =>
    (S.lang === 'all' || it.langs.includes(S.lang)) &&
    (remoteCats || S.cat === 'all' || it.category === S.cat) &&
    (!S.favOnly || S.fav.has(it.id)) &&
    (!q || it.name.toLowerCase().includes(q) || (it.altName || '').toLowerCase().includes(q)));
  if (S.lang === 'all') {
    out = out.map((it, i) => [it, i]).sort((a, b) => (langPriority(a[0].langs) - langPriority(b[0].langs)) || (a[1] - b[1])).map((x) => x[0]);
  }
  return out;
}

function renderMore() {
  const next = S.view.slice(S.rendered, S.rendered + PAGE);
  const frag = document.createDocumentFragment();
  for (const item of next) {
    const card = buildCard(item);
    frag.append(card);
    if (item.preview?.type !== 'image') cardIO.observe(card);
  }
  $('grid').append(frag);
  S.rendered += next.length;
  syncMore();
}

/** Paged sources auto-extend on scroll only while unfiltered; a search never crawls the whole site. */
const canAutoPage = () => !S.q.trim() && !S.favOnly;
function syncMore() {
  const d = current();
  $('moreRow').hidden = !(d && d.hasMore && !d.error && S.rendered >= S.view.length);
  $('more').disabled = !!d?.loading;
  // Re-arm: an observer only fires on change, and a short grid can leave the sentinel in view.
  sentinelIO.unobserve($('sentinel')); sentinelIO.observe($('sentinel'));
}

function chip(text, count, pressed, onClick) {
  const b = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed) }, [el('span', { text })]);
  if (count !== null) b.append(el('small', { text: String(count) }));
  b.onclick = onClick;
  return b;
}

function renderFilters() {
  const d = current();
  const items = d?.items || [];
  const src = SOURCES[S.source];

  const langCount = {};
  for (const it of items) for (const l of it.langs) langCount[l] = (langCount[l] || 0) + 1;
  const langs = $('langs'); langs.replaceChildren();
  // Arabic always leads, then the rest in registry order, "all" last.
  for (const l of LANGS) {
    if (!langCount[l.id] && l.id !== DEFAULT_LANG && l.id !== S.lang) continue;
    langs.append(chip(l.label, langCount[l.id] || 0, S.lang === l.id, () => setLang(l.id)));
  }
  langs.append(chip('كل اللغات', items.length, S.lang === 'all', () => setLang('all')));

  const cats = $('cats'); cats.replaceChildren();
  if (src.sections) {
    for (const [id, label] of src.sections) cats.append(chip(label, null, S.cat === id, () => setCat(id)));
  } else {
    const inLang = items.filter((it) => S.lang === 'all' || it.langs.includes(S.lang));
    const catCount = {};
    for (const it of inLang) catCount[it.category] = (catCount[it.category] || 0) + 1;
    cats.append(chip('كل الأنواع', inLang.length, S.cat === 'all', () => setCat('all')));
    for (const c of CATEGORIES) if (catCount[c.id]) cats.append(chip(c.label, catCount[c.id], S.cat === c.id, () => setCat(c.id)));
  }

  const note = $('note');
  note.hidden = src.live && !src.mixed;
  if (src.mixed) note.textContent = 'قائمة موحّدة بدون تكرار من Google Fonts وأندلسي والفونت العربي. النص التجريبي ينطبق على خطوط Google، والباقي معاينته صور من الموقع المصدر.';
  else if (!src.live) note.textContent = 'معاينة هذا المصدر صور جاهزة من الموقع نفسه، لذلك النص التجريبي لا ينطبق هنا. افتح صفحة الخط للتجربة والتحميل.';
  $('sample').disabled = !src.live;
}

function showState(title, detail, isErr = false, action = null) {
  const st = $('state'); st.replaceChildren(); st.hidden = false; st.className = `state${isErr ? ' err' : ''}`;
  st.append(el('b', { text: title }));
  if (detail) st.append(el('span', { text: detail }));
  if (action) { const b = el('button', { class: 'btn', type: 'button', text: action.label }); b.onclick = action.run; st.append(b); }
}

function refresh() {
  const d = current();
  renderFilters();
  $('grid').replaceChildren();
  $('state').hidden = true;
  $('moreRow').hidden = true;
  S.rendered = 0;
  S.view = computeView();

  if (!d || (d.loading && !d.items.length)) {
    $('count').textContent = '';
    showState('جارٍ التحميل…', S.source === 'local' ? 'قراءة الخطوط المنصّبة على الجهاز' : `جلب قائمة ${SOURCES[S.source].label}`);
    return;
  }
  if (d.error && !d.items.length) {
    $('count').textContent = '';
    showState('تعذّر تحميل هذا المصدر', d.error, true, { label: 'إعادة المحاولة', run: () => load(true) });
    return;
  }
  const total = d.items.length;
  $('count').textContent = `${S.view.length} / ${total}${d.hasMore ? '+' : ''}${d.stale ? ' · نسخة مخزّنة' : ''}`;
  if (!S.view.length) {
    syncMore();
    if (S.favOnly) showState('لا توجد خطوط مفضلة هنا', 'اضغط على النجمة في أي خط لإضافته.');
    else if (S.lang !== 'all' && !d.items.some((it) => it.langs.includes(S.lang)) && !d.hasMore) {
      showState(`لا توجد خطوط ${LANG_BY_ID[S.lang].label} في هذا المصدر`, null, false, { label: 'عرض كل اللغات', run: () => setLang('all') });
    } else if (!d.hasMore) showState('لا توجد نتائج', 'جرّب نوعاً آخر أو امسح البحث.');
    return;
  }
  renderMore();
}

/* ---------------- loading ---------------- */
async function load(force = false) {
  const key = dataKey();
  let d = data.get(key);
  if (d?.loading) return;
  if (d && d.items.length && !force) return;
  d = { items: [], hasMore: false, page: 0, loading: true, error: null, stale: false };
  data.set(key, d);
  if (key === dataKey()) refresh();
  await fetchPage(key, d, 1, force);
}

async function fetchPage(key, d, page, force = false) {
  d.loading = true;
  const status = (text, mode) => { if (key === dataKey()) setStatus(text, mode); };
  status('جارٍ التحميل…', 'busy');
  try {
    if (key === 'local') {
      const res = await api.scanLocal({ force });
      d.items = res.families;
      d.summary = `${res.families.length} عائلة · ${res.fileCount} ملف`;
      status(d.summary);
    } else {
      const [id, section] = key.split(':');
      const res = await api.listSource(id, { section, page, force });
      const seen = new Set(d.items.map((i) => i.id));
      d.items = d.items.concat(res.items.filter((i) => !seen.has(i.id)));
      d.hasMore = !!res.hasMore && res.items.length > 0;
      d.stale = !!res.stale;
      if (id === 'all') { d.arabic = res.arabicCount; d.target = res.target; if (res.warnings?.length) toast(res.warnings[0], 4000); }
      d.summary = res.stale ? 'بدون اتصال · نسخة مخزّنة'
        : id === 'all' ? `خطوط عربية فريدة: ${d.arabic}${d.arabic < d.target ? ` (أقل من ${d.target})` : ''}`
        : `${SOURCES[id].label} · ${d.items.length}`;
      status(d.summary);
    }
    d.page = page;
    d.error = null;
  } catch (err) {
    d.error = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    status('خطأ في التحميل', 'err');
  } finally {
    d.loading = false;
  }
  if (key !== dataKey()) return;
  if (page === 1 || d.error || S.lang === 'all') refresh(); // 'all' re-sorts Arabic-first, so rebuild
  else { // appended page: keep scroll position, just extend the view
    S.view = computeView();
    $('count').textContent = `${S.view.length} / ${d.items.length}${d.hasMore ? '+' : ''}`;
    renderMore();
  }
}

const sentinelIO = new IntersectionObserver((entries) => {
  if (!entries.some((e) => e.isIntersecting)) return;
  const d = current();
  if (!d || d.loading) return;
  if (S.rendered < S.view.length) renderMore();
  else if (d.hasMore && !d.error && canAutoPage()) fetchPage(dataKey(), d, d.page + 1);
}, { rootMargin: '800px' });

/* ---------------- state changes ---------------- */
function setLang(id) {
  S.lang = id; store.set('lang', id);
  if (!SOURCES[S.source].sections) S.cat = 'all';
  refresh();
}
function setCat(id) {
  S.cat = id;
  if (SOURCES[S.source].sections) load(); // remote section
  refresh();
}
function setSource(id) {
  S.source = id; S.cat = 'all'; store.set('source', id);
  for (const b of $('sources').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.source === id));
  const d = current();
  setStatus(d?.loading ? 'جارٍ التحميل…' : d?.summary || 'جاهز', d?.loading ? 'busy' : '');
  load();
  refresh();
}

function init() {
  if (!api) { showState('يعمل هذا التطبيق داخل Electron فقط', 'شغّله عبر: npm start', true); return; }

  $('sample').value = S.sample;
  $('sample').placeholder = sampleText();
  $('size').value = S.size; $('sizeVal').textContent = S.size;

  $('sources').addEventListener('click', (e) => { const b = e.target.closest('button[data-source]'); if (b) setSource(b.dataset.source); });
  $('sample').addEventListener('input', (e) => {
    S.sample = e.target.value; store.set('sample', S.sample);
    const t = sampleText();
    for (const pv of $('grid').querySelectorAll('.pv:not(.img)')) pv.textContent = t;
  });
  $('size').addEventListener('input', (e) => {
    S.size = Number(e.target.value); $('sizeVal').textContent = S.size; store.set('size', S.size);
    for (const pv of $('grid').querySelectorAll('.pv:not(.img)')) pv.style.fontSize = `${S.size}px`;
    for (const img of $('grid').querySelectorAll('.pv.img img')) img.style.maxHeight = `${S.size * 2}px`;
  });
  let qt;
  $('q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; refresh(); }, 140); });
  $('favOnly').onclick = () => { S.favOnly = !S.favOnly; $('favOnly').setAttribute('aria-pressed', String(S.favOnly)); refresh(); };
  $('refresh').onclick = () => load(true);
  $('more').onclick = () => { const d = current(); if (d && d.hasMore && !d.loading) fetchPage(dataKey(), d, d.page + 1); };
  api.onSourceProgress(({ page, arabicCount }) => {
    if (S.source === 'all') setStatus(page ? `الفونت العربي · صفحة ${page} · عربي فريد ${arabicCount}` : `عربي فريد ${arabicCount}`, 'busy');
  });
  api.onScanProgress(({ done, total }) => { if (S.source === 'local') setStatus(`فحص الخطوط ${done} / ${total}`, 'busy'); });

  sentinelIO.observe($('sentinel'));
  setSource(S.source);
}

init();
