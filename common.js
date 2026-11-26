import { $, escapeHtml, genres, setStatus, state } from "./core.js";
import { beginLoad, dedupe, passesLocalFilters } from "./discover.js";
import { hasImdbData, imdbDataDate } from "./imdbData.js";
import { enrichImdb, finalSort, imdbCoverageNote, isEligible } from "./ratings.js";
import { renderResults } from "./render.js";
import { matchesService } from "./services.js";
import { hasTmdbAccess } from "./tmdb.js";

// ===== Tools =====
export function showTool(html) {
  const p = $("toolPanel");
  p.innerHTML = html;
  p.hidden = false;
  p.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Rankings need the daily IMDb dataset (data/imdb-titles.json, built by the GitHub Action).
export function requireImdbData() {
  if (hasImdbData()) return true;
  showTool(
    "<strong>Λείπουν τα δεδομένα IMDb.</strong><br>Οι λίστες κατατάσσονται μόνο με βαθμολογίες IMDb από το αρχείο <code>data/imdb-titles.json</code>, που φτιάχνει καθημερινά το GitHub Action (βλ. README). Η αναζήτηση τίτλων λειτουργεί και χωρίς αυτό.",
  );
  return false;
}
export function requireKey() {
  if (!hasTmdbAccess()) {
    showTool("<strong>Χρειάζεται TMDB API key ή Cloudflare Proxy URL.</strong><br>Άνοιξε τις Ρυθμίσεις για να το προσθέσεις.");
    return false;
  }
  return true;
}

export function allGenres() {
  const seen = new Map();
  [...genres.movie, ...genres.tv].forEach((g) => seen.set(g.id, g.name));
  return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "el"));
}

export function genreSelectHtml(id, selected = "", label = "Είδος") {
  return `<label for="${id}">${label}</label><select id="${id}"><option value="">Όλα τα είδη</option>${allGenres()
    .map(([gid, name]) => `<option value="${gid}"${String(gid) === String(selected) ? " selected" : ""}>${escapeHtml(name)}</option>`)
    .join("")}</select>`;
}

export function typeSelectHtml(id) {
  return `<label for="${id}">Τύπος</label><select id="${id}"><option value="all">Ταινίες & σειρές</option><option value="movie">Ταινίες</option><option value="tv">Σειρές</option></select>`;
}

export function typesOf(v) {
  return v === "all" ? ["movie", "tv"] : [v];
}

export function findItemByKey(key) {
  return state.items.find((x) => `${x.media_type}:${x.id}` === key) || state.watchlist.find((x) => `${x.media_type}:${x.id}` === key);
}

export function isInWatchlist(x) {
  return state.watchlist.some((y) => y.id === x.id && y.media_type === x.media_type);
}

export const NON_FICTION_TV = [10763, 10764, 10767];

 // news, reality, talk shows
// Shared pipeline for every tool list: dedupe → filter → TMDB pre-select → IMDb → optional post-filter → final sort.
// Shared pipeline for tool lists: TMDB supplies candidates → IMDb rating from the dataset → filter → rank by IMDb.
// Every tool list keeps only titles that meet the rules (IMDb ≥6.0 from ≥500 votes).
export async function rankAndShow(rows, title, opts = {}) {
  const { sortMode = "score", isStale = beginLoad(), postFilter = null, note = "" } = opts;
  let items = dedupe(rows).filter(passesLocalFilters);
  enrichImdb(items);
  items = items.filter((x) => isEligible(x) && matchesService(x));
  if (postFilter) items = items.filter(postFilter);
  if (isStale()) return;
  $("resultsTitle").textContent = title;
  state.items = finalSort(items, sortMode).slice(0, 100);
  renderResults(`Δεν βρέθηκαν τίτλοι για «${title}» με αυτά τα κριτήρια.`);
  setStatus(state.items.length ? `${title} · ${state.items.length} τίτλοι · ${imdbCoverageNote(state.items)}${note ? " · " + note : ""}` : "Δεν βρέθηκαν αποτελέσματα");
}

// Lists answered from the daily IMDb dataset: no requests, instant.
export function showDatasetList(items, title, note = "") {
  $("resultsTitle").textContent = title;
  state.items = finalSort(items.filter(matchesService), "score").slice(0, 100);
  renderResults(`Δεν βρέθηκαν τίτλοι για «${title}» με αυτά τα κριτήρια.`);
  setStatus(`${title} · ${state.items.length} τίτλοι · δεδομένα IMDb ${imdbDataDate()}${note ? " · " + note : ""}`);
}
// allowDataset: the tool can answer from the IMDb dataset without a TMDB key.
export async function runTool(title, fn, allowDataset = false) {
  if (!(allowDataset && hasImdbData()) && !requireKey()) return;
  try {
    await fn();
  } catch (e) {
    showTool(`<h3>${escapeHtml(title)}</h3><p>${escapeHtml(e.message)}</p>`);
  }
}
