import { findItemByKey, showTool } from "./common.js";
import { $, escapeHtml, genreNames, state } from "./core.js";
import { dedupe } from "./discover.js";
import { imdbDataDate } from "./imdbData.js";
import { CINOBO_MIN_VOTES, MIN_IMDB_RATING, MIN_IMDB_VOTES, PRIOR_MEAN, PRIOR_VOTES, finalCombinedScore, imdbAvailable, primaryRating, reliabilityScore, smoothedRankingScore } from "./ratings.js";

// --- Compare ---
export function openCompare() {
  const pool = dedupe([...state.items, ...state.watchlist]);
  if (pool.length < 2) {
    showTool("<h3>Σύγκριση τίτλων</h3><p>Χρειάζονται τουλάχιστον δύο τίτλοι στα αποτελέσματα ή στη Watchlist.</p>");
    return;
  }
  const options = pool
    .map((x) => `<option value="${escapeHtml(`${x.media_type}:${x.id}`)}">${escapeHtml(`${x._title} (${String(x._date || "").slice(0, 4) || "—"})`)}</option>`)
    .join("");
  showTool(
    `<h3>Σύγκριση δύο τίτλων</h3><div class="tool-row"><div><label for="compareA">Τίτλος Α</label><select id="compareA">${options}</select></div><div><label for="compareB">Τίτλος Β</label><select id="compareB">${options}</select></div></div><div class="tool-actions"><button class="primary-button" id="compareGo">Σύγκριση</button></div><div id="compareOutput"></div>`,
  );
  $("compareB").selectedIndex = 1;
  $("compareGo").onclick = renderComparison;
}

