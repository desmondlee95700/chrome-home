const DEFAULTS = {
  clock24: false,
  livePreviews: false,
  shortcuts: [
    { name: "YouTube", url: "https://www.youtube.com" },
    { name: "Gmail", url: "https://mail.google.com" },
    { name: "GitHub", url: "https://github.com" },
    { name: "Claude", url: "https://claude.ai" },
    { name: "Google", url: "https://www.google.com" },
  ],
};

const inExtension = typeof chrome !== "undefined" && !!(chrome.storage && chrome.storage.sync);

// Settings: chrome.storage.sync inside the extension; localStorage when the page is opened directly.
const store = {
  async get() {
    if (inExtension) return chrome.storage.sync.get(DEFAULTS);
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("home") || "{}") };
    } catch {
      return { ...DEFAULTS };
    }
  },
  async set(values) {
    if (inExtension) return chrome.storage.sync.set(values);
    try {
      const current = JSON.parse(localStorage.getItem("home") || "{}");
      localStorage.setItem("home", JSON.stringify({ ...current, ...values }));
    } catch {}
  },
};

// Background images are too big for sync, so they live in chrome.storage.local.
// Keys: "bg:<host>" = your own image, "shot:<host>" = live preview { data, ts }.
const images = {
  async get(keys) {
    if (inExtension) return chrome.storage.local.get(keys);
    const out = {};
    for (const k of keys) {
      try {
        const v = localStorage.getItem(k);
        if (v) out[k] = JSON.parse(v);
      } catch {}
    }
    return out;
  },
  async set(key, value) {
    if (inExtension) return chrome.storage.local.set({ [key]: value });
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      alert("That image is too big to save here. Try a smaller one.");
    }
  },
  async remove(keys) {
    if (inExtension) return chrome.storage.local.remove(keys);
    keys.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    });
  },
};

let state = { ...DEFAULTS };
let profile = null; // { name, givenName, email, picture, google }
let focusIndex = 0;
let stageToken = 0;
const $ = (id) => document.getElementById(id);

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Stable colour per site so each tile (and the background) has its own mood.
function hueOf(text) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function faviconOf(url, size) {
  return `https://www.google.com/s2/favicons?sz=${size}&domain_url=${encodeURIComponent(url)}`;
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function greetingText() {
  const h = new Date().getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const name = displayName();
  return name ? `${part}, ${name}` : part;
}

function displayName() {
  return (profile && profile.givenName) || "";
}

function renderClock() {
  $("clock").textContent = new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: !state.clock24,
  });
}

// ---------- Google profile ----------

const hasIdentity = inExtension && !!chrome.identity;
const oauthConfigured =
  hasIdentity && !/^YOUR_/.test((chrome.runtime.getManifest().oauth2 || {}).client_id || "YOUR_");

const GOOGLE_ACCOUNTS = "https://accounts.google.com/*";

