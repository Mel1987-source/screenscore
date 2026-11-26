import { allGenres, showTool } from "./common.js";
import { $, dateStr, escapeHtml, genreNames, genreOptions, readJson, saveJson, state } from "./core.js";
import { loadDiscover } from "./discover.js";
import { finalCombinedScore } from "./ratings.js";
import { syncNow } from "./sync.js";
import { persistWatchlist, renderWatchlist } from "./watchlist.js";

// --- Backup (export + import in one panel) ---
export function openBackup() {
  showTool(
    '<h3>Αντίγραφο ασφαλείας</h3><p>Περιλαμβάνει Watchlist, προσωπικές βαθμολογίες, προφίλ και αποθηκευμένα φίλτρα. <strong>Δεν</strong> περιλαμβάνει τα API keys.</p><div class="tool-actions"><button class="primary-button" id="backupExport">↓ Εξαγωγή</button><button class="secondary-button" id="backupImport">↑ Εισαγωγή</button></div>',
  );
  $("backupExport").onclick = exportBackup;
  $("backupImport").onclick = () => $("importBackupFile").click();
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportBackup() {
  downloadJson(
    { app: "ScreenScore", version: 27, exportedAt: new Date().toISOString(), watchlist: state.watchlist, profile: state.profile, savedFilters },
    `screenscore-backup-${dateStr(new Date())}.json`,
  );
  showTool("<h3>Αντίγραφο ασφαλείας</h3><p>Το αρχείο δημιουργήθηκε. Δεν περιλαμβάνει τα API keys.</p>");
}

export function importBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.watchlist)) throw new Error("Το αρχείο δεν περιέχει έγκυρη Watchlist.");
      const cleaned = data.watchlist.filter((x) => x && Number.isFinite(Number(x.id)) && ["movie", "tv"].includes(x.media_type));
      if (!confirm(`Να εισαχθούν ${cleaned.length} τίτλοι; Η υπάρχουσα Watchlist θα αντικατασταθεί.`)) return;
      state.watchlist = cleaned;
      persistWatchlist();
      if (data.profile && typeof data.profile === "object") {
        state.profile = data.profile;
        saveJson("screenscore_profile", state.profile);
      }
      if (Array.isArray(data.savedFilters)) {
        savedFilters.splice(0, savedFilters.length, ...data.savedFilters.filter((f) => f && typeof f.name === "string"));
        saveJson("screenscore_saved_filters", savedFilters);
      }
      renderWatchlist();
      showTool(`<h3>Εισαγωγή ολοκληρώθηκε</h3><p>Εισήχθησαν ${cleaned.length} τίτλοι.</p>`);
    } catch (e) {
      showTool(`<h3>Αποτυχία εισαγωγής</h3><p>${escapeHtml(e.message)}</p>`);
    }
  };
  reader.readAsText(file);
}

// --- Saved filters ---
export const savedFilters = readJson("screenscore_saved_filters", []);

export const FILTER_FIELDS = {
  type: "typeFilter",
  genre: "genreFilter",
  sort: "sortFilter",
  period: "periodFilter",
  min: "minRatingFilter",
  country: "countryFilter",
  language: "languageFilter",
  service: "serviceFilter",
};

