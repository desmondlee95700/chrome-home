# My Home — Chrome new-tab extension

A PS5-style home screen that replaces Chrome's new tab page: a row of site tiles you move
through with the arrow keys, a big title card for the selected site, and a full-screen
background preview of that site behind it.

Plain HTML/CSS/JS, Manifest V3, no build step and no dependencies.

## Layout

```
README.md              user-facing install, features, permissions, OAuth setup
LICENSE.md             MIT
home-extension/        ← the folder loaded into Chrome ("Load unpacked")
  manifest.json        permissions, new-tab override, icons, oauth2 placeholder
  newtab.html          the page: top bar, tile row, hero, controls bar, search overlay, dialogs
  newtab.css           all styling (sections marked with /* ---------- Name ---------- */)
  newtab.js            all page logic (one classic script, top-level functions)
  background.js        service worker: takes "live preview" snapshots of visited sites
  icons/               icon.svg (source) + 16/32/48/128 PNGs exported from it
```

Keep `README.md` in step with user-visible changes (features, controls, permissions).

## How it works

- **Storage**
  - `chrome.storage.sync` holds settings: `shortcuts` (`[{ name, url }]`), `clock24`, `livePreviews`.
  - `chrome.storage.local` holds images and caches, keyed per site:
    - `bg:<host>` — your own background image (data URL or image link)
    - `shot:<host>` — live snapshot `{ data, ts }`, written by `background.js`
    - `og:<url>` — share-image lookup `{ src, ts, checked }`, cached for 3 days
    - `color:<host>` — logo colour `{ c: [h, s, l] | null, ts }`, cached for 7 days
    - `profile` — last known Google profile
  - Outside the extension (plain browser preview) both fall back to `localStorage` via the
    `store` / `images` helpers at the top of `newtab.js`. Always go through those helpers.
- **Background for the focused tile** (`renderStage`), first match wins:
  your own image → live snapshot → site share image (`og:image`) → colour glow.
  Snapshots get the `shot` class, which crops off the top ~16% (site menus).
- **Share images** are only used if `isArtworkPixels` says they look like real artwork
  (not mostly white, not one flat colour, not just a few colours). This keeps logo
  banners like YouTube's off tiles and backgrounds.
- **Tile colour** comes from the logo's dominant colour (`logoColor` → `dominantColor`),
  painted as a dark version via `--c1/--c2` so the logo still stands out. Black-and-white
  logos stay neutral.
- **Google profile**: reads the browser's signed-in account from
  `accounts.google.com/ListAccounts` (undocumented; needs the optional permission granted
  from a click). The `oauth2` block in the manifest is an optional fallback that stays
  inert while `client_id` starts with `YOUR_`.
- **Search** uses `chrome.search.query` (the user's default engine). Suggestions come from
  `suggestqueries.google.com`, with matching home sites listed first.

## Permissions

- Required: `storage`, `unlimitedStorage`, `search`, `identity`, `identity.email`, plus
  host access to `suggestqueries.google.com` (search suggestions) and Google's favicon
  service `www.google.com/s2/favicons` + `*.gstatic.com` (reading logo colours).
- Optional, requested from a click: `<all_urls>` (share images + live snapshots, via the
  "Turn on" prompt or the Live previews toggle) and `accounts.google.com` (profile).
- `chrome.permissions.request` must run directly in a click handler, before any `await`.

## Conventions

- Match the existing style: vanilla JS, `$("id")` for lookups, small top-level functions,
  short comments that explain *why*. No frameworks, bundlers or npm packages.
- Dark, frosted-glass UI: translucent dark panels with `backdrop-filter: blur(...)`,
  white text, pill buttons, iOS-style `input.switch` toggles. Reuse existing classes
  (`.menu`, `.chip`, `.sheet`, `.row`, `.group`) instead of adding new one-offs.
- Keep the keyboard controls working: ← → move, Enter open, O options (↑ ↓ inside), / search,
  Esc close. Update the controls bar in `newtab.html` when adding a shortcut.
- If a stored data shape changes, keep reading the old shape or re-fetch it
  (see the `checked` flag on `og:` entries).
- Bump `version` in `manifest.json` for user-visible releases.

## Testing

- **Syntax**: `node --check home-extension/newtab.js home-extension/background.js` and
  `python3 -m json.tool home-extension/manifest.json`.
- **UI preview**: serve the folder and open it in a browser:
  `python3 -m http.server 8766 --directory home-extension` → `http://localhost:8766/newtab.html`.
  This is not the extension, so `chrome.*` APIs, permissions, Google suggestions, logo
  colours and share images are unavailable (CORS). Fake them for visual checks, e.g. set
  `localStorage` keys `shot:<host>` / `bg:<host>`, or override `window.logoColor` /
  `window.googleSuggestions`, then call `renderTiles()`. Clear `localStorage` afterwards.
- Background layers fade in on `requestAnimationFrame`, which pauses in a hidden tab —
  wait or take a fresh screenshot before judging the background.
- **Real test**: `chrome://extensions` → Developer mode → Load unpacked → `home-extension/`,
  then ↻ reload after every change and open a new tab. Errors show under the card's
  **Errors** button, or right-click the page → Inspect → Console.
- Regenerate icons from `icons/icon.svg` with headless Chrome
  (`--headless=new --screenshot --window-size=N,N --default-background-color=00000000`).