// Reads the Google account already signed in to this browser, the same list Chrome's
// own profile menu uses. Undocumented by Google, so it may change; we fail quietly.
async function readSignedInGoogleAccount() {
  try {
    const res = await fetch(
      "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard",
      { credentials: "include" }
    );
    const text = await res.text();
    const data = JSON.parse(text.slice(text.indexOf("[")));
    const accounts = (data[1] || []).filter((a) => Array.isArray(a) && /@/.test(a[3] || ""));
    if (!accounts.length) return null;

    // Prefer the account this Chrome profile is signed in with.
    let chromeEmail = "";
    try {
      chromeEmail = (await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" })).email;
    } catch {}
    const a = accounts.find((x) => x[3] === chromeEmail) || accounts[0];
    const name = a[2] || "";
    return { name, givenName: name.split(" ")[0], email: a[3], picture: photoFrom(a), google: true, source: "browser" };
  } catch {
    return null;
  }
}

// The photo is usually the 5th field, but look through the whole entry in case Google moves it.
function photoFrom(account) {
  const found = [account[4], ...account].find(
    (v) => typeof v === "string" && /googleusercontent\.com|ggpht\.com/.test(v)
  );
  return found ? sharpPhoto(found) : "";
}

// Google photo links carry a size (e.g. "=s48-c" or "/s48-c/"); ask for a crisp 128px one.
function sharpPhoto(url) {
  if (url.startsWith("//")) url = "https:" + url;
  if (/=s\d+(-[a-z]+)*$/.test(url)) return url.replace(/=s\d+(-[a-z]+)*$/, "=s128-c");
  if (/\/s\d+(-[a-z]+)*\//.test(url)) return url.replace(/\/s\d+(-[a-z]+)*\//, "/s128-c/");
  return url.includes("=") ? url : url + "=s128-c";
}

// Google name + photo, from the browser's signed-in account or the optional OAuth client;
// otherwise just the email of the account signed in to Chrome.
async function loadProfile(interactive = false) {
  if (!hasIdentity) return null;

  if (await chrome.permissions.contains({ origins: [GOOGLE_ACCOUNTS] })) {
    const fromBrowser = await readSignedInGoogleAccount();
    if (fromBrowser) return fromBrowser;
  }

  if (oauthConfigured) {
    try {
      const result = await chrome.identity.getAuthToken({ interactive });
      const token = typeof result === "string" ? result : result && result.token;
      if (token) {
        const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const u = await res.json();
          const picture = u.picture ? sharpPhoto(u.picture) : "";
          return { name: u.name, givenName: u.given_name, email: u.email, picture, google: true, source: "oauth" };
        }
        if (res.status === 401) await chrome.identity.removeCachedAuthToken({ token });
      }
    } catch {}
  }
  if (interactive) return null;

  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
    if (info.email) return { email: info.email, google: false };
  } catch {}
  return null;
}

function renderProfile() {
  const avatar = $("avatar");
  avatar.innerHTML = "";
  if (profile && profile.picture) {
    const img = document.createElement("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = profile.picture;
    img.onerror = () => (avatar.textContent = initial());
    avatar.append(img);
  } else {
    avatar.textContent = initial();
  }

  $("whoName").textContent = (profile && profile.name) || "Guest";
  $("whoEmail").textContent = (profile && profile.email) || "Not signed in";
  $("signInBtn").hidden = !!(profile && profile.google);
  $("signOutBtn").hidden = !(profile && profile.google);
}

function initial() {
  return (displayName() || (profile && profile.email) || "?").charAt(0).toUpperCase();
}

function setProfile(next) {
  profile = next;
  if (inExtension) chrome.storage.local.set({ profile });
  renderProfile();
  setFocus(focusIndex, false);
}

function showSignInNote(text) {
  $("signInNote").textContent = text;
  $("signInNote").hidden = false;
}

function isAddTile(i) {
  return i === state.shortcuts.length;
}

function renderTiles() {
  const box = $("tiles");
  box.innerHTML = "";

  state.shortcuts.forEach((sc, i) => {
    const slot = document.createElement("div");
    slot.className = "slot";

    const tile = document.createElement("button");
    tile.className = "tile";
    tile.title = sc.name;

    const icon = document.createElement("img");
    icon.className = "icon";
    icon.alt = "";
    icon.src = faviconOf(sc.url, 128);
    icon.onerror = () => {
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = sc.name.charAt(0).toUpperCase();
      icon.replaceWith(letter);
    };
    tile.append(icon);
    decorateTile(tile, sc);

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = sc.name;

    tile.onclick = () => (focusIndex === i ? openFocused() : setFocus(i));
    slot.append(tile, label);
    box.append(slot);
  });

  const addSlot = document.createElement("div");
  addSlot.className = "slot";
  const add = document.createElement("button");
  add.className = "tile add";
  add.textContent = "+";
  add.title = "Add to home";
  add.onclick = () => (isAddTile(focusIndex) ? openFocused() : setFocus(state.shortcuts.length));
  const addLabel = document.createElement("span");
  addLabel.className = "label";
  addLabel.textContent = "Add";
  addSlot.append(add, addLabel);
  box.append(addSlot);

  setFocus(Math.min(focusIndex, state.shortcuts.length), false);
}

// ---------- Tile colour and artwork ----------

const COLOR_TTL = 7 * 24 * 60 * 60 * 1000;
const logoHues = {}; // host -> hue of its logo, also used for the page background

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// The logo's main colour: the most common clearly-coloured hue, ignoring whites, blacks and greys.
// Returns [h, s, l] or null for black-and-white logos.
function dominantColor(pixels) {
  const buckets = Array.from({ length: 12 }, () => ({ n: 0, h: 0, s: 0, l: 0 }));
  let opaque = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;
    opaque++;
    const [h, s, l] = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (s < 0.3 || l < 0.15 || l > 0.9) continue;
    const b = buckets[Math.floor(h / 30) % 12];
    b.n++;
    b.h += h;
    b.s += s;
    b.l += l;
  }
  const best = buckets.reduce((a, b) => (b.n > a.n ? b : a));
  if (!opaque || best.n < opaque * 0.04) return null;
  return [best.h / best.n, best.s / best.n, best.l / best.n];
}

