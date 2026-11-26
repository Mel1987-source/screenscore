import { $, IMG_BASE, escapeHtml, genreNames, normalize, state } from "./core.js";
import { datasetItem } from "./imdbData.js";
import { PRIOR_VOTES, enrichImdb, fetchCanonicalImdbId, finalCombinedScore, primaryRating, reliabilityScore, smoothedRankingScore } from "./ratings.js";
import { pushTitle } from "./router.js";
import { SERVICES, serviceNames } from "./services.js";
import { api, apiWithRetry, hasTmdbAccess } from "./tmdb.js";
import { persistWatchlist } from "./watchlist.js";

let currentDetail = null;
export function currentDetailItem() {
  return currentDetail;
}
// Resolves a title from a shared link: current results → IMDb dataset → TMDB.
export async function openTitleByKey(key) {
  const k = `${key.media_type}:${key.id}`;
  let x = state.items.find((y) => `${y.media_type}:${y.id}` === k) || state.watchlist.find((y) => `${y.media_type}:${y.id}` === k) || datasetItem(key);
  if (!x) {
    const d = await apiWithRetry(`/${key.media_type}/${key.id}`, { language: "el-GR" });
    x = normalize({ ...d, genre_ids: (d.genres || []).map((g) => g.id) }, key.media_type);
    enrichImdb([x]);
  }
  openDetails(x, { fromRouter: true });
}
export function openDetails(x, { fromRouter = false } = {}) {
  const dialog = $("detailsDialog");
  currentDetail = x;
  if (!fromRouter) pushTitle(x);
  const kind = x.media_type === "movie" ? "Ταινία" : "Σειρά";
  $("detailTitle").textContent = x._title || "Λεπτομέρειες";
  const poster = $("detailPoster");
  poster.src = x.poster_path ? IMG_BASE + x.poster_path : "";
  poster.style.display = x.poster_path ? "block" : "none";
  poster.alt = x._title || "Αφίσα";
  $("detailGenres").textContent = genreNames(x, x.media_type).join(" · ") || "Είδος μη διαθέσιμο";
  const dp = primaryRating(x);
  $("detailRatings").innerHTML = dp.value
    ? `<div class="detail-rating"><span>IMDb</span><strong>★ ${dp.value.toFixed(1)}/10</strong><small>${dp.votes.toLocaleString("el-GR")} ψήφοι</small></div>`
    : `<div class="detail-rating"><span>IMDb</span><strong>Χωρίς βαθμολογία</strong><small>Κάτω από 500 ψήφους ή 6,0</small></div>`;
  $("detailMeta").textContent = `${kind} · ${(x._date || "").slice(0, 4) || "Άγνωστο έτος"}`;
  $("detailOverview").textContent = x.overview || "Δεν υπάρχει διαθέσιμη περιγραφή στα ελληνικά.";
  $("detailTmdbBtn").href = `https://www.themoviedb.org/${x.media_type}/${x.id}`;
  const imdb = x._imdb?.imdbID;
  let imdbBtn = document.getElementById("detailImdbBtn");
  const imdbQuery = encodeURIComponent(`${x._title || ""} ${(x._date || "").slice(0, 4)}`.trim());
  if (imdbBtn) {
    imdbBtn.href = imdb ? `https://www.imdb.com/title/${encodeURIComponent(imdb)}/` : `https://www.imdb.com/find/?q=${imdbQuery}`;
    if (!imdb && hasTmdbAccess())
      fetchCanonicalImdbId(x).then((id) => {
        if (id && currentDetail === x) imdbBtn.href = `https://www.imdb.com/title/${id}/`;
      });
  }
  const raw = finalCombinedScore(x),
    adjusted = smoothedRankingScore(x),
    confidence = reliabilityScore(x);
  $("detailRankingInfo").innerHTML =
    `<strong>Βαθμολογία IMDb:</strong> ${raw.toFixed(1)}/10<br><strong>Βαθμολογία κατάταξης:</strong> ${adjusted.toFixed(2)}/10<br><strong>Αξιοπιστία δείγματος:</strong> ${confidence}/100<br><span>Η κατάταξη «τραβά» τίτλους με λίγες ψήφους προς το 7,0/10 (prior ${PRIOR_VOTES.toLocaleString("el-GR")} ψήφων IMDb).</span>`;
  $("detailExtra").innerHTML = "";
  loadDetailExtras(x);
  loadStreamingProviders(x);
  if (!dialog.open) dialog.showModal();
}