export function v24SaveFilters() {
  const current = Object.fromEntries(Object.entries(FILTER_FIELDS).map(([k, id]) => [k, $(id).value]));
  showTool(
    '<h3>Αποθηκευμένα φίλτρα</h3><label for="savedFilterName">Όνομα φίλτρου</label><input id="savedFilterName" placeholder="π.χ. Ευρωπαϊκά θρίλερ"><div class="tool-actions"><button class="primary-button" id="saveFilterNow">Αποθήκευση τρεχόντων φίλτρων</button></div><div id="savedFilterList">' +
      (savedFilters
        .map(
          (f, i) =>
            `<p>${escapeHtml(f.name)} <button class="secondary-button" data-filter-load="${i}">Εφαρμογή</button> <button class="secondary-button" data-filter-del="${i}">Διαγραφή</button></p>`,
        )
        .join("") || "<p>Δεν έχεις αποθηκεύσει φίλτρα.</p>") +
      "</div>",
  );
  $("saveFilterNow").onclick = () => {
    const name = $("savedFilterName").value.trim();
    if (!name) return;
    savedFilters.push({ name, ...current });
    saveJson("screenscore_saved_filters", savedFilters);
    v24SaveFilters();
  };
  document.querySelectorAll("[data-filter-load]").forEach(
    (b) =>
      (b.onclick = () => {
        const f = savedFilters[Number(b.dataset.filterLoad)];
        // Type first: the genre list depends on it.
        $("typeFilter").value = f.type || "all";
        genreOptions();
        for (const [k, id] of Object.entries(FILTER_FIELDS)) {
          if (k === "type" || f[k] === undefined) continue;
          const sel = $(id);
          if ([...sel.options].some((o) => o.value === String(f[k]))) sel.value = f[k];
        }
        $("searchInput").value = "";
        loadDiscover();
      }),
  );
  document.querySelectorAll("[data-filter-del]").forEach(
    (b) =>
      (b.onclick = () => {
        savedFilters.splice(Number(b.dataset.filterDel), 1);
        saveJson("screenscore_saved_filters", savedFilters);
        v24SaveFilters();
      }),
  );
}

// --- Group / family list ---
export const familyList = readJson("screenscore_family_list", []);