// Needs the manifest's host permission for Google's favicon service to read the pixels.
async function logoColor(url) {
  const key = `color:${hostOf(url)}`;
  const cached = (await images.get([key]))[key];
  if (cached && Date.now() - cached.ts < COLOR_TTL) return cached.c;

  let c = null;
  try {
    const blob = await (await fetch(faviconOf(url, 64))).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, 32, 32);
    c = dominantColor(ctx.getImageData(0, 0, 32, 32).data);
  } catch {
    return null; // can't read the logo here (e.g. outside the extension); try again next time
  }
  await images.set(key, { c, ts: Date.now() });
  return c;
}

// A dark, rich version of the logo's colour so the logo itself still pops on the tile.
function paintTile(tile, color) {
  if (!color) return;
  const [h, s] = color;
  const sat = Math.round(Math.min(s, 0.75) * 100);
  tile.style.setProperty("--c1", `hsl(${Math.round(h)} ${sat}% 32%)`);
  tile.style.setProperty("--c2", `hsl(${Math.round(h)} ${sat}% 13%)`);
}

async function decorateTile(tile, sc) {
  const host = hostOf(sc.url);

  logoColor(sc.url).then((color) => {
    paintTile(tile, color);
    if (color) {
      logoHues[host] = Math.round(color[0]);
      if (state.shortcuts[focusIndex] === sc) document.body.style.setProperty("--h", logoHues[host]);
    }
  });

  // Artwork inside the tile: your own background image, else the site's share image.
  const custom = (await images.get([`bg:${host}`]))[`bg:${host}`];
  const src = custom || (await shareImageOf(sc.url));
  if (!src) return;
  const art = document.createElement("img");
  art.className = "art";
  art.alt = "";
  art.onload = () => {
    if (art.naturalWidth >= 300) tile.classList.add("has-art");
    else art.remove();
  };
  art.onerror = () => art.remove();
  art.src = src;
  tile.prepend(art);
}

