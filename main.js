import { openCompare, showAnalytics, v25ScoreEngine } from "./analysis.js";
import { $, genreOptions, setStatus, state } from "./core.js";
import { currentDetailItem, openTitleByKey } from "./details.js";
import { loadDiscover } from "./discover.js";
import { loadRecommendations, openNewReleaseChoices, openPeopleSearch, pickTonight, v24Awards, v24Franchise, v24Mood, v24Runtime, v26HiddenGems } from "./discovery.js";
import { hasImdbData, loadImdbData } from "./imdbData.js";
import { openImport } from "./importer.js";
import { importBackupFile, openBackup, v24FamilyList, v24Layout, v24SaveFilters, v25Profile } from "./personal.js";
import { renderSkeleton } from "./render.js";
import { applyUrlToFilters, initRouter, leaveTitle, setToolInUrl, titleFromUrl, titleShareUrl, toolFromUrl } from "./router.js";
import { openSettings } from "./settings.js";
import { startSync, syncConfigured, syncNow } from "./sync.js";
import { hasTmdbAccess } from "./tmdb.js";
import { populateWatchGenres, renderWatchlist } from "./watchlist.js";

// Details dialog ↔ URL: closing (button, Esc or back) keeps the address bar and history in step.
let closingFromPopstate = false;
$("closeDetails").addEventListener("click", () => $("detailsDialog").close());
$("detailsDialog").addEventListener("close", () => leaveTitle(closingFromPopstate));
window.addEventListener("popstate", () => {
  const t = titleFromUrl();
  const dialog = $("detailsDialog");
  if (!t && dialog.open) {
    closingFromPopstate = true;
    dialog.close();
    closingFromPopstate = false;
  } else if (t && !dialog.open) openTitleByKey(t).catch(() => {});
});
$("detailShareBtn").addEventListener("click", async () => {
  const x = currentDetailItem();
  if (!x) return;
  const url = titleShareUrl(x);
  try {
    if (navigator.share) await navigator.share({ title: x._title, url });
    else {
      await navigator.clipboard.writeText(url);
      const label = $("detailShareBtn").querySelector("span");
      label.textContent = "Ο σύνδεσμος αντιγράφηκε";
      setTimeout(() => (label.textContent = "Κοινοποίηση"), 2500);
    }
  } catch (e) {}
});

$("settingsBtn").addEventListener("click", openSettings);

$("noticeSettings").addEventListener("click", openSettings);

$("navSettings").addEventListener("click", openSettings);

$("settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  state.key = $("apiKey").value.trim();
  state.proxy = $("workerProxyUrl").value.trim().replace(/\/$/, "");
  state.showAdult = $("showAdult").checked;
  localStorage.setItem("screenscore_tmdb_key", state.key);
  localStorage.setItem("screenscore_proxy_url", state.proxy);
  localStorage.setItem("screenscore_adult", state.showAdult);
  localStorage.setItem("screenscore_include_animation", $("includeAnimation").checked);
  state.syncToken = $("syncToken").value.trim();
  localStorage.setItem("screenscore_sync_token", state.syncToken);
  $("settingsDialog").close();
  if (syncConfigured()) syncNow();
  if (state.key || state.proxy || hasImdbData()) loadDiscover();
  else {
    $("notice").hidden = false;
    setStatus("Αναμονή σύνδεσης δεδομένων");
  }
});

$("clearKey").addEventListener("click", () => {
  $("apiKey").value = "";
  state.key = "";
  localStorage.removeItem("screenscore_tmdb_key");
  $("settingsMessage").textContent = "Το κλειδί αφαιρέθηκε από αυτή τη συσκευή.";
});

$("typeFilter").addEventListener("change", () => {
  genreOptions();
  loadDiscover();
});

$("genreFilter").addEventListener("change", loadDiscover);

$("serviceFilter").addEventListener("change", loadDiscover);

$("syncNowBtn").addEventListener("click", () => {
  state.syncToken = $("syncToken").value.trim();
  state.proxy = $("workerProxyUrl").value.trim().replace(/\/$/, "");
  if (!syncConfigured()) {
    $("syncStatus").textContent = "Χρειάζονται Worker URL και κωδικός συγχρονισμού.";
    return;
  }
  syncNow();
});