export function v24FamilyList() {
  const items = Array.isArray(familyList) ? familyList : familyList.items || [];
  showTool(
    `<h3>Λίστα παρέας / οικογένειας</h3><p>Δημιουργεί λίστα από τα 30 πρώτα τρέχοντα αποτελέσματα για να τη μοιραστείς.</p><div class="tool-actions"><button class="primary-button" id="familyCreate">Δημιουργία από τα αποτελέσματα</button><button class="secondary-button" id="familyExport">Εξαγωγή (.json)</button><button class="secondary-button" id="familyText">Αντιγραφή ως κείμενο</button></div><div id="familySummary"><p>${items.length} τίτλοι στη λίστα.</p>${items.map((x) => `<p>${escapeHtml(x._title)} · ${escapeHtml(String(x._date || "").slice(0, 4))}</p>`).join("")}</div>`,
  );
  $("familyCreate").onclick = () => {
    const slim = state.items.slice(0, 30).map((x) => ({ id: x.id, media_type: x.media_type, _title: x._title, _date: x._date, score: Number(finalCombinedScore(x).toFixed(2)) }));
    familyList.splice(0, familyList.length, ...slim);
    saveJson("screenscore_family_list", familyList);
    v24FamilyList();
  };
  $("familyExport").onclick = () => downloadJson({ app: "ScreenScore family list", items: familyList }, "screenscore-family-list.json");
  $("familyText").onclick = async () => {
    const text = familyList.map((x, i) => `${i + 1}. ${x._title} (${String(x._date || "").slice(0, 4)})${x.score ? ` · ${x.score}/10` : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      $("familyText").textContent = "✓ Αντιγράφηκε";
    } catch (e) {
      showTool(`<h3>Λίστα παρέας</h3><textarea rows="10" style="width:100%">${escapeHtml(text)}</textarea>`);
    }
  };
}

// --- Layout ---
export function v24Layout() {
  const r = $("results");
  const modes = [
    ["standard", "Κάρτες (προεπιλογή)"],
    ["list", "Συμπαγής λίστα"],
    ["poster", "Πλέγμα αφισών"],
  ];
  showTool("<h3>Εμφάνιση αποτελεσμάτων</h3>" + modes.map(([v, l]) => `<p><button class="secondary-button" data-layout="${v}">${l}</button></p>`).join(""));
  document.querySelectorAll("[data-layout]").forEach(
    (b) =>
      (b.onclick = () => {
        r.classList.remove("list-view", "poster-view");
        if (b.dataset.layout === "list") r.classList.add("list-view");
        if (b.dataset.layout === "poster") r.classList.add("poster-view");
        localStorage.setItem("screenscore_results_layout", b.dataset.layout);
      }),
  );
}

// --- Personal profile (includes the yearly recap) ---
export function v25Profile() {
  const p = state.profile || {};
  const chosen = new Set((p.genreIds || []).map(String));
  const watched = state.watchlist.filter((x) => x._watchStatus === "watched");
  const rated = state.watchlist.filter((x) => Number(x.personalRating) > 0);
  const avg = rated.length ? rated.reduce((a, x) => a + Number(x.personalRating), 0) / rated.length : 0;
  const year = String(new Date().getFullYear());
  const thisYear = watched.filter((x) => String(x.watchedDate || "").startsWith(year));
  const withRuntime = thisYear.filter((x) => Number(x._runtime) > 0);
  const hours = withRuntime.reduce((s, x) => s + Number(x._runtime), 0) / 60;
  const counts = {};
  watched
    .concat(state.watchlist.filter((x) => x._watchStatus === "favorite"))
    .forEach((x) => genreNames(x, x.media_type).forEach((g) => (counts[g] = (counts[g] || 0) + 1)));
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  showTool(
    `<h3>◉ Το κινηματογραφικό μου προφίλ</h3><label for="profileName">Όνομα προφίλ</label><input id="profileName" value="${escapeHtml(p.name || "")}" placeholder="π.χ. Cinephile">
    <label>Αγαπημένα είδη (επηρεάζουν το «Τι να δω απόψε»)</label><div class="genre-checks">${allGenres()
      .map(([id, name]) => `<label class="check-row"><input type="checkbox" class="profileGenre" value="${id}"${chosen.has(String(id)) ? " checked" : ""}> ${escapeHtml(name)}</label>`)
      .join("")}</div>
    <div class="tool-actions"><button class="primary-button" id="profileSave">Αποθήκευση προφίλ</button></div>
    <div class="tool-stat-grid"><div class="tool-stat"><strong>${watched.length}</strong><span>Είδα (σύνολο)</span></div><div class="tool-stat"><strong>${rated.length}</strong><span>Προσωπικές βαθμολογίες</span></div><div class="tool-stat"><strong>${avg ? avg.toFixed(1) : "—"}</strong><span>Μέση προσωπική βαθμολογία</span></div><div class="tool-stat"><strong>${state.watchlist.filter((x) => x._watchStatus === "favorite").length}</strong><span>Αγαπημένα</span></div></div>
    <h3>Απολογισμός ${year}</h3><div class="tool-stat-grid"><div class="tool-stat"><strong>${thisYear.length}</strong><span>Τίτλοι που είδα φέτος</span></div><div class="tool-stat"><strong>${withRuntime.length ? hours.toFixed(1) : "—"}</strong><span>Ώρες${withRuntime.length < thisYear.length ? ` (για ${withRuntime.length}/${thisYear.length} με γνωστή διάρκεια)` : ""}</span></div><div class="tool-stat"><strong>${thisYear.filter((x) => x.media_type === "movie").length}</strong><span>Ταινίες</span></div><div class="tool-stat"><strong>${thisYear.filter((x) => x.media_type === "tv").length}</strong><span>Σειρές</span></div></div>
    <p>Συχνά είδη: ${top.map(([g, n]) => `${escapeHtml(g)} (${n})`).join(" · ") || "Συμπλήρωσε τη Watchlist σου"}</p><p class="inline-note">Για σειρές η διάρκεια είναι ενός επεισοδίου, άρα οι ώρες είναι κατώτατη εκτίμηση. Το προφίλ μένει μόνο σε αυτή τη συσκευή.</p>`,
  );
  $("profileSave").onclick = () => {
    state.profile = { name: $("profileName").value.trim(), genreIds: [...document.querySelectorAll(".profileGenre:checked")].map((c) => Number(c.value)), _updated: Date.now() };
    syncNow();
    saveJson("screenscore_profile", state.profile);
    showTool("<h3>Το προφίλ αποθηκεύτηκε</h3><p>Οι προτιμήσεις μένουν στη συσκευή σου.</p>");
  };
}