function setFocus(i, animate = true) {
  const slots = [...$("tiles").children];
  focusIndex = Math.max(0, Math.min(i, slots.length - 1));
  slots.forEach((s, n) => s.classList.toggle("focused", n === focusIndex));
  slots[focusIndex].scrollIntoView({ inline: "nearest", block: "nearest", behavior: animate ? "smooth" : "auto" });
  toggleMenu(false);
  $("heroKicker").textContent = greetingText();

  $("heroMeta").hidden = true;
  if (isAddTile(focusIndex)) {
    $("heroTitle").textContent = "Add to home";
    $("heroSub").textContent = "Pin a site you visit often";
    $("openLabel").textContent = "Add";
    $("openIcon").hidden = true;
    $("moreBtn").hidden = true;
    document.body.style.setProperty("--h", 220);
  } else {
    const sc = state.shortcuts[focusIndex];
    $("heroTitle").textContent = sc.name;
    $("heroSub").textContent = hostOf(sc.url);
    $("openLabel").textContent = "Open";
    $("openIcon").hidden = false;
    $("moreBtn").hidden = false;
    const host = hostOf(sc.url);
    document.body.style.setProperty("--h", host in logoHues ? logoHues[host] : hueOf(host));
  }

  renderStage();

  // Replay the hero entrance animation on each move.
  const hero = $("heroTitle").closest(".hero");
  hero.style.animation = "none";
  void hero.offsetWidth;
  hero.style.animation = "";
}

// Builds the full-screen background for the focused tile and crossfades it in.
async function renderStage() {
  const token = ++stageToken;
  const layer = document.createElement("div");
  layer.className = "layer";

  if (!isAddTile(focusIndex)) {
    const sc = state.shortcuts[focusIndex];
    const host = hostOf(sc.url);
    layer.style.setProperty("--th", hueOf(host));

    const saved = await images.get([`bg:${host}`, `shot:${host}`]);
    if (token !== stageToken) return;
    const custom = saved[`bg:${host}`];
    const shot = saved[`shot:${host}`];

    // Ambient colour glow sits underneath while the preview loads (or if it never does).
    const glow = document.createElement("img");
    glow.className = "glow";
    glow.alt = "";
    glow.src = faviconOf(sc.url, 256);
    glow.onerror = () => glow.remove();
    layer.append(glow);

    if (custom || shot) {
      addPhoto(layer, custom || shot.data, 0, custom ? "" : "shot");
      if (!custom) {
        $("heroMeta").textContent = `Last visit ${timeAgo(shot.ts)}`;
        $("heroMeta").hidden = false;
      }
    } else {
      shareImageOf(sc.url).then((src) => {
        if (src && token === stageToken) addPhoto(layer, src, 600);
      });
    }
  }

  const stage = $("stage");
  stage.append(layer);
  requestAnimationFrame(() => {
    // Only the newest layer cleans up; otherwise two quick moves can remove each other.
    if (token !== stageToken) return layer.remove();
    layer.classList.add("show");
    [...stage.children].forEach((old) => {
      if (old === layer) return;
      old.classList.remove("show");
      setTimeout(() => {
        if (!old.classList.contains("show")) old.remove();
      }, 800);
    });
  });
}

// Images smaller than minWidth (tiny logos) are skipped so the colour glow stays instead.
function addPhoto(layer, src, minWidth = 0, extraClass = "") {
  const photo = document.createElement("img");
  photo.className = `photo ${extraClass}`.trim();
  photo.alt = "";
  photo.onload = () => {
    if (photo.naturalWidth >= minWidth) layer.classList.add("has-photo");
    else photo.remove();
  };
  photo.src = src;
  layer.append(photo);
}

const SHARE_IMAGE_TTL = 3 * 24 * 60 * 60 * 1000;
let sitePermission = false;

// The banner a site shows when its link is shared (og:image). Fetched by your own browser,
// so it gets past the "are you a robot?" pages a screenshot service runs into. Cached for 3 days.
async function shareImageOf(url) {
  if (!sitePermission) return "";
  const key = `og:${url}`;
  const cached = (await images.get([key]))[key];
  // "checked" marks entries made since the artwork check below was added.
  if (cached && cached.checked && Date.now() - cached.ts < SHARE_IMAGE_TTL) return cached.src;

  let src = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { credentials: "include", signal: controller.signal });
    const html = await res.text();
    clearTimeout(timer);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const found = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]',
    ]
      .map((sel) => doc.querySelector(sel))
      .find((el) => el && el.content);
    if (found) src = new URL(found.content, res.url).href;
    if (src && !(await looksLikeArtwork(src))) src = "";
  } catch {}

  await images.set(key, { src, ts: Date.now(), checked: true });
  return src;
}

