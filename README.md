<p align="center">
  <img src="home-extension/icons/icon128.png" alt="My Home Logo" width="128" height="128" />
</p>

<h1 align="center">My Home</h1>

<p align="center">
  <b>A console-style home screen for every new Chrome tab: your favourite sites as tiles, with a live preview of each one behind them.</b>
  <br />
  Vanilla HTML, CSS &amp; JavaScript &bull; Manifest V3 &bull; PS5-inspired frosted-glass UI &bull; No build step
</p>

<p align="center">
  <a href="https://github.com/desmondlee95700/chrome-home/archive/refs/heads/main.zip"><img src="https://img.shields.io/badge/Download-ZIP-007AFF?logo=github" alt="Download ZIP"></a>
  <img src="https://img.shields.io/badge/Platform-Google%20Chrome-4285F4?logo=googlechrome&logoColor=white" alt="Google Chrome">
  <img src="https://img.shields.io/badge/Manifest-V3-34A853" alt="Manifest V3">
  <img src="https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black" alt="Vanilla JavaScript">
  <img src="https://img.shields.io/badge/Design-PS5%20Style-8A2BE2" alt="PS5-style UI">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT"></a>
</p>

---

## ⬇️ Download & Installation

### Option 1: Download ZIP (Recommended)
Download the latest version of the extension:

