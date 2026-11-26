export const API_BASE = "https://api.themoviedb.org/3";

//api.themoviedb.org/3";
export const IMG_BASE = "https://image.tmdb.org/t/p/w500";

//image.tmdb.org/t/p/w500";
export const $ = (id) => document.getElementById(id);

export const state = {
  tombstones: JSON.parse(localStorage.getItem("screenscore_tombstones") || "{}"),
  syncToken: localStorage.getItem("screenscore_sync_token") || "",
  key: localStorage.getItem("screenscore_tmdb_key") || "",
  proxy: localStorage.getItem("screenscore_proxy_url") || "",
  minVotes: 500,
  showAdult: localStorage.getItem("screenscore_adult") === "true",
  type: "all",
  genre: "all",
  sort: "score",
  query: "",
  items: [],
  watchlist: JSON.parse(localStorage.getItem("screenscore_watchlist") || "[]"),
  profile: JSON.parse(localStorage.getItem("screenscore_profile") || "{}"),
};

export const genres = {
  movie: [
    { id: 28, name: "Δράση" },
    { id: 12, name: "Περιπέτεια" },
    { id: 16, name: "Animation" },
    { id: 35, name: "Κωμωδία" },
    { id: 80, name: "Αστυνομική" },
    { id: 99, name: "Ντοκιμαντέρ" },
    { id: 18, name: "Δράμα" },
    { id: 10751, name: "Οικογενειακή" },
    { id: 14, name: "Φαντασίας" },
    { id: 36, name: "Ιστορική" },
    { id: 27, name: "Τρόμου" },
    { id: 10402, name: "Μουσική" },
    { id: 9648, name: "Μυστηρίου" },
    { id: 10749, name: "Ρομαντική" },
    { id: 878, name: "Επιστημονικής φαντασίας" },
    { id: 10770, name: "Τηλεταινία" },
    { id: 53, name: "Θρίλερ" },
    { id: 10752, name: "Πολεμική" },
    { id: 37, name: "Γουέστερν" },
  ],
  tv: [
    { id: 10759, name: "Δράση & περιπέτεια" },
    { id: 16, name: "Animation" },
    { id: 35, name: "Κωμωδία" },
    { id: 80, name: "Αστυνομική" },
    { id: 99, name: "Ντοκιμαντέρ" },
    { id: 18, name: "Δράμα" },
    { id: 10751, name: "Οικογενειακή" },
    { id: 10762, name: "Παιδική" },
    { id: 9648, name: "Μυστηρίου" },
    { id: 10763, name: "Ειδήσεις" },
    { id: 10764, name: "Reality" },
    { id: 10765, name: "Sci-Fi & fantasy" },
    { id: 10766, name: "Σαπουνόπερα" },
    { id: 10767, name: "Talk show" },
    { id: 10768, name: "Πόλεμος & πολιτική" },
    { id: 37, name: "Γουέστερν" },
  ],
};

export function setStatus(t) {
  $("statusText").textContent = t;
}

export function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

export function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v ?? fallback;
  } catch (e) {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Storage full or blocked: the app keeps working without the cache.
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function isFresh(entry, maxAgeDays) {
  return Boolean(entry && entry.t && Date.now() - entry.t < maxAgeDays * DAY_MS);
}

// Genre ids differ between TMDB movie and TV lists; map the closest TV equivalent.
export const TV_GENRE_MAP = { 28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768, 36: 10768 };

export const MOVIE_GENRE_MAP = { 10759: 28, 10765: 878, 10768: 10752 };

export function genreForType(genreId, type) {
  const id = Number(genreId);
  if (!id) return "";
  const own = (genres[type] || []).some((g) => g.id === id);
  if (own) return String(id);
  const mapped = type === "tv" ? TV_GENRE_MAP[id] : MOVIE_GENRE_MAP[id];
  return mapped ? String(mapped) : null; // null = genre does not exist for this type
}

export function includeAnimation() {
  return localStorage.getItem("screenscore_include_animation") === "true";
}

// Translates the period filter into TMDB date params for a media type.
export function periodRange(period) {
  const nowYear = new Date().getFullYear();
  if (period === "5") return [nowYear - 4, nowYear];
  if (period === "10") return [nowYear - 9, nowYear];
  if (/^\d{4}$/.test(period)) {
    const y = Number(period);
    return y === 2020 ? [2020, nowYear] : [y, y + 9];
  }
  return null;
}

export function dateParams(type, range) {
  if (!range) return {};
  const f = type === "movie" ? "primary_release_date" : "first_air_date";
  return { [`${f}.gte`]: `${range[0]}-01-01`, [`${f}.lte`]: `${range[1]}-12-31` };
}

export function genreOptions() {
  const type = $("typeFilter").value;
  const seen = new Set();
  const list = [];
  (type === "all" ? [...genres.movie, ...genres.tv] : genres[type]).forEach((g) => {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      list.push(g);
    }
  });
  $("genreFilter").innerHTML =
    '<option value="all">Όλα τα είδη</option>' + list.map((g) => `<option value="${g.id}">${g.name}</option>`).join("");
}

export function titleOf(x, type) {
  return type === "movie" ? x.title : x.name;
}

export function dateOf(x, type) {
  return type === "movie" ? x.release_date : x.first_air_date;
}

export function genreNames(x, type) {
  const all = genres[type] || [];
  return (x.genre_ids || []).map((id) => all.find((g) => g.id === id)?.name).filter(Boolean);
}

export function normalize(x, type) {
  return {
    ...x,
    media_type: type,
    _title: titleOf(x, type),
    _date: dateOf(x, type),
    _score: Number(x.vote_average || 0),
    _votes: Number(x.vote_count || 0),
  };
}

export function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