// Many share images are just a logo on a plain white (or single-colour) background, like
// YouTube's. Those look bad as tile art or backgrounds, so only keep busy, colourful pictures.
async function looksLikeArtwork(src) {
  try {
    const blob = await (await fetch(src)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(48, 48);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, 48, 48);
    return isArtworkPixels(ctx.getImageData(0, 0, 48, 48).data);
  } catch {
    return false;
  }
}

function isArtworkPixels(pixels) {
  const total = pixels.length / 4;
  let white = 0;
  const counts = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a > 128 && r > 230 && g > 230 && b > 230) white++;
    // Coarse colour buckets; see-through pixels all count as one "plain background" bucket.
    const bucket = a < 128 ? "clear" : `${r >> 5},${g >> 5},${b >> 5}`;
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  // Logos use a handful of flat colours; real artwork spreads across many.
  const sorted = [...counts.values()].sort((a, b) => b - a);
  const plainest = sorted[0] / total;
  const topThree = (sorted[0] + (sorted[1] || 0) + (sorted[2] || 0)) / total;
  return white / total < 0.35 && plainest < 0.5 && topThree < 0.75;
}

// null = adding a new site, otherwise the index of the site being edited.
let editIndex = null;

function openSiteDialog(index = null) {
  editIndex = index;
  $("shortcutForm").reset();
  $("scTitle").textContent = index === null ? "Add to home" : "Edit site";
  $("scSave").textContent = index === null ? "Add" : "Save";
  if (index !== null) {
    $("scName").value = state.shortcuts[index].name;
    $("scUrl").value = state.shortcuts[index].url;
  }
  $("addShortcut").showModal();
  $("scName").select();
}

function toggleMenu(open = $("menu").hidden) {
  if (isAddTile(focusIndex)) open = false;
  $("menu").hidden = !open;
  $("moreBtn").setAttribute("aria-expanded", String(open));
  if (open) {
    $("menuTitle").textContent = state.shortcuts[focusIndex].name;
    $("renameBtn").focus();
  }
}

function openFocused() {
  if (isAddTile(focusIndex)) {
    openSiteDialog();
  } else {
    location.href = state.shortcuts[focusIndex].url;
  }
}

function openSearch() {
  $("searchOverlay").hidden = false;
  $("q").value = "";
  renderSuggestions([]);
  $("q").focus();
}

function closeSearch() {
  $("searchOverlay").hidden = true;
}

function runSearch(text) {
  // Uses the user's default search engine inside the extension.
  if (inExtension && chrome.search) {
    chrome.search.query({ text, disposition: "CURRENT_TAB" });
  } else {
    location.href = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  }
}

// ---------- Search suggestions ----------

let suggestions = []; // [{ type: "site", name, url } | { type: "search", text }]
let activeSuggestion = -1;
let typedText = "";
let suggestSeq = 0;
let suggestTimer;

// Your home sites that match what you typed, by name or address.
function matchingSites(text) {
  const t = text.toLowerCase();
  return state.shortcuts
    .filter((s) => s.name.toLowerCase().includes(t) || hostOf(s.url).includes(t))
    .slice(0, 3)
    .map((s) => ({ type: "site", name: s.name, url: s.url }));
}

