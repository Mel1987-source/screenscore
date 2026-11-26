import { MIN_IMDB_RATING, minVotesFor } from "./ratings.js";

// Daily IMDb dataset built by scripts/build-imdb-data.mjs (GitHub Actions): the only source of ratings.
// Lists are filtered and ranked locally, with no rating requests and no daily limit.
import { dateStr, DAY_MS, genreForType, includeAnimation, normalize } from "./core.js";

let data = null; // { generated, items: [], byTmdb: Map }
let loading = null;

export function loadImdbData() {
  if (!loading)
    loading = fetch("data/imdb-titles.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json || json.v !== 1 || !Array.isArray(json.rows)) return null;
        const items = json.rows.map(rowToItem);
        data = {
          generated: json.generated,
          items,
          byTmdb: new Map(items.map((x) => [`${x.media_type}:${x.id}`, x])),
          byImdb: new Map(items.map((x) => [x._imdb.imdbID, x])),
        };
        return data;
      })
      .catch(() => null);
  return loading;
}
export function hasImdbData() {
  return Boolean(data);
}
export function imdbDataDate() {
  return data ? new Date(data.generated).toLocaleDateString("el-GR") : "";
}

function rowToItem(r) {
  const [imdb, tmdb, type, title, date, rating10, votes, runtime, genreIds, lang, poster, backdrop, where] = r;
  const media_type = type === 1 ? "tv" : "movie";
  const base = {
    id: tmdb,
    [media_type === "movie" ? "title" : "name"]: title,
    [media_type === "movie" ? "release_date" : "first_air_date"]: date,
    genre_ids: genreIds || [],
    original_language: lang,
    poster_path: poster || null,
    backdrop_path: backdrop || null,
    overview: "",
    popularity: 0,
    vote_average: 0,
    vote_count: 0,
  };
  const x = normalize(base, media_type);
  x._runtime = runtime || 0;
  x._fromDataset = true;
  x._where = where || 0; // 1 = Netflix, 2 = Cinobo (Cyprus)
  x._imdb = { rating: rating10 / 10, votes, imdbID: `tt${String(imdb).padStart(7, "0")}` };
  return x;
}

export function datasetItemByImdb(imdbId) {
  const hit = data?.byImdb.get(imdbId);
  return hit ? { ...hit } : null;
}
export function datasetItem(key) {
  const hit = data?.byTmdb.get(`${key.media_type}:${key.id}`);
  return hit ? { ...hit } : null;
}
// IMDb rating for any TMDB title that is in the dataset.
export function datasetImdbFor(x) {
  const hit = data?.byTmdb.get(`${x.media_type}:${x.id}`);
  return hit ? hit._imdb : null;
}

// "18,53" = all of them, "35|10751" = any of them.
function matchesGenres(ids, expr) {
  if (!expr) return true;
  if (expr.includes("|")) return expr.split("|").some((g) => ids.includes(Number(g)));
  return expr.split(",").every((g) => ids.includes(Number(g)));
}

/**
 * Filters the dataset. All filters are optional.
 * { type: "all"|"movie"|"tv", genre, genreExpr: {movie, tv}, yearRange: [from, to], minRating, language,
 *   minVotes, maxVotes, maxRuntime, minRuntime, olderThanDays, withoutGenres: [], excludeTvGenres: [] }
 */
export function queryImdbData(f = {}) {
  if (!data) return [];
  const cutoff = f.olderThanDays ? dateStr(new Date(Date.now() - f.olderThanDays * DAY_MS)) : "";
  const today = dateStr(new Date());
  return data.items.filter((x) => {
    if (f.type && f.type !== "all" && x.media_type !== f.type) return false;
    const ids = x.genre_ids;
    if (!includeAnimation() && String(f.genre) !== "16" && ids.includes(16)) return false;
    if (f.genre && f.genre !== "all") {
      const g = genreForType(f.genre, x.media_type);
      if (g === null || !ids.includes(Number(g))) return false;
    }
    if (f.genreExpr && !matchesGenres(ids, f.genreExpr[x.media_type])) return false;
    if (f.excludeTvGenres && x.media_type === "tv" && ids.some((g) => f.excludeTvGenres.includes(g))) return false;
    const year = Number(String(x._date || "").slice(0, 4));
    if (f.yearRange && !(year >= f.yearRange[0] && year <= f.yearRange[1])) return false;
    if (x._date && x._date > today) return false; // not released yet
    if (cutoff && !(x._date && x._date <= cutoff)) return false;
    if (f.language && f.language !== "all" && x.original_language !== f.language) return false;
    const { rating, votes } = x._imdb;
    // The app-wide floor (≥500 votes, ≥6.0) applies whatever thresholds the dataset was built with.
    if (rating < Math.max(MIN_IMDB_RATING, f.minRating || 0)) return false;
    if (votes < Math.max(minVotesFor(x), f.minVotes || 0)) return false;
    if (f.maxVotes && votes > f.maxVotes) return false;
    if (f.where && !(x._where & f.where)) return false;
    if (f.maxRuntime && !(x._runtime > 0 && x._runtime <= f.maxRuntime)) return false;
    if (f.minRuntime && !(x._runtime >= f.minRuntime)) return false;
    return true;
  });
}