// Runtime, trailer and an English overview when the Greek one is missing — one TMDB call (two if no Greek text).
export async function loadDetailExtras(x) {
  const box = $("detailExtra");
  try {
    const d = await apiWithRetry(`/${x.media_type}/${x.id}`, {
      language: "el-GR",
      append_to_response: "videos",
      include_video_language: "el,en,null",
    });
    const runtime = x.media_type === "movie" ? Number(d.runtime) || 0 : Number((d.episode_run_time || [])[0]) || Number(d.last_episode_to_air?.runtime) || 0;
    if (runtime) rememberRuntime(x, runtime);
    const videos = (d.videos?.results || []).filter((v) => v.site === "YouTube" && /^[\w-]{6,20}$/.test(v.key));
    const trailer = videos.find((v) => v.type === "Trailer" && v.official) || videos.find((v) => v.type === "Trailer") || videos[0];
    const parts = [];
    if (runtime) parts.push(`<span class="streaming-chip">◷ ${runtime} λεπτά${x.media_type === "tv" ? " / επεισόδιο" : ""}</span>`);
    if (x.media_type === "tv" && d.number_of_seasons) parts.push(`<span class="streaming-chip">${d.number_of_seasons} σεζόν · ${d.number_of_episodes || "?"} επεισόδια</span>`);
    if (trailer) parts.push(`<a class="secondary-button" href="https://www.youtube.com/watch?v=${trailer.key}" target="_blank" rel="noopener noreferrer">▶ Trailer</a>`);
    box.innerHTML = parts.join(" ");
    if (!x.overview && !d.overview) {
      const en = await apiWithRetry(`/${x.media_type}/${x.id}`, { language: "en-US" });
      if (en.overview && $("detailTitle").textContent === (x._title || "Λεπτομέρειες")) {
        $("detailOverview").textContent = en.overview;
        $("detailOverview").insertAdjacentHTML("beforeend", ' <em class="inline-note">(αγγλική περιγραφή)</em>');
      }
    } else if (!x.overview && d.overview) $("detailOverview").textContent = d.overview;
  } catch (e) {
    box.innerHTML = "";
  }
}

export function rememberRuntime(x, runtime) {
  x._runtime = runtime;
  const saved = state.watchlist.find((y) => y.id === x.id && y.media_type === x.media_type);
  if (saved && saved._runtime !== runtime) {
    saved._runtime = runtime;
    persistWatchlist();
  }
}

// Only Netflix and Cinobo matter: live check from TMDB (JustWatch), falling back to the daily data.
export async function loadStreamingProviders(x) {
  const box = $("detailStreaming");
  const show = (names, link) => {
    box.innerHTML =
      "<strong>Netflix / Cinobo στην Κύπρο</strong>" +
      (names.length
        ? `<div class="streaming-list">${names.map((n) => `<span class="service-chip svc-${n.toLowerCase()}">${n}</span>`).join("")}</div>`
        : "<br>Δεν είναι διαθέσιμο στο Netflix ή στο Cinobo.") +
      (link ? `<p><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Όλες οι επιλογές (JustWatch/TMDB) ↗</a></p>` : "") +
      '<p class="inline-note">Η διαθεσιμότητα αλλάζει συχνά· πηγή: JustWatch μέσω TMDB.</p>';
  };
  show(serviceNames(x).map((s) => s.name));
  if (!hasTmdbAccess()) return;
  try {
    const data = await api(`/${x.media_type}/${x.id}/watch/providers`);
    const cy = data.results?.CY;
    const offers = [...(cy?.flatrate || []), ...(cy?.free || []), ...(cy?.ads || [])].map((p) => p.provider_name || "");
    const names = SERVICES.map((s) => s.name).filter((n) => offers.some((o) => o.toLowerCase().startsWith(n.toLowerCase())));
    if (currentDetail === x) show(names, cy?.link);
  } catch (e) {}
}