👉 **[Download chrome-home.zip](https://github.com/desmondlee95700/chrome-home/archive/refs/heads/main.zip)**

1. Unzip it and move the folder somewhere permanent, such as `Documents`.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the **`home-extension`** folder inside it.
4. Open a new tab (<kbd>⌘</kbd> <kbd>T</kbd>) and click **Keep it** when Chrome asks — your home screen is ready!

### Option 2: Clone with Git
```bash
git clone https://github.com/desmondlee95700/chrome-home.git
```
Then follow steps 2–4 above, choosing `chrome-home/home-extension`.

> [!TIP]
> **Show it every time Chrome opens**: go to Chrome **Settings > On startup** and choose **Open the New Tab page**.
>
> **Keep the folder where it is.** Chrome loads the extension straight from that folder, so moving or deleting it removes the extension. After updating the files (for example with `git pull`), click **↻** on the "My Home" card in `chrome://extensions`.

---

## ✨ Features

### 🎮 Home Screen

| Feature | Description |
| :--- | :--- |
| 🧩 **Site Tiles** | Your favourite sites as a row of tiles. The selected tile grows, glows and shows its name, just like a console home screen. Add, rename, change the link of or remove any site. |
| 🎨 **Logo-Matched Colours** | Each tile is painted in a deep version of its logo's own colour (dark red for YouTube, deep blue for Google). Black-and-white logos get a neutral glass tile. |
| 🖼️ **Full-Screen Previews** | The selected site fills the background with a softly blurred, slowly zooming preview that crossfades as you move between tiles. |
| 📸 **Live Previews** | Optional. When you visit one of your sites, a snapshot of the page is saved and used as that tile's background, so you see your real feed. The site's own menu bar is cropped off. |
| 🌄 **Artwork & Custom Backgrounds** | Uses a site's share image when it's real artwork (logo-only or plain white banners are skipped automatically), or set your own picture for any tile. |
| 🔍 **Search with Suggestions** | Search with your default search engine. Suggestions appear as you type, with matching home sites listed first. |
| 👤 **Google Profile** | Shows your Google photo and first name ("Good evening, Desmond") using the account you're already signed in to in Chrome — no setup needed. |
| ⚙️ **Settings** | 24-hour clock and Live previews, as simple toggles with a short explanation for each. |

<br />

### 🔐 Background Priority

For each tile, the first available background wins:

| Order | Source | Notes |
| :---: | :--- | :--- |
| 1 | **Your own image** | Set from **••• › Change background**. Upload a file or paste an image link. |
| 2 | **Live snapshot** | Taken in your own browser during your last visit. Refreshed at most every 10 minutes. |
| 3 | **Share image** | The banner a site shows when its link is shared, only if it looks like real artwork. Cached for 3 days. |
| 4 | **Colour glow** | A soft glow in the logo's colour while nothing else is available. |

---

## ⚙️ Controls & Shortcuts

### ⌨️ Keyboard

| Shortcut | Action |
| :---: | :--- |
| <kbd>←</kbd> <kbd>→</kbd> | Move between tiles. |
| <kbd>Enter</kbd> | Open the selected site (or add a new one on the **+** tile). |
| <kbd>O</kbd> | Open the options menu for the selected tile; <kbd>↑</kbd> <kbd>↓</kbd> to move, <kbd>Enter</kbd> to choose. |
| <kbd>/</kbd> | Open search; <kbd>↑</kbd> <kbd>↓</kbd> to pick a suggestion. |
| <kbd>Esc</kbd> | Close search or the options menu. |

<br />

### 🖱️ Mouse

| Gesture | Target | Action |
| :--- | :--- | :--- |
| **Click** | Tile | Selects the tile; click again to open the site. |
| **Click** | **Open** button | Opens the selected site. |
| **Click** | **•••** button | Rename or edit link, change background, or remove from home. |
| **Click** | Avatar | Connect or disconnect your Google account. |
| **Click** | ⚙️ / 🔍 | Opens Settings / search. |

---

## 🔒 Permissions & Privacy

| Permission | When | Why |
| :--- | :--- | :--- |
| **Storage** | Always | Saves your sites and settings (synced with your Chrome profile) and backgrounds (this computer only). |
| **Search** | Always | Searches with your default search engine. |
| **Identity / email** | Always | Reads the email of the account signed in to Chrome. |
| **Google suggestions & favicon service** | Always | Search suggestions as you type, and reading logo colours. |
| **All sites** | Only if you click **Turn on** | Share images and Live previews. Snapshots never leave your computer. |
| **accounts.google.com** | Only if you click **Use my Google account** | Shows your Google name and photo. |

No analytics, no tracking and no servers of our own. As with Chrome's address bar, what you type in search is sent to Google to get suggestions.

---

## 👤 Optional: Official Google Sign-In (OAuth)

The **Use my Google account** button reads the account you're already signed in to in Chrome. It relies on an undocumented Google address, so as a backup you can set up the official sign-in once:

1. Load the extension and copy its **ID** from `chrome://extensions` (it stays the same as long as you don't move the folder).
2. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
3. **APIs & Services > OAuth consent screen**: choose **External**, fill in the app name and your email, and add yourself under **Test users**.
4. **APIs & Services > Credentials > Create credentials > OAuth client ID**: application type **Chrome Extension**, item ID from step 1.
5. In `home-extension/manifest.json`, replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your client ID.
6. Reload the extension, then click your avatar › **Use my Google account**.

> [!NOTE]
> Google sign-in works in Google Chrome only, not in Edge, Brave or other Chromium browsers.

---

## 🛠️ Development

No build step and no dependencies. Edit the files in `home-extension/`, then click **↻** on the extension's card and open a new tab.

```bash
# Check the scripts and manifest
node --check home-extension/newtab.js home-extension/background.js
python3 -m json.tool home-extension/manifest.json > /dev/null

# Preview the page in any browser (Chrome extension APIs are unavailable here)
python3 -m http.server 8766 --directory home-extension
open http://localhost:8766/newtab.html
```

See [`AGENTS.md`](AGENTS.md) for how the code is organised, storage keys and conventions.

---

## 📄 License

This project is licensed under the **[MIT License](LICENSE.md)** &mdash; see the [`LICENSE.md`](LICENSE.md) file for complete details.

Copyright &copy; 2026 [Desmond Lee](https://github.com/desmondlee95700). Free and open-source software for personal and commercial use.