$("sortFilter").addEventListener("change", loadDiscover);

["periodFilter", "minRatingFilter", "countryFilter", "languageFilter"].forEach((id) => $(id).addEventListener("change", loadDiscover));

["watchStatusFilter", "watchGenreFilter", "watchRatingFilter"].forEach((id) => $(id).addEventListener("change", renderWatchlist));

$("searchBtn").addEventListener("click", () => {
  state.query = $("searchInput").value;
  loadDiscover();
});

$("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    state.query = e.target.value;
    loadDiscover();
  }
});

document.querySelectorAll(".nav-item[data-view]").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((x) => {
      x.classList.remove("active");
      x.removeAttribute("aria-current");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-current", "page");
    if (btn.dataset.view === "watchlist") $("watchlist").scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }),
);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});

genreOptions();

populateWatchGenres();

renderWatchlist();

// Each tool has a short name, so it can be opened from a link (?tool=gems).
const TOOLS = [
  ["recommendBtn", loadRecommendations, "foryou"],
  ["newReleasesBtn", openNewReleaseChoices, "new"],
  ["hiddenGemsBtn", v26HiddenGems, "gems"],
  ["moodBtn", v24Mood, "mood"],
  ["peopleSearchBtn", openPeopleSearch, "people"],
  ["franchiseBtn", v24Franchise, "franchise"],
  ["awardsBtn", v24Awards, "awards"],
  ["runtimeBtn", v24Runtime, "runtime"],
  ["tonightBtn", pickTonight, "tonight"],
  ["statsBtn", showAnalytics, "analysis"],
  ["compareBtn", openCompare, "compare"],
  ["scoreEngineBtn", v25ScoreEngine, "scoring"],
  ["profileBtn", v25Profile, "profile"],
  ["savedFiltersBtn", v24SaveFilters, "filters"],
  ["familyBtn", v24FamilyList, "group"],
  ["layoutBtn", v24Layout, "layout"],
  ["backupBtn", openBackup, "backup"],
  ["importBtn", openImport, "import"],
];
for (const [id, fn, name] of TOOLS)
  $(id).addEventListener("click", () => {
    setToolInUrl(name);
    fn();
  });

$("importBackupFile").addEventListener("change", (e) => {
  importBackupFile(e.target.files?.[0]);
  e.target.value = "";
});

$("standardResultsBtn").addEventListener("click", () => {
  $("searchInput").value = "";
  $("toolPanel").hidden = true;
  setToolInUrl(null);
  loadDiscover();
});

(function () {
  const mode = localStorage.getItem("screenscore_results_layout");
  if (mode === "list") $("results").classList.add("list-view");
  if (mode === "poster") $("results").classList.add("poster-view");
})();

// Trakt (v27) and OMDb (v29) are gone: free the space their caches and keys used on this device.
try {
  ["screenscore_platforms", "screenscore_trakt_cache", "screenscore_trakt_client_id", "screenscore_omdb_cache", "screenscore_omdb_daily", "screenscore_omdb_key", "screenscore_omdb_via_proxy"].forEach((k) => localStorage.removeItem(k));
} catch (e) {}

// Text size (small / normal / large): applied immediately and remembered on this device.
function applyTextSize(size) {
  document.documentElement.dataset.text = size;
  try {
    localStorage.setItem("screenscore_text_size", size);
  } catch (e) {}
}
document.querySelectorAll('input[name="textSize"]').forEach((r) => {
  r.checked = r.value === (document.documentElement.dataset.text || "normal");
  r.addEventListener("change", () => applyTextSize(r.value));
});

// Start-up runs last, after every function and listener above is defined.
async function start() {
  initRouter();
  const linkedTitle = titleFromUrl();
  const linkedTool = toolFromUrl();
  applyUrlToFilters();
  renderSkeleton();
  await loadImdbData();
  if (hasTmdbAccess() || hasImdbData()) loadDiscover();
  else {
    $("notice").hidden = false;
    $("results").innerHTML = "";
  }
  if (linkedTitle) openTitleByKey(linkedTitle).catch(() => {});
  const entry = TOOLS.find((x) => x[2] === linkedTool);
  if (entry) entry[1]();
  startSync();
}
start();
