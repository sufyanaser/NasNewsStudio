# NAS Font Studio

Desktop font browser for NAS FM 98.7 (Electron). Arabic-first.

| Mode | Source | Preview |
|------|--------|---------|
| 01 · Desktop | Fonts installed on this machine (system + user + Adobe Fonts sync folders) | Live text, per-weight |
| 02 · Online | كل المصادر — the three catalogs merged, de-duplicated by name, filled to ≥ 500 unique Arabic fonts | Mixed |
| 02 · Online | Google Fonts | Live text (CSS2 API) |
| 02 · Online | alfont.com | Site specimen image + link to the font page |
| 02 · Online | andalusi.app/fonts | Site specimen image + link to the font page |

Language filter (Arabic default and always first; Kurdish, Persian, Urdu, English, …), type filter,
search, sample text, size, favorites, copy name, reveal file / open page.

## Install button

Online cards show **تنصيب** when the font is not on the machine, **منصّب** when it is. Install is per-user, no admin rights
(Windows: `%LOCALAPPDATA%\Microsoft\Windows\Fonts` + HKCU registry entry; macOS: `~/Library/Fonts`; Linux: `~/.local/share/fonts`).

- Google Fonts: one click, all weights.
- alfont: opens the font's own page in an isolated window; pressing the site's download button is captured
  (`.ttf` / `.otf` / `.zip`), validated, installed, and the window closes.
- andalusi: no downloadable files, link only.

The alfont tab lists the newest alfont fonts that exist in no other source (at least 250).
No third-party font files are bundled in this repository; each font keeps its own license.

## Run

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

## Build installers

```bash
npm run dist:win
```

## Layout

```
src/main/main.js             window, IPC, nasfont:// protocol (serves only scanned font files)
src/main/fonts/sfnt.js       dependency-free TTF/OTF/TTC reader (names, weight, cmap → languages)
src/main/fonts/install.js    per-user install, validates every file before it reaches the font folder
src/main/fonts/zip.js        dependency-free zip reader for downloaded font archives
src/main/fonts/local-scan.js OS font folders → families, cached by path+mtime+size
src/main/sources/*.js        google / alfont / andalusi catalogs (24h disk cache, 1 req/s per host)
src/shared/languages.js      language + category registry (Arabic first)
src/renderer/                UI (no build step)
```

## Notes

- Language support for installed fonts is read from each font's `cmap` table, not guessed from the name.
- alfont and andalusi do not expose webfont files for live rendering, so those cards show the specimen
  image each site publishes and link out; fonts are downloaded from the source site under its own license.
- Online catalogs depend on the current markup of those sites; parsers live in `src/main/sources/`.
