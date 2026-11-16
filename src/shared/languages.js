// Language registry shared by the main process (script detection) and the renderer (filters).
// Order = display priority. Arabic is first and is the default filter.
// `cps`: codepoints that must ALL exist in a font's cmap for the font to count as supporting the language.

export const LANGS = [
  { id: 'ar', label: 'العربية', rtl: true, sample: 'ناس إف إم ٩٨٫٧ — صوت يصل إلى الجميع', cps: [0x0627, 0x0639, 0x0645, 0x0647] },
  { id: 'ku', label: 'کوردی', rtl: true, sample: 'دەنگی ئێمە دەگاتە هەمووان', cps: [0x06b5, 0x06ce, 0x06c6] },
  { id: 'fa', label: 'فارسی', rtl: true, sample: 'صدای ما به همه می‌رسد', cps: [0x067e, 0x0686, 0x06af] },
  { id: 'ur', label: 'اردو', rtl: true, sample: 'ہماری آواز سب تک پہنچتی ہے', cps: [0x0679, 0x06ba, 0x06d2] },
  { id: 'en', label: 'English', rtl: false, sample: 'NAS FM 98.7 — Broadcast Infrastructure', cps: [0x41, 0x61, 0x67] },
  { id: 'ru', label: 'Русский', rtl: false, sample: 'Наш голос слышен каждому', cps: [0x0416, 0x0436, 0x044f] },
  { id: 'el', label: 'Ελληνικά', rtl: false, sample: 'Η φωνή μας φτάνει παντού', cps: [0x03b1, 0x03c9] },
  { id: 'he', label: 'עברית', rtl: true, sample: 'הקול שלנו מגיע לכולם', cps: [0x05d0, 0x05e9] },
  { id: 'hi', label: 'हिन्दी', rtl: false, sample: 'हमारी आवाज़ सब तक पहुँचती है', cps: [0x0915, 0x0939] },
  { id: 'th', label: 'ไทย', rtl: false, sample: 'เสียงของเราไปถึงทุกคน', cps: [0x0e01, 0x0e2d] },
  { id: 'zh', label: '中文', rtl: false, sample: '我们的声音传遍四方', cps: [0x4e2d, 0x6587] },
  { id: 'ja', label: '日本語', rtl: false, sample: 'わたしたちの声をすべての人へ', cps: [0x3042, 0x30a2] },
  { id: 'ko', label: '한국어', rtl: false, sample: '우리의 목소리가 모두에게', cps: [0xac00, 0xd55c] },
];

export const LANG_BY_ID = Object.fromEntries(LANGS.map((l) => [l.id, l]));
export const DEFAULT_LANG = 'ar';

/** Lower = shown first. Fonts with Arabic support always lead. */
export function langPriority(langs) {
  let best = LANGS.length;
  for (const id of langs || []) {
    const i = LANGS.findIndex((l) => l.id === id);
    if (i >= 0 && i < best) best = i;
  }
  return best;
}

// Google Fonts subset name -> language id.
export const GOOGLE_SUBSET_LANG = {
  arabic: 'ar', latin: 'en', cyrillic: 'ru', greek: 'el', hebrew: 'he', devanagari: 'hi', thai: 'th',
  'chinese-simplified': 'zh', 'chinese-traditional': 'zh', 'chinese-hongkong': 'zh', japanese: 'ja', korean: 'ko',
};

export const CATEGORIES = [
  { id: 'kufi', label: 'كوفي' },
  { id: 'naskh', label: 'نسخ' },
  { id: 'thuluth', label: 'ثلث' },
  { id: 'ruqaa', label: 'رقعة' },
  { id: 'diwani', label: 'ديواني' },
  { id: 'nastaliq', label: 'نستعليق' },
  { id: 'hand', label: 'يدوي / حر' },
  { id: 'display', label: 'عناوين' },
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'symbol', label: 'رموز' },
  { id: 'other', label: 'غير مصنف' },
];

const NAME_RULES = [
  ['symbol', /icon|symbol|dingbat|emoji|wingding|webding|marlett|mdl2|fontawesome|ornament/],
  ['kufi', /kufi|kufy|kofi|koufi|kufic|كوفي/],
  ['nastaliq', /nastal|nasta3|نستعليق/],
  ['thuluth', /thulu|thulth|sols|ثلث/],
  ['ruqaa', /ruq|roqa|rokaa|reqaa|رقعة|رقعه/],
  ['diwani', /diwan|ديواني/],
  ['naskh', /naskh|nask\b|nasikh|amiri|quran|uthman|scheherazade|lateef|نسخ/],
  ['hand', /script|hand|brush|signat|marker|crayon|chalk|sketch|comic|cursive|callig|الحر/],
  ['mono', /mono|consol|courier|terminal|\bcode\b/],
  ['display', /display|poster|headline|stencil|outline|shadow|retro|deco/],
  ['sans', /sans|grotesk|gothic|helvet|arial/],
  ['serif', /serif|roman|times|garamond|georgia|bodoni|didot/],
];

/** Name key used for duplicate / installed detection: case, spacing, punctuation and tatweel are ignored. */
export function normalizeKey(name) {
  return String(name || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0640\u064B-\u065F]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Classify by font name only. Returns null when the name says nothing. */
export function classifyByName(name) {
  const n = String(name || '').toLowerCase();
  for (const [cat, re] of NAME_RULES) if (re.test(n)) return cat;
  return null;
}