// The same suggestions Chrome's address bar shows (needs the manifest's host permission).
async function googleSuggestions(text) {
  try {
    const lang = encodeURIComponent(navigator.language || "en");
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=chrome&ie=utf-8&oe=utf-8&hl=${lang}&q=${encodeURIComponent(text)}`
    );
    const data = await res.json();
    return (data[1] || []).slice(0, 6);
  } catch {
    return [];
  }
}

async function updateSuggestions() {
  const text = $("q").value.trim();
  typedText = $("q").value;
  const seq = ++suggestSeq;
  if (!text) return renderSuggestions([]);

  const sites = matchingSites(text);
  renderSuggestions([...sites, { type: "search", text }]);

  const words = await googleSuggestions(text);
  if (seq !== suggestSeq) return; // a newer keystroke already ran
  const searches = [text, ...words.filter((w) => w.toLowerCase() !== text.toLowerCase())]
    .slice(0, 7)
    .map((w) => ({ type: "search", text: w }));
  renderSuggestions([...sites, ...searches]);
}

// Bold the part of a suggestion that you haven't typed yet, like Google does.
function highlighted(text, typed) {
  const span = document.createElement("span");
  span.className = "s-text";
  const t = typed.trim().toLowerCase();
  if (t && text.toLowerCase().startsWith(t)) {
    span.append(text.slice(0, t.length));
    const rest = document.createElement("b");
    rest.textContent = text.slice(t.length);
    span.append(rest);
  } else {
    span.textContent = text;
  }
  return span;
}

function renderSuggestions(items) {
  suggestions = items;
  activeSuggestion = -1;
  const list = $("suggestions");
  list.innerHTML = "";

  items.forEach((item, i) => {
    if (i > 0 && item.type === "search" && items[i - 1].type === "site") {
      const divider = document.createElement("li");
      divider.className = "s-divider";
      divider.setAttribute("role", "separator");
      list.append(divider);
    }

    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.dataset.index = i;
    const icon = document.createElement("span");
    icon.className = "s-icon";

    if (item.type === "site") {
      const img = document.createElement("img");
      img.alt = "";
      img.src = faviconOf(item.url, 64);
      icon.append(img);
      const text = highlighted(item.name, typedText);
      const sub = document.createElement("span");
      sub.className = "s-sub";
      sub.textContent = hostOf(item.url);
      text.append(sub);
      const tag = document.createElement("span");
      tag.className = "s-tag";
      tag.textContent = "Open";
      li.append(icon, text, tag);
    } else {
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
      li.append(icon, highlighted(item.text, typedText));
    }

    li.onmousedown = (e) => e.preventDefault(); // keep focus in the search box
    li.onclick = () => chooseSuggestion(item);
    list.append(li);
  });

  list.hidden = items.length === 0;
  $("q").setAttribute("aria-expanded", String(items.length > 0));
}

function moveSuggestion(step) {
  if (!suggestions.length) return;
  const count = suggestions.length;
  // -1 means "back to what you typed"
  activeSuggestion = ((activeSuggestion + 1 + step + count + 1) % (count + 1)) - 1;
  $("suggestions")
    .querySelectorAll("li[role=option]")
    .forEach((li) => li.classList.toggle("active", Number(li.dataset.index) === activeSuggestion));

  const item = suggestions[activeSuggestion];
  $("q").value = !item ? typedText : item.type === "search" ? item.text : item.name;
}

function chooseSuggestion(item) {
  if (item.type === "site") location.href = item.url;
  else runSearch(item.text);
}

$("q").addEventListener("input", () => {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(updateSuggestions, 120);
});

// Shrinks an uploaded picture so it fits comfortably in storage.
async function fileToDataUrl(file, maxWidth = 1920) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

// ---------- Events ----------

$("openBtn").onclick = openFocused;
$("moreBtn").onclick = (e) => {
  e.stopPropagation();
  toggleMenu();
};
$("menu").onclick = (e) => e.stopPropagation();
document.addEventListener("click", () => {
  toggleMenu(false);
  $("profileMenu").hidden = true;
});

$("renameBtn").onclick = () => {
  toggleMenu(false);
  openSiteDialog(focusIndex);
};

$("avatar").onclick = (e) => {
  e.stopPropagation();
  $("signInNote").hidden = true;
  $("profileMenu").hidden = !$("profileMenu").hidden;
};
$("profileMenu").onclick = (e) => e.stopPropagation();

$("signInBtn").onclick = async () => {
  if (!hasIdentity) return showSignInNote("Google sign-in works once this page runs as the installed extension.");

  // Ask first (Chrome needs this straight from the click), then read the signed-in account.
  const granted = await chrome.permissions.request({ origins: [GOOGLE_ACCOUNTS] });
  let next = granted ? await readSignedInGoogleAccount() : null;
  if (!next && oauthConfigured) next = await loadProfile(true);

  if (next) {
    setProfile(next);
    $("profileMenu").hidden = true;
  } else if (!granted) {
    showSignInNote("Chrome needs your OK to read your Google account. Try again and choose Allow.");
  } else {
    showSignInNote("No Google account is signed in. Sign in at google.com, then try again.");
  }
};

$("signOutBtn").onclick = async () => {
  if (profile && profile.source === "browser") {
    // Only disconnects this page; you stay signed in to Google.
    await chrome.permissions.remove({ origins: [GOOGLE_ACCOUNTS] });
    setProfile(await loadProfile(false));
    $("profileMenu").hidden = true;
    return;
  }
  try {
    const result = await chrome.identity.getAuthToken({ interactive: false });
    const token = typeof result === "string" ? result : result && result.token;
    if (token) {
      await chrome.identity.removeCachedAuthToken({ token });
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
    }
    await chrome.identity.clearAllCachedAuthTokens();
  } catch {}
  setProfile(await loadProfile(false));
  $("profileMenu").hidden = true;
};

$("removeBtn").onclick = () => {
  const host = hostOf(state.shortcuts[focusIndex].url);
  images.remove([`bg:${host}`, `shot:${host}`]);
  state.shortcuts.splice(focusIndex, 1);
  store.set({ shortcuts: state.shortcuts });
  renderTiles();
};

$("bgBtn").onclick = () => {
  toggleMenu(false);
  $("bgForm").reset();
  $("bgFor").textContent = state.shortcuts[focusIndex].name;
  $("bgDialog").showModal();
};

$("bgDialog").addEventListener("close", async () => {
  const action = $("bgDialog").returnValue;
  if (action !== "save" && action !== "reset") return;
  const key = `bg:${hostOf(state.shortcuts[focusIndex].url)}`;

  if (action === "reset") {
    await images.remove([key]);
  } else {
    const file = $("bgFile").files[0];
    const url = $("bgUrl").value.trim();
    if (file) await images.set(key, await fileToDataUrl(file));
    else if (url) await images.set(key, url);
    else return;
  }
  setFocus(focusIndex, false);
});

$("searchBtn").onclick = openSearch;
$("searchOverlay").onclick = (e) => {
  if (e.target === $("searchOverlay")) closeSearch();
};
$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const picked = suggestions[activeSuggestion];
  if (picked) return chooseSuggestion(picked);
  const text = $("q").value.trim();
  if (text) runSearch(text);
});

document.addEventListener("keydown", (e) => {
  if (!$("searchOverlay").hidden) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveSuggestion(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Escape") {
      closeSearch();
    }
    return;
  }
  if (document.querySelector("dialog[open]")) return;

  // While the options menu is open, arrows move through it and Enter picks (the browser clicks the focused item).
  if (!$("menu").hidden) {
    const items = [...$("menu").querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(i + step + items.length) % items.length].focus();
    } else if (e.key === "Escape" || e.key.toLowerCase() === "o") {
      toggleMenu(false);
      $("moreBtn").focus();
    }
    return;
  }

  if (e.key.toLowerCase() === "o" && !isAddTile(focusIndex)) {
    e.preventDefault();
    toggleMenu(true);
  } else if (e.key === "/") {
    e.preventDefault();
    openSearch();
  } else if (e.key === "ArrowRight") setFocus(focusIndex + 1);
  else if (e.key === "ArrowLeft") setFocus(focusIndex - 1);
  else if (e.key === "Enter") {
    e.preventDefault();
    openFocused();
  }
});

// Share images and live snapshots both need permission to read your sites;
// Chrome only lets us ask straight from a click.
async function askSitePermission() {
  sitePermission = await chrome.permissions.request({ origins: ["<all_urls>"] });
  $("previewCta").hidden = sitePermission;
  return sitePermission;
}

$("previewCtaBtn").onclick = async () => {
  if (!(await askSitePermission())) return;
  state.livePreviews = true;
  store.set({ livePreviews: true });
  setFocus(focusIndex, false);
};

$("livePreviews").addEventListener("change", async (e) => {
  if (e.target.checked && !(await askSitePermission())) e.target.checked = false;
});

function renderClockSample() {
  const sample = new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: !$("clock24").checked,
  });
  $("clockSample").textContent = `Show the time in the top bar as 24-hour (13:00) instead of AM/PM. Right now: ${sample}`;
}

$("clock24").addEventListener("change", renderClockSample);

$("settingsBtn").onclick = () => {
  $("clock24").checked = state.clock24;
  $("livePreviews").checked = state.livePreviews && sitePermission;
  $("setAvatar").innerHTML = $("avatar").innerHTML;
  $("setName").textContent = $("whoName").textContent;
  $("setEmail").textContent = (profile && profile.email) || "Not connected to Google";
  renderClockSample();
  $("settings").showModal();
};

$("settings").addEventListener("close", () => {
  if ($("settings").returnValue !== "save") return;
  state.clock24 = $("clock24").checked;
  state.livePreviews = $("livePreviews").checked;
  store.set({ clock24: state.clock24, livePreviews: state.livePreviews });
  renderClock();
  renderProfile();
  setFocus(focusIndex, false);
});

$("addShortcut").addEventListener("close", () => {
  if ($("addShortcut").returnValue !== "save") return;
  const name = $("scName").value.trim();
  let url = $("scUrl").value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;

  if (editIndex === null) {
    state.shortcuts.push({ name, url });
    focusIndex = state.shortcuts.length - 1;
  } else {
    const oldHost = hostOf(state.shortcuts[editIndex].url);
    const newHost = hostOf(url);
    state.shortcuts[editIndex] = { name, url };
    focusIndex = editIndex;
    if (oldHost !== newHost) moveBackgrounds(oldHost, newHost);
  }
  store.set({ shortcuts: state.shortcuts });
  renderTiles();
});

// Keep a site's custom background and snapshot when its link moves to a new address.
async function moveBackgrounds(oldHost, newHost) {
  const keys = ["bg", "shot"];
  const saved = await images.get(keys.map((k) => `${k}:${oldHost}`));
  for (const k of keys) {
    const value = saved[`${k}:${oldHost}`];
    if (value) await images.set(`${k}:${newHost}`, value);
  }
  await images.remove(keys.map((k) => `${k}:${oldHost}`));
  setFocus(focusIndex, false);
}

(async function init() {
  state = await store.get();
  if (inExtension) {
    $("liveRow").hidden = false;
    sitePermission = await chrome.permissions.contains({ origins: ["<all_urls>"] });
    $("previewCta").hidden = sitePermission;
    // The background worker reads the list of sites, so make sure it is saved at least once.
    const saved = await chrome.storage.sync.get("shortcuts");
    if (!saved.shortcuts) store.set({ shortcuts: state.shortcuts });
    // Show the last known profile instantly, then refresh it quietly.
    profile = (await chrome.storage.local.get("profile")).profile || null;
  }
  renderClock();
  renderProfile();
  renderTiles();
  setInterval(renderClock, 1000);

  const fresh = await loadProfile(false);
  if (fresh) setProfile(fresh);
})();