export function renderComparison() {
  const a = findItemByKey($("compareA").value),
    b = findItemByKey($("compareB").value);
  if (!a || !b || a === b) {
    $("compareOutput").innerHTML = "<p>Επίλεξε δύο διαφορετικούς τίτλους.</p>";
    return;
  }
  const r = (v) => (Number(v) > 0 ? `${Number(v).toFixed(1)}/10` : "—");
  const rows = [
    ["Έτος", (a._date || "").slice(0, 4), (b._date || "").slice(0, 4)],
    ["Βαθμολογία", `${primaryRating(a).source} ${r(primaryRating(a).value)}`, `${primaryRating(b).source} ${r(primaryRating(b).value)}`],
    ["Ψήφοι", primaryRating(a).votes.toLocaleString("el-GR"), primaryRating(b).votes.toLocaleString("el-GR")],
    ["Βαθμολογία κατάταξης", smoothedRankingScore(a).toFixed(2), smoothedRankingScore(b).toFixed(2)],
    ["Είδη", genreNames(a, a.media_type).join(", "), genreNames(b, b.media_type).join(", ")],
  ];
  $("compareOutput").innerHTML =
    `<table class="tool-table"><thead><tr><th>Κριτήριο</th><th>${escapeHtml(a._title)}</th><th>${escapeHtml(b._title)}</th></tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

// --- Result analysis (merges the old Statistics, Intelligence and Agreement panels) ---
export function showAnalytics() {
  const xs = state.items;
  if (!xs.length) {
    showTool("<h3>Ανάλυση αποτελεσμάτων</h3><p>Δεν υπάρχουν αποτελέσματα για ανάλυση. Εκτέλεσε πρώτα αναζήτηση.</p>");
    return;
  }
  const avg = xs.reduce((s, x) => s + finalCombinedScore(x), 0) / xs.length;
  const movies = xs.filter((x) => x.media_type === "movie").length;
  const years = xs.map((x) => Number(String(x._date || "").slice(0, 4))).filter(Boolean);
  const genreCounts = {};
  xs.forEach((x) => genreNames(x, x.media_type).forEach((g) => (genreCounts[g] = (genreCounts[g] || 0) + 1)));
  const top = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const noImdb = xs.filter((x) => !primaryRating(x).value);
  const smallSample = xs
    .filter((x) => primaryRating(x).source === "IMDb" && primaryRating(x).votes < 25000)
    .sort((a, b) => smoothedRankingScore(b) - smoothedRankingScore(a))
    .slice(0, 6);
  showTool(
    `<h3>Ανάλυση αποτελεσμάτων</h3><div class="tool-stat-grid"><div class="tool-stat"><strong>${xs.length}</strong><span>Τίτλοι (${movies} ταινίες · ${xs.length - movies} σειρές)</span></div><div class="tool-stat"><strong>${avg.toFixed(2)}</strong><span>Μέση βαθμολογία</span></div><div class="tool-stat"><strong>${xs.filter((x) => finalCombinedScore(x) >= 8).length}</strong><span>Τίτλοι ≥ 8/10</span></div><div class="tool-stat"><strong>${years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "—"}</strong><span>Χρονικό εύρος</span></div></div>
    <h3>Συχνότερα είδη</h3><ol>${top.map(([g, n]) => `<li>${escapeHtml(g)} — ${n}</li>`).join("")}</ol>
    ${smallSample.length ? `<h3>Λιγότερο γνωστά μέσα στη λίστα</h3><p>${smallSample.map((x) => `<span class="tool-chip">${escapeHtml(x._title)} · IMDb ${primaryRating(x).value.toFixed(1)} · ${primaryRating(x).votes.toLocaleString("el-GR")} ψήφοι</span>`).join(" ")}</p>` : ""}
    ${imdbAvailable() ? `<p class="inline-note">${noImdb.length ? `${noImdb.length} τίτλοι δεν έχουν βαθμολογία IMDb (εκτός ορίων): ${noImdb.slice(0, 8).map((x) => escapeHtml(x._title)).join(", ")}${noImdb.length > 8 ? "…" : ""}` : "Όλοι οι τίτλοι έχουν βαθμολογία IMDb."}</p>` : `<p class="inline-note">Λείπουν τα ημερήσια δεδομένα IMDb.</p>`}
    <p class="inline-note">Ντετερμινιστική ανάλυση των τρεχόντων αποτελεσμάτων — όχι AI πρόβλεψη.</p>`,
  );
}

// --- Score methodology ---
export function v25ScoreEngine() {
  const x = state.items.find((y) => primaryRating(y).value);
  const p = x ? primaryRating(x) : null;
  showTool(
    `<h3>∑ Πώς βαθμολογεί το ScreenScore</h3>
    <p><strong>Βαθμολογία</strong> = μόνο η βαθμολογία <strong>IMDb</strong>, από τα επίσημα ημερήσια αρχεία του IMDb (ενημέρωση ${imdbDataDate() || "—"}). Το TMDB δίνει μόνο πληροφορίες: περιλήψεις, posters, trailer, streaming, ηθοποιούς.</p>
    <p><strong>Κανόνες</strong>: εμφανίζονται μόνο τίτλοι με βαθμολογία IMDb τουλάχιστον ${MIN_IMDB_RATING.toFixed(1)}/10 από τουλάχιστον ${MIN_IMDB_VOTES} ψήφους (${CINOBO_MIN_VOTES} για τίτλους διαθέσιμους στο Cinobo). Ισχύει παντού: λίστες, αναζήτηση, ηθοποιοί, νέες κυκλοφορίες, προτάσεις.</p>
    <p><strong>Βαθμολογία κατάταξης</strong> = (v·R + m·C) / (v + m): R η βαθμολογία IMDb, v οι ψήφοι IMDb, C = ${PRIOR_MEAN.toFixed(1)}, m = ${PRIOR_VOTES.toLocaleString("el-GR")}. Ένα 9/10 από 2.000 ψήφους «τραβιέται» προς το ${PRIOR_MEAN.toFixed(1)}, ώστε να μην ξεπερνά αυτόματα ένα 8,6/10 από 500.000.</p>
    <p><strong>Αξιοπιστία δείγματος (0–100)</strong> = λογαριθμικός δείκτης του αριθμού ψήφων (100 ≈ 1 εκατ. ψήφοι). Δεν είναι πιθανότητα.</p>
    ${x ? `<div class="ranking-explanation"><strong>Παράδειγμα: ${escapeHtml(x._title)}</strong><br>IMDb ${p.value.toFixed(1)}/10 · ${p.votes.toLocaleString("el-GR")} ψήφοι · Κατάταξη: ${smoothedRankingScore(x).toFixed(2)} · Αξιοπιστία: ${reliabilityScore(x)}/100</div>` : ""}`,
  );
}
