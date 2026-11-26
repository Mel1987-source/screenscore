import { $, dateParams, dateStr, escapeHtml, genreForType, includeAnimation, normalize, periodRange, setStatus, state } from "./core.js";
import { hasImdbData, imdbDataDate, queryImdbData } from "./imdbData.js";
import { CINOBO_MIN_VOTES, MIN_IMDB_RATING, MIN_IMDB_VOTES, enrichImdb, finalCombinedScore, finalSort, imdbCoverageNote, isEligible } from "./ratings.js";
import { renderResults, renderSkeleton } from "./render.js";
import { updateUrlFromFilters } from "./router.js";
import { matchesService, selectedServices } from "./services.js";
import { apiWithRetry, fetchPages, mapLimit } from "./tmdb.js";

// Every load gets a sequence number; results from an older, superseded load are discarded.
export let loadSeq = 0;

export function beginLoad() {
  const my = ++loadSeq;
  renderSkeleton();
  return () => my !== loadSeq;
}

export function dedupe(rows) {
  const seen = new Set();
  return rows.filter((x) => {
    const id = `${x.media_type}:${x.id}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export const SORT_PARAM = {
  // Ranked by IMDb afterwards; TMDB is asked for its most-voted titles so the candidates are the well-known ones.
  score: () => "vote_count.desc",
  popular: () => "popularity.desc",
  votes: () => "vote_count.desc",
  newest: (type) => (type === "movie" ? "primary_release_date.desc" : "first_air_date.desc"),
};

export const SORT_LABEL = { score: "Καλύτερη αξιολόγηση", popular: "Δημοφιλέστερα", votes: "Περισσότερες ψήφοι", newest: "Νεότερα" };

// Builds TMDB /discover params from the main filters, so filtering happens on TMDB's side.
export function discoverParams(type, sort) {
  const params = {
    sort_by: SORT_PARAM[sort](type),
    "vote_count.gte": 50, // loose: the real threshold is ≥1,000 IMDb votes (being in the dataset)
    include_adult: state.showAdult,
  };
  const country = $("countryFilter").value;
  if (country !== "all") params.with_origin_country = country;
  const language = $("languageFilter").value;
  if (language !== "all") params.with_original_language = language;
  // The min-rating filter applies to the shown (IMDb) rating. TMDB pre-filters loosely, since a title can be
  // rated ~1 point lower on TMDB than on IMDb; the exact cut happens after IMDb is fetched.
  // No TMDB rating filter: the minimum rating is applied to the IMDb rating afterwards.
  Object.assign(params, dateParams(type, periodRange($("periodFilter").value)));
  if (sort === "newest") {
    // Exclude announced-but-unreleased titles from "newest".
    const f = type === "movie" ? "primary_release_date" : "first_air_date";
    params[`${f}.lte`] = params[`${f}.lte`] && params[`${f}.lte`] < dateStr(new Date()) ? params[`${f}.lte`] : dateStr(new Date());
  }
  if (state.genre !== "all") {
    const g = genreForType(state.genre, type);
    if (g === null) return null; // this genre does not exist for this media type
    params.with_genres = g;
  }
  if (!includeAnimation() && String(state.genre) !== "16") params.without_genres = "16";
  return params;
}

export function passesLocalFilters(x) {
  if (!includeAnimation() && String(state.genre) !== "16" && (x.genre_ids || []).includes(16)) return false;
  if (!state.showAdult && x.adult) return false;
  return true;
}

export async function searchTitles(query, type, isStale) {
  setStatus(`Αναζήτηση «${query}» σε όλο το TMDB…`);
  const pages = await mapLimit([1, 2, 3], 3, (page) =>
    apiWithRetry("/search/multi", { query, page, language: "el-GR", include_adult: state.showAdult }).catch(() => ({ results: [] })),
  );
  if (isStale()) return [];
  return pages
    .flatMap((d) => d.results || [])
    .filter((x) => (x.media_type === "movie" || x.media_type === "tv") && (type === "all" || x.media_type === type))
    .map((x) => normalize(x, x.media_type));
}

// The dataset covers every main filter except country of origin and "most popular".
export function canUseImdbData() {
  return hasImdbData() && $("countryFilter").value === "all" && $("sortFilter").value !== "popular";
}
function showFromImdbData(type) {
  const items = queryImdbData({
    type,
    genre: state.genre,
    yearRange: periodRange($("periodFilter").value),
    minRating: Number($("minRatingFilter").value) || 0,
    language: $("languageFilter").value,
    where: selectedServices(), // vote floor per title: 500, or 200 on Cinobo
  });
  state.items = finalSort(items, state.sort).slice(0, 100);
  renderResults();
  setStatus(`Ολοκληρώθηκε · Top ${state.items.length} · ${SORT_LABEL[state.sort]} · δεδομένα IMDb ${imdbDataDate()} · ≥${MIN_IMDB_VOTES} ψήφοι (Cinobo ≥${CINOBO_MIN_VOTES})`);
  updateUrlFromFilters();
}
export async function loadDiscover() {
  const isStale = beginLoad();
  const type = $("typeFilter").value;
  state.type = type;
  state.genre = $("genreFilter").value;
  state.sort = $("sortFilter").value;
  state.query = $("searchInput").value.trim();
  $("notice").hidden = true;
  $("resultsTitle").textContent = state.query ? `Αποτελέσματα για «${state.query}»` : "Top 100 ταινίες και σειρές";
  if (!state.query && canUseImdbData()) {
    showFromImdbData(type);
    return;
  }
  if (!state.query && !hasImdbData()) {
    state.items = [];
    renderResults("Λείπουν τα ημερήσια δεδομένα IMDb (data/imdb-titles.json). Οι λίστες κατατάσσονται μόνο με IMDb, οπότε χρειάζεται να τρέξει το GitHub Action (βλ. README). Η αναζήτηση τίτλων λειτουργεί κανονικά.");
    setStatus("Χωρίς δεδομένα IMDb");
    return;
  }
  try {
    let rows;
    if (state.query) {
      // Real title search across all of TMDB; the 500-vote rule is not applied so any title can be found.
      rows = dedupe(await searchTitles(state.query, type, isStale));
    } else {
      // Score mode scans deeper because IMDb can reorder titles; the other modes come pre-sorted from TMDB.
      const maxPages = state.sort === "score" ? 20 : 6;
      const requests = [];
      for (const t of type === "all" ? ["movie", "tv"] : [type]) {
        const params = discoverParams(t, state.sort);
        if (!params) continue;
        requests.push(fetchPages(`/discover/${t}`, params, t, { maxPages, label: t === "movie" ? "Ταινίες" : "Σειρές", isStale }));
      }
      rows = dedupe((await Promise.all(requests)).flat()).filter(passesLocalFilters);
    }
    if (isStale()) return;

    const minRating = state.query ? 0 : Number($("minRatingFilter").value) || 0;
    // TMDB only supplies the candidates. Each gets its IMDb rating from the dataset (no request);
    // lists keep only titles that have one, and are ranked by IMDb. Search keeps everything, in TMDB's relevance order.
    enrichImdb(rows);
    // Search too shows only titles that meet the rules (IMDb ≥6.0 from ≥500 votes).
    let pool = rows.filter((x) => isEligible(x) && finalCombinedScore(x) >= minRating && matchesService(x));
    state.items = state.query ? pool.slice(0, 100) : finalSort(pool, state.sort).slice(0, 100);
    renderResults();
    setStatus(
      state.query
        ? `Αναζήτηση: ${state.items.length} τίτλοι για «${state.query}» · μόνο IMDb ≥${MIN_IMDB_RATING.toFixed(1)} με ≥${MIN_IMDB_VOTES} ψήφους (Cinobo ≥${CINOBO_MIN_VOTES})`
        : `Ολοκληρώθηκε · Top ${state.items.length} · ${SORT_LABEL[state.sort]} · ${imdbCoverageNote(state.items)}`,
    );
    updateUrlFromFilters();
  } catch (e) {
    if (isStale()) return;
    $("results").innerHTML =
      `<div class="empty-state">${escapeHtml(e.message)}<br><br>Η αναζήτηση δεν ολοκληρώθηκε. Μπορείς να ρυθμίσεις τα API keys από το ⚙ και να δοκιμάσεις ξανά.</div>`;
    setStatus("Δεν ολοκληρώθηκε η αναζήτηση");
  }
}
