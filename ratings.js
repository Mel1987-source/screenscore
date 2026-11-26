import { datasetImdbFor, datasetItem, hasImdbData } from "./imdbData.js";
import { apiWithRetry } from "./tmdb.js";

// ===== Ratings (v29): IMDb only, from the daily IMDb dataset. TMDB never supplies a rating. =====

// True when the daily IMDb dataset has loaded.
export function imdbAvailable() {
  return hasImdbData();
}

export async function fetchCanonicalImdbId(x) {
  // TMDB's external-ID mapping: used only to link a title that is not in the dataset to its IMDb page.
  if (x._imdb?.imdbID) return x._imdb.imdbID;
  const cacheKey = `tmdb-imdb:${x.media_type}:${x.id}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached !== null) return cached || "";
  } catch (e) {}
  try {
    const data = await apiWithRetry(`/${x.media_type}/${x.id}/external_ids`);
    const imdbId = typeof data.imdb_id === "string" && /^tt\d+$/.test(data.imdb_id) ? data.imdb_id : "";
    try {
      localStorage.setItem(cacheKey, imdbId);
    } catch (e) {}
    return imdbId;
  } catch (e) {
    return "";
  }
}

// Attaches the IMDb rating from the dataset to every item it covers. Instant: no requests.
export function enrichImdb(items) {
  for (const item of items) {
    const fromData = datasetImdbFor(item);
    if (fromData) item._imdb = fromData;
    const d = datasetItem(item);
    if (d) item._where = d._where;
  }
}

// ===== The app's rules: every title shown must have an IMDb rating of at least 6.0/10 from at least 500 votes =====
export const MIN_IMDB_VOTES = 500;
export const MIN_IMDB_RATING = 6.0;
// Titles on Cinobo (independent and festival cinema, often with few IMDb votes) need only 200 votes.
export const CINOBO_MIN_VOTES = 200;
export function minVotesFor(x) {
  return (Number(x?._where) || 0) & 2 ? CINOBO_MIN_VOTES : MIN_IMDB_VOTES;
}
export function isEligible(x) {
  const r = Number(x?._imdb?.rating),
    v = Number(x?._imdb?.votes);
  return r >= MIN_IMDB_RATING && v >= minVotesFor(x);
}

// The rating that is shown and ranked. Titles outside the dataset (under 1,000 IMDb votes) have none.
export function primaryRating(x) {
  const imdb = Number(x?._imdb?.rating);
  if (Number.isFinite(imdb) && imdb > 0) return { value: imdb, votes: Number(x._imdb.votes) || 0, source: "IMDb" };
  return { value: 0, votes: 0, source: "" };
}
// Kept under its old name because the watchlist, tools and saved data all use it.
export function finalCombinedScore(x) {
  return primaryRating(x).value;
}
export function voteCountForConfidence(x) {
  return primaryRating(x).votes;
}
export function reliabilityScore(x) {
  // Heuristic sample-size indicator, not a probability: 100 ≈ 1 million IMDb votes.
  const p = primaryRating(x);
  return Math.max(0, Math.min(100, Math.round((100 * Math.log10(p.votes + 1)) / Math.log10(1000001))));
}

// Bayesian-style shrinkage toward 7.0 with a prior of 10,000 IMDb votes.
export const PRIOR_MEAN = 7.0;
export const PRIOR_VOTES = 10000;
export function shrink(value, votes, m = PRIOR_VOTES) {
  return value > 0 ? (votes / (votes + m)) * value + (m / (votes + m)) * PRIOR_MEAN : 0;
}
export function smoothedRankingScore(x) {
  const p = primaryRating(x);
  return shrink(p.value, p.votes);
}

export function sortCandidates(arr, mode) {
  const pop = (x) => Number(x.popularity) || 0;
  if (mode === "popular") arr.sort((a, b) => pop(b) - pop(a));
  else if (mode === "votes") arr.sort((a, b) => voteCountForConfidence(b) - voteCountForConfidence(a) || pop(b) - pop(a));
  else if (mode === "newest") arr.sort((a, b) => (b._date || "").localeCompare(a._date || "") || pop(b) - pop(a));
  else if (mode === "soonest") arr.sort((a, b) => (a._date || "9999").localeCompare(b._date || "9999") || pop(b) - pop(a));
  else arr.sort((a, b) => smoothedRankingScore(b) - smoothedRankingScore(a) || pop(b) - pop(a));
  return arr;
}

export function finalSort(items, mode) {
  items.forEach((x) => {
    x._finalScore = finalCombinedScore(x);
    x._rankingScore = smoothedRankingScore(x);
    x._reliability = reliabilityScore(x);
  });
  return sortCandidates(items, mode);
}

export function imdbCoverageNote(items) {
  if (!imdbAvailable()) return "χωρίς δεδομένα IMDb";
  const missing = items.filter((x) => !primaryRating(x).value).length;
  return missing ? `${missing} χωρίς βαθμολογία IMDb` : `IMDb ≥${MIN_IMDB_RATING.toFixed(1)} · ≥${MIN_IMDB_VOTES} ψήφοι (Cinobo ≥${CINOBO_MIN_VOTES})`;
}
