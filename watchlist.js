import { $, genres, state } from "./core.js";
import { rememberRuntime } from "./details.js";
import { finalCombinedScore } from "./ratings.js";
import { renderCard, renderResults } from "./render.js";
import { apiWithRetry, hasTmdbAccess } from "./tmdb.js";

const changeListeners = [];
// Lets other modules (sync) react to watchlist changes without an import cycle.
export function onWatchlistChange(fn) {
  changeListeners.push(fn);
}
export function markUpdated(item) {
  item._updated = Date.now();
}
export function persistWatchlist({ silent = false } = {}) {
  try {
    localStorage.setItem("screenscore_watchlist", JSON.stringify(state.watchlist));
    localStorage.setItem("screenscore_tombstones", JSON.stringify(state.tombstones));
  } catch (e) {}
  if (!silent) changeListeners.forEach((fn) => fn());
}

export function toggleWatch(x) {
  const i = state.watchlist.findIndex((y) => y.id === x.id && y.media_type === x.media_type);
  if (i >= 0) {
    state.watchlist.splice(i, 1);
    // Remember the deletion so a synced device does not bring the title back.
    state.tombstones[`${x.media_type}:${x.id}`] = Date.now();
  } else {
    const item = { ...x, _watchStatus: "want" };
    markUpdated(item);
    delete state.tombstones[`${x.media_type}:${x.id}`];
    state.watchlist.unshift(item);
  }
  persistWatchlist();
  renderWatchlist();
  renderResults();
}

export function updateWatchStatus(x, status) {
  const item = state.watchlist.find((y) => y.id === x.id && y.media_type === x.media_type);
  if (item) {
    item._watchStatus = status;
    markUpdated(item);
    if (status === "watched" && !item.watchedDate) item.watchedDate = new Date().toISOString().slice(0, 10);
    if (status === "watched") ensureRuntime(item);
    persistWatchlist();
    renderWatchlist();
  }
}

export function updatePersonalRating(x, value) {
  const item = state.watchlist.find((y) => y.id === x.id && y.media_type === x.media_type);
  if (item) {
    item.personalRating = value ? Number(value) : null;
    markUpdated(item);
    if (value && item._watchStatus !== "watched") {
      item._watchStatus = "watched";
      item.watchedDate = item.watchedDate || new Date().toISOString().slice(0, 10);
      ensureRuntime(item);
    }
    persistWatchlist();
    renderWatchlist();
  }
}

export async function ensureRuntime(item) {
  if (Number(item._runtime) > 0 || !hasTmdbAccess()) return;
  try {
    const d = await apiWithRetry(`/${item.media_type}/${item.id}`, {});
    const rt = item.media_type === "movie" ? Number(d.runtime) : Number((d.episode_run_time || [])[0]) || Number(d.last_episode_to_air?.runtime);
    if (rt > 0) rememberRuntime(item, rt);
  } catch (e) {}
}

export function renderWatchlist() {
  const c = $("watchlist");
  c.innerHTML = "";
  const status = $("watchStatusFilter").value,
    genre = $("watchGenreFilter").value,
    min = Number($("watchRatingFilter").value) || 0;
  const filtered = state.watchlist.filter((x) => {
    if (status !== "all" && (x._watchStatus || "want") !== status) return false;
    if (genre !== "all" && !(x.genre_ids || []).includes(Number(genre))) return false;
    if (finalCombinedScore(x) < min) return false;
    return true;
  });
  $("watchCount").textContent = `${filtered.length}/${state.watchlist.length}`;
  if (!state.watchlist.length) {
    c.innerHTML = '<div class="empty-state">Δεν έχεις αποθηκεύσει ακόμη τίτλους. Πάτησε ♡ Watchlist σε μια ταινία ή σειρά.</div>';
    return;
  }
  if (!filtered.length) {
    c.innerHTML = '<div class="empty-state">Δεν βρέθηκαν τίτλοι με αυτά τα φίλτρα watchlist.</div>';
    return;
  }
  filtered.forEach((x) => renderCard(x, c, true));
}

export function populateWatchGenres() {
  const seen = new Set(),
    list = [];
  [...genres.movie, ...genres.tv].forEach((g) => {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      list.push(g);
    }
  });
  $("watchGenreFilter").innerHTML =
    '<option value="all">Όλα τα είδη</option>' + list.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
}
