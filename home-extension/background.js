// Live previews: when you look at one of your home sites, save a snapshot of it
// so the home screen can use it as that tile's background.

const COOLDOWN_MS = 10 * 60 * 1000; // at most one snapshot per site every 10 minutes
const SETTLE_MS = 1500; // let the page finish drawing before the snapshot

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Exact host first, so mail.google.com matches Gmail rather than Google.
function findShortcut(shortcuts, host) {
  return (
    shortcuts.find((s) => hostOf(s.url) === host) ||
    shortcuts.find((s) => host.endsWith("." + hostOf(s.url)))
  );
}

async function shrink(dataUrl, maxWidth) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return "data:image/jpeg;base64," + btoa(binary);
}

async function maybeCapture(tab) {
  if (!tab || !tab.active || tab.incognito || !/^https?:/.test(tab.url || "")) return;

  const { livePreviews, shortcuts } = await chrome.storage.sync.get({ livePreviews: false, shortcuts: [] });
  if (!livePreviews) return;
  if (!(await chrome.permissions.contains({ origins: ["<all_urls>"] }))) return;

  const match = findShortcut(shortcuts, hostOf(tab.url));
  if (!match) return;

  const key = `shot:${hostOf(match.url)}`;
  const previous = (await chrome.storage.local.get(key))[key];
  if (previous && Date.now() - previous.ts < COOLDOWN_MS) return;

  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const [current] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (!current || current.id !== tab.id || hostOf(current.url) !== hostOf(tab.url)) return;

  try {
    const raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
    const data = await shrink(raw, 1600);
    await chrome.storage.local.set({ [key]: { data, ts: Date.now() } });
  } catch {
    // The window was minimised, the tab changed, or Chrome refused (e.g. a chrome:// page).
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete") maybeCapture(tab);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    maybeCapture(await chrome.tabs.get(tabId));
  } catch {}
});
