// Import ratings, watched titles and watchlists exported from IMDb or Letterboxd (CSV).
//   IMDb:       imdb.com → Your Ratings / Watchlist → ⋮ → Export   (columns: Const, Your Rating, Date Rated, Title Type…)
//   Letterboxd: Settings → Data → Export your data → ratings.csv / watched.csv / watchlist.csv (Date, Name, Year, Rating…)
import { $, escapeHtml, normalize, setStatus, state } from "./core.js";
import { datasetImdbFor, datasetItemByImdb } from "./imdbData.js";
import { apiWithRetry, hasTmdbAccess, mapLimit } from "./tmdb.js";
import { markUpdated, persistWatchlist, renderWatchlist } from "./watchlist.js";
import { showTool } from "./common.js";

// RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes, BOM.
export function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// Works out what kind of export a file is from its columns (and, for Letterboxd, its file name).
export function detectFormat(rows, fileName = "") {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const name = fileName.toLowerCase();
  if (cols.includes("Const")) return cols.includes("Your Rating") ? "imdb-ratings" : "imdb-list";
  if (cols.includes("Letterboxd URI")) {
    if (cols.includes("Rating")) return "lb-ratings";
    return name.includes("watchlist") ? "lb-watchlist" : "lb-watched";
  }
  return null;
}
const FORMAT_LABEL = {
  "imdb-ratings": "IMDb · βαθμολογίες",
  "imdb-list": "IMDb · watchlist / λίστα",
  "lb-ratings": "Letterboxd · βαθμολογίες",
  "lb-watched": "Letterboxd · ταινίες που είδα",
  "lb-watchlist": "Letterboxd · watchlist",
};
const IMDB_TYPES = { movie: "movie", "tv movie": "movie", tvmovie: "movie", video: "movie", "tv series": "tv", tvseries: "tv", "tv mini series": "tv", tvminiseries: "tv", "tv mini-series": "tv" };

