import { $, IMG_BASE, escapeHtml, genreNames, state } from "./core.js";
import { openDetails } from "./details.js";
import { primaryRating, reliabilityScore, smoothedRankingScore } from "./ratings.js";
import { serviceChipsHtml } from "./services.js";
import { apiWithRetry, hasTmdbAccess } from "./tmdb.js";
import { toggleWatch, updatePersonalRating, updateWatchStatus } from "./watchlist.js";

export function renderCard(x, container, compact = false, rank = null) {
  const node = $("cardTemplate").content.firstElementChild.cloneNode(true);
  const img = node.querySelector(".poster");
  img.src = x.poster_path ? IMG_BASE + x.poster_path : "";
  img.alt = x._title || "Poster";
  if (!x.poster_path) {
    img.style.visibility = "hidden";
    img.parentElement.style.background = "#202b3c";
  }
  node.querySelector(".type-tag").textContent = x.media_type === "movie" ? "MOVIE" : "SERIES";
  node.querySelector(".year").textContent = (x._date || "").slice(0, 4) || "Άγνωστη ημερομηνία";
  node.querySelector(".rank-number").textContent = rank ? String(rank) : "";
  node.querySelector(".rank-number").hidden = !rank;
  node.querySelector(".movie-title").textContent = x._title || "Χωρίς τίτλο";
  node.querySelector(".genres").textContent = genreNames(x, x.media_type).join(" · ") || "Είδος μη διαθέσιμο";
  const pr = primaryRating(x);
  node.querySelector(".votes").textContent = pr.votes ? `${pr.votes.toLocaleString("el-GR")} ψήφοι ${pr.source}` : "";
  const scoreEl = node.querySelector(".rating-score");
  scoreEl.textContent = pr.value ? `IMDb ★ ${pr.value.toFixed(1)}/10` : "Χωρίς βαθμολογία IMDb";
  scoreEl.classList.toggle("fallback-score", !pr.value);
  node.querySelector(".rating-label").textContent = pr.value ? `Βαθμολογία κατάταξης: ${smoothedRankingScore(x).toFixed(2)}` : "Εκτός ορίων: κάτω από 500 ψήφους ή 6,0";
  const confidence = node.querySelector(".confidence-line");
  confidence.textContent = pr.votes ? `Αξιοπιστία δείγματος: ${reliabilityScore(x)}/100` : "";
  confidence.title = "Ενδεικτικός δείκτης βασισμένος στον αριθμό ψήφων της πηγής, όχι πιθανότητα ή βαθμολογία ταινίας.";
  const chips = serviceChipsHtml(x);
  if (chips) node.querySelector(".genres").insertAdjacentHTML("afterend", `<div class="service-chips" aria-label="Διαθέσιμο σε">${chips}</div>`);
  const overview = node.querySelector(".overview");
  if (x.overview) overview.textContent = x.overview;
  else if (x._fromDataset && hasTmdbAccess()) {
    // Titles from the IMDb dataset carry no synopsis (it would make the file huge): fetch it when the card scrolls into view.
    overview.textContent = "";
    overview.classList.add("overview-loading");
    observeOverview(overview, x);
  } else overview.textContent = "Δεν υπάρχει ελληνική περιγραφή — άνοιξε τις λεπτομέρειες.";
  const detailLink = node.querySelector(".details-link");
  detailLink.href = `https://www.themoviedb.org/${x.media_type}/${x.id}`;
  detailLink.removeAttribute("target");
  detailLink.addEventListener("click", (e) => {
    e.preventDefault();
    openDetails(x);
  });
  const btn = node.querySelector(".save-button");
  const saved = state.watchlist.some((y) => y.id === x.id && y.media_type === x.media_type);
  btn.classList.toggle("saved", saved);
  btn.textContent = saved ? "♥ Αποθηκεύτηκε" : "♡ Watchlist";
  btn.addEventListener("click", () => toggleWatch(x));
  if (compact) {
    const status = document.createElement("select");
    status.className = "watch-status";
    status.setAttribute("aria-label", "Κατάσταση watchlist");
    status.innerHTML =
      '<option value="want">Θέλω να δω</option><option value="watched">Το είδα</option><option value="favorite">Αγαπημένα</option>';
    status.value = x._watchStatus || "want";
    status.addEventListener("change", () => updateWatchStatus(x, status.value));
    node.querySelector(".card-actions").appendChild(status);
    const personal = document.createElement("select");
    personal.className = "personal-rating";
    personal.setAttribute("aria-label", "Η προσωπική μου βαθμολογία");
    personal.innerHTML =
      '<option value="">Η βαθμολογία μου</option>' +
      Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}/10</option>`).join("");
    const savedItem = state.watchlist.find((y) => y.id === x.id && y.media_type === x.media_type);
    personal.value = savedItem?.personalRating || "";
    personal.addEventListener("change", () => updatePersonalRating(x, personal.value));
    node.querySelector(".card-actions").appendChild(personal);
    if (savedItem?._watchStatus === "watched") {
      const watched = document.createElement("span");
      watched.className = "watch-history-date";
      watched.textContent = `Το είδα${savedItem.watchedDate ? ` · ${savedItem.watchedDate}` : ""}`;
      node.querySelector(".card-body").appendChild(watched);
    }
  }
  container.appendChild(node);
}

const overviewCache = new Map();
let overviewObserver = null;
function observeOverview(el, x) {
  if (!("IntersectionObserver" in window)) return fillOverview(el, x);
  if (!overviewObserver)
    overviewObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          overviewObserver.unobserve(e.target);
          fillOverview(e.target, e.target._item);
        }
      },
      { rootMargin: "300px" },
    );
  el._item = x;
  overviewObserver.observe(el);
}
async function fillOverview(el, x) {
  const key = `${x.media_type}:${x.id}`;
  try {
    if (!overviewCache.has(key)) overviewCache.set(key, apiWithRetry(`/${x.media_type}/${x.id}`, { language: "el-GR" }).then((d) => d.overview || ""));
    const text = await overviewCache.get(key);
    x.overview = text;
    el.textContent = text || "Δεν υπάρχει ελληνική περιγραφή — άνοιξε τις λεπτομέρειες.";
  } catch (e) {
    el.textContent = "";
  }
  el.classList.remove("overview-loading");
}
// Placeholder cards with the real card's shape while a list loads.
export function renderSkeleton(count = 6) {
  const c = $("results");
  c.setAttribute("aria-busy", "true");
  c.innerHTML = Array.from(
    { length: count },
    () => `<article class="movie-card skeleton-card" aria-hidden="true"><div class="skeleton skeleton-poster"></div><div class="card-body"><div class="skeleton skeleton-line w40"></div><div class="skeleton skeleton-line w80"></div><div class="skeleton skeleton-line w60"></div><div class="skeleton skeleton-block"></div></div></article>`,
  ).join("");
}
export function renderResults(emptyMessage) {
  const c = $("results");
  c.innerHTML = "";
  c.removeAttribute("aria-busy");
  const hero = document.querySelector(".hero");
  if (state.items[0]?.backdrop_path) {
    hero.style.backgroundImage = `linear-gradient(100deg,#101724f5 0%,#101724d9 58%,#101724aa 100%),url("https://image.tmdb.org/t/p/w780${state.items[0].backdrop_path}")`;
    hero.style.backgroundSize = "cover";
    hero.style.backgroundPosition = "center 35%";
  }
  $("resultCount").textContent = `${state.items.length} τίτλοι`;
  if (!state.items.length) {
    c.innerHTML =
      `<div class="empty-state">${escapeHtml(emptyMessage || (state.query ? `Δεν βρέθηκαν ταινίες ή σειρές για «${state.query}» με βαθμολογία IMDb τουλάχιστον 6,0 από 500+ ψήφους.` : `Δεν βρέθηκαν τίτλοι με αυτά τα φίλτρα και τουλάχιστον ${state.minVotes} ψήφους. Δοκίμασε λιγότερο αυστηρά φίλτρα (π.χ. «Όλα τα είδη» ή «Όλες οι χρονιές»).`))}</div>`;
    return;
  }
  state.items.forEach((x, i) => renderCard(x, c, false, i + 1));
}
