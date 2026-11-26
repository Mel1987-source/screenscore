// Watchlist + profile sync between devices through your own Cloudflare Worker (KV storage).
// Merge rule per title: the most recent change wins; deletions are kept as "tombstones" for 90 days.
import { saveJson, state } from "./core.js";
import { onWatchlistChange, persistWatchlist, renderWatchlist } from "./watchlist.js";

const TOMBSTONE_DAYS = 90;
let pushTimer = null;
let syncing = false;

export function syncConfigured() {
  return Boolean(state.proxy && state.syncToken);
}
function syncUrl() {
  return state.proxy.replace(/\/$/, "") + "/sync";
}
function setSyncStatus(text) {
  const el = document.getElementById("syncStatus");
  if (el) el.textContent = text;
}
const keyOf = (x) => `${x.media_type}:${x.id}`;

export function mergeDocs(local, remote) {
  const tomb = { ...(remote.tombstones || {}) };
  for (const [k, t] of Object.entries(local.tombstones || {})) tomb[k] = Math.max(t, tomb[k] || 0);
  const byKey = new Map();
  for (const x of [...(remote.watchlist || []), ...(local.watchlist || [])]) {
    const k = keyOf(x);
    const cur = byKey.get(k);
    if (!cur || (x._updated || 0) > (cur._updated || 0)) byKey.set(k, x);
  }
  const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
  const watchlist = [...byKey.values()].filter((x) => !(tomb[keyOf(x)] > (x._updated || 0)));
  for (const [k, t] of Object.entries(tomb)) if (t < cutoff) delete tomb[k];
  // Keep the local order first (it reflects how this device shows the list), then new remote titles.
  const order = new Map((local.watchlist || []).map((x, i) => [keyOf(x), i]));
  watchlist.sort((a, b) => (order.get(keyOf(a)) ?? 1e9) - (order.get(keyOf(b)) ?? 1e9) || (b._updated || 0) - (a._updated || 0));
  const profile = (local.profile?._updated || 0) >= (remote.profile?._updated || 0) ? local.profile : remote.profile;
  return { watchlist, tombstones: tomb, profile: profile || {} };
}

async function request(method, body) {
  const r = await fetch(syncUrl(), {
    method,
    headers: { Authorization: `Bearer ${state.syncToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw new Error("Λάθος κωδικός συγχρονισμού");
  if (!r.ok) throw new Error(`Συγχρονισμός: σφάλμα ${r.status}`);
  return r.status === 204 ? null : r.json();
}

export async function syncNow() {
  if (!syncConfigured() || syncing) return;
  syncing = true;
  setSyncStatus("Συγχρονισμός…");
  try {
    const remote = (await request("GET")) || {};
    const merged = mergeDocs({ watchlist: state.watchlist, tombstones: state.tombstones, profile: state.profile }, remote);
    state.watchlist = merged.watchlist;
    state.tombstones = merged.tombstones;
    state.profile = merged.profile;
    saveJson("screenscore_profile", state.profile);
    persistWatchlist({ silent: true });
    renderWatchlist();
    await request("PUT", { ...merged, updated: Date.now() });
    setSyncStatus(`Συγχρονίστηκε ${new Date().toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })} · ${state.watchlist.length} τίτλοι`);
  } catch (e) {
    setSyncStatus(e.message || "Ο συγχρονισμός απέτυχε");
  } finally {
    syncing = false;
  }
}

export function startSync() {
  onWatchlistChange(() => {
    if (!syncConfigured()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, 2000);
  });
  // Pull changes made on the other device whenever the app comes back to the foreground.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
  });
  syncNow();
}