function isoDate(s) {
  const d = String(s || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}
// One normalized import entry per row: what to look up and what to store.
export function toEntries(rows, format) {
  return rows
    .map((r) => {
      if (format.startsWith("imdb")) {
        const type = IMDB_TYPES[String(r["Title Type"] || "").toLowerCase()];
        if (!type || !/^tt\d+$/.test(r.Const)) return null; // episodes, shorts, games…
        const rating = Number(r["Your Rating"]);
        return {
          imdb: r.Const,
          type,
          title: r.Title,
          year: r.Year,
          status: format === "imdb-ratings" ? "watched" : "want",
          personalRating: rating >= 1 && rating <= 10 ? rating : null,
          date: isoDate(r["Date Rated"]) || isoDate(r.Created),
        };
      }
      if (!r.Name) return null;
      const stars = Number(r.Rating); // Letterboxd: 0.5–5 stars
      return {
        type: "movie",
        title: r.Name,
        year: r.Year,
        status: format === "lb-watchlist" ? "want" : "watched",
        personalRating: stars > 0 ? Math.max(1, Math.min(10, Math.round(stars * 2))) : null,
        date: format === "lb-watchlist" ? "" : isoDate(r["Watched Date"]) || isoDate(r.Date),
      };
    })
    .filter(Boolean);
}

async function resolveEntry(e) {
  if (e.imdb) {
    const fromData = datasetItemByImdb(e.imdb);
    if (fromData) return fromData;
    if (!hasTmdbAccess()) return null;
    const f = await apiWithRetry(`/find/${e.imdb}`, { external_source: "imdb_id", language: "el-GR" });
    const hit = e.type === "tv" ? f.tv_results?.[0] || f.movie_results?.[0] : f.movie_results?.[0] || f.tv_results?.[0];
    if (!hit) return null;
    const x = normalize(hit, hit === f.tv_results?.[0] ? "tv" : "movie");
    x._imdb = datasetImdbFor(x) || { imdbID: e.imdb };
    return x;
  }
  if (!hasTmdbAccess()) return null;
  // Letterboxd has no IMDb id in its export: match by title + year, allowing a one-year difference.
  const d = await apiWithRetry("/search/movie", { query: e.title, year: e.year || undefined, language: "el-GR" });
  let hit = d.results?.[0];
  if (!hit && e.year) {
    const loose = await apiWithRetry("/search/movie", { query: e.title, language: "el-GR" });
    hit = (loose.results || []).find((m) => Math.abs(Number(String(m.release_date).slice(0, 4)) - Number(e.year)) <= 1);
  }
  if (!hit) return null;
  const x = normalize(hit, "movie");
  const imdb = datasetImdbFor(x);
  if (imdb) x._imdb = imdb;
  return x;
}

const RANK = { want: 0, watched: 1, favorite: 2 };
// Adds or updates one title; never downgrades "watched"/"favourite" back to "want", never deletes anything.
export function mergeIntoWatchlist(x, e) {
  let item = state.watchlist.find((y) => y.id === x.id && y.media_type === x.media_type);
  const isNew = !item;
  if (isNew) {
    item = { ...x, _watchStatus: e.status };
    state.watchlist.push(item);
  } else if (RANK[e.status] > RANK[item._watchStatus || "want"]) item._watchStatus = e.status;
  if (e.personalRating && !item.personalRating) item.personalRating = e.personalRating;
  if (e.status === "watched" && !item.watchedDate) item.watchedDate = e.date || "";
  markUpdated(item);
  return isNew;
}

export function openImport() {
  showTool(`<h3>Εισαγωγή από IMDb ή Letterboxd</h3>
    <p>Φέρε τις βαθμολογίες σου, ό,τι έχεις δει και τη watchlist σου, ώστε οι προτάσεις να δουλεύουν αμέσως.</p>
    <details><summary>Πώς παίρνω το αρχείο;</summary>
      <p><strong>IMDb:</strong> imdb.com → «Your ratings» (ή «Your Watchlist») → μενού ⋮ → <em>Export</em>. Κατεβαίνει ένα .csv.</p>
      <p><strong>Letterboxd:</strong> Settings → Data → <em>Export your data</em>. Μέσα στο .zip ανέβασε το <code>ratings.csv</code>, το <code>watched.csv</code> ή το <code>watchlist.csv</code>.</p>
    </details>
    <label for="importFile">Αρχείο CSV</label><input id="importFile" type="file" accept=".csv,text/csv">
    <div id="importPreview"></div>
    <p class="inline-note">Τίποτα δεν διαγράφεται: υπάρχοντες τίτλοι μόνο ενημερώνονται. Οι βαθμολογίες Letterboxd (½–5 αστέρια) μετατρέπονται σε 1–10.</p>`);
  $("importFile").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    const format = detectFormat(rows, file.name);
    const out = $("importPreview");
    if (!format) {
      out.innerHTML = "<p>Δεν αναγνωρίστηκε το αρχείο. Χρειάζεται export από IMDb ή Letterboxd.</p>";
      return;
    }
    const entries = toEntries(rows, format);
    const needsTmdb = format.startsWith("lb") || entries.some((e) => !datasetItemByImdb(e.imdb));
    out.innerHTML = `<p><strong>${FORMAT_LABEL[format]}</strong> · ${entries.length} τίτλοι${rows.length > entries.length ? ` (${rows.length - entries.length} επεισόδια/άλλα παραλείπονται)` : ""}.</p>
      ${needsTmdb && !hasTmdbAccess() ? "<p>Για να βρεθούν όλοι οι τίτλοι χρειάζεται TMDB key ή Worker στις Ρυθμίσεις.</p>" : ""}
      <div class="tool-actions"><button class="primary-button" id="importGo">Εισαγωγή</button></div>`;
    $("importGo").onclick = () => runImport(entries);
  });
}

async function runImport(entries) {
  const out = $("importPreview");
  let added = 0,
    updated = 0,
    done = 0;
  const missing = [];
  out.innerHTML = '<p id="importProgress" role="status">Ξεκινά…</p>';
  await mapLimit(entries, 4, async (e) => {
    try {
      const x = await resolveEntry(e);
      if (!x) missing.push(e);
      else if (mergeIntoWatchlist(x, e)) added++;
      else updated++;
    } catch (err) {
      missing.push(e);
    }
    done++;
    if (done % 10 === 0 || done === entries.length) {
      $("importProgress").textContent = `${done}/${entries.length} τίτλοι…`;
      setStatus(`Εισαγωγή: ${done}/${entries.length}`);
    }
  });
  persistWatchlist();
  renderWatchlist();
  out.innerHTML = `<p role="status"><strong>Ολοκληρώθηκε.</strong> Νέοι: ${added} · ενημερώθηκαν: ${updated} · δεν βρέθηκαν: ${missing.length}.</p>${
    missing.length
      ? `<details><summary>Τίτλοι που δεν βρέθηκαν</summary><p>${missing
          .slice(0, 60)
          .map((e) => escapeHtml(`${e.title} (${e.year || "—"})`))
          .join(" · ")}${missing.length > 60 ? " …" : ""}</p></details>`
      : ""
  }`;
  setStatus(`Εισαγωγή ολοκληρώθηκε: ${added} νέοι, ${updated} ενημερώσεις`);
}
