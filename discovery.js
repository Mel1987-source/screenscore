import { NON_FICTION_TV, genreSelectHtml, isInWatchlist, rankAndShow, requireImdbData, requireKey, runTool, showDatasetList, showTool, typeSelectHtml, typesOf } from "./common.js";
import { $, dateStr, escapeHtml, genreNames, includeAnimation, normalize, periodRange, setStatus, state } from "./core.js";
import { openDetails } from "./details.js";
import { beginLoad, discoverParams } from "./discover.js";
import { hasImdbData, queryImdbData } from "./imdbData.js";
import { finalCombinedScore, primaryRating } from "./ratings.js";
import { apiWithRetry, fetchPages, mapLimit } from "./tmdb.js";

// --- Recommendations from favourites / high personal ratings ---
export async function loadRecommendations() {
  if (!requireKey()) return;
  let seeds = state.watchlist.filter((x) => x._watchStatus === "favorite" || Number(x.personalRating) >= 8).slice(0, 6);
  const basis = seeds.length ? "αγαπημένους τίτλους ή βαθμολογίες 8/10+" : "τις πιο πρόσφατες αποθηκεύσεις σου";
  if (!seeds.length) seeds = state.watchlist.slice(0, 3);
  if (!seeds.length) {
    showTool("<h3>Προτάσεις για εσένα</h3><p>Πρόσθεσε πρώτα μερικούς τίτλους στη Watchlist και σημείωσε τους αγαπημένους σου.</p>");
    return;
  }
  showTool(`<h3>Προτάσεις για εσένα</h3><p>Αναζητώ παρόμοιους τίτλους με βάση ${seeds.length} ${basis}…</p>`);
  await runTool("Προτάσεις για εσένα", async () => {
    const pages = await mapLimit(seeds, 3, (seed) =>
      apiWithRetry(`/${seed.media_type}/${seed.id}/recommendations`, { language: "el-GR", page: 1 }).then((d) =>
        (d.results || []).map((x) => normalize(x, x.media_type || seed.media_type)),
      ),
    );
    // Titles that several favourites point to rank first among equals; already-saved titles are skipped.
    const freq = new Map();
    pages.flat().forEach((x) => freq.set(`${x.media_type}:${x.id}`, (freq.get(`${x.media_type}:${x.id}`) || 0) + 1));
    const rows = pages.flat().filter((x) => !isInWatchlist(x));
    await rankAndShow(rows, "Προτάσεις για εσένα");
    showTool(
      `<h3>Προτάσεις για εσένα</h3><p>Βασίστηκαν σε ${seeds.length} ${basis}. Οι τίτλοι που έχεις ήδη στη Watchlist παραλείπονται.</p><p class="inline-note">Οι προτάσεις παρέχονται από το TMDB και ταξινομούνται με το ScreenScore.</p>`,
    );
  });
}

// --- New releases ---
export function openNewReleaseChoices() {
  showTool(
    '<h3>Νέες κυκλοφορίες</h3><p>Επίλεξε λίστα.</p><div class="tool-actions"><button class="primary-button" id="nowPlayingTool">Στους κινηματογράφους</button><button class="secondary-button" id="upcomingTool">Επερχόμενα</button><button class="secondary-button" id="onAirTool">Σειρές τώρα</button></div><p class="inline-note">Τα στοιχεία κινηματογράφων αφορούν την Κύπρο όπου το TMDB έχει δεδομένα. Οι νέοι τίτλοι έχουν λίγες ψήφους, οπότε η βαθμολογία τους είναι ακόμη ασταθής.</p>',
  );
  $("nowPlayingTool").onclick = () => loadReleaseList("now");
  $("upcomingTool").onclick = () => loadReleaseList("upcoming");
  $("onAirTool").onclick = () => loadReleaseList("tv");
}

export async function loadReleaseList(which) {
  await runTool("Νέες κυκλοφορίες", async () => {
    const isStale = beginLoad();
    const cfg = {
      now: ["/movie/now_playing", "movie", "Ταινίες στους κινηματογράφους", "popular"],
      upcoming: ["/movie/upcoming", "movie", "Επερχόμενες ταινίες", "soonest"],
      tv: ["/tv/on_the_air", "tv", "Σειρές που προβάλλονται τώρα", "popular"],
    }[which];
    const rows = await fetchPages(cfg[0], { region: "CY" }, cfg[1], { maxPages: 5, label: cfg[2], isStale });
    let list = rows;
    if (which === "upcoming") list = rows.filter((x) => (x._date || "") >= dateStr(new Date()));
    await rankAndShow(list, cfg[2], { sortMode: cfg[3], isStale, note: "νέοι τίτλοι εμφανίζονται μόλις φτάσουν τις 500 ψήφους IMDb" });
  });
}

// --- Hidden Gems: highly rated titles that relatively few people have rated ---
// "Few people" is measured with IMDb votes.
export const GEM_LEVELS = {
  // Lower bound 0: the per-title floor applies (500 votes, or 200 for Cinobo titles).
  rare: { label: "Πολύ άγνωστα", imdb: [0, 10000] },
  gems: { label: "Άγνωστα", imdb: [0, 30000] },
  lesser: { label: "Λιγότερο γνωστά", imdb: [0, 75000] },
};

export function v26HiddenGems() {
  if (!requireImdbData()) return;
  const range = (l) => `έως ${l.imdb[1].toLocaleString("el-GR")} ψήφοι IMDb`;
  showTool(
    `<h3>💎 Hidden Gems</h3><p>Τίτλοι με υψηλή βαθμολογία IMDb που όμως τους έχουν δει (και βαθμολογήσει) σχετικά λίγοι.</p>${typeSelectHtml("hgType")}${genreSelectHtml("hgGenre")}
    <label for="hgLevel">Πόσο «άγνωστο»;</label><select id="hgLevel">${Object.entries(GEM_LEVELS)
      .map(([k, l]) => `<option value="${k}"${k === "gems" ? " selected" : ""}>${l.label} · ${range(l)}</option>`)
      .join("")}</select>
    <label for="hgRating">Ελάχιστη βαθμολογία IMDb</label><select id="hgRating"><option value="7">7+/10</option><option value="7.5" selected>7,5+/10</option><option value="8">8+/10</option></select>
    <label class="check-row"><input id="hgHideSaved" type="checkbox" checked> Απόκρυψη όσων έχω ήδη στη Watchlist</label>
    <div class="tool-actions"><button class="primary-button" id="hgGo">Βρες Hidden Gems</button></div>
    <p class="inline-note">Τίτλοι κάτω από 500 ψήφους IMDb (200 για όσους είναι στο Cinobo) δεν μετράνε, γιατί η βαθμολογία τους είναι πολύ ασταθής. Εξαιρούνται τίτλοι των τελευταίων 6 μηνών. Η κατάταξη χρησιμοποιεί την εξομαλυμένη βαθμολογία, ώστε λίγοι ενθουσιώδεις θαυμαστές να μη φουσκώνουν ένα αποτέλεσμα.</p>`,
  );
  $("hgGo").onclick = () => {
    const level = GEM_LEVELS[$("hgLevel").value];
    let items = queryImdbData({
      type: $("hgType").value,
      genre: $("hgGenre").value || "all",
      minRating: Number($("hgRating").value),
      minVotes: level.imdb[0],
      maxVotes: level.imdb[1],
      olderThanDays: 182,
      excludeTvGenres: NON_FICTION_TV,
    });
    if ($("hgHideSaved").checked) items = items.filter((x) => !isInWatchlist(x));
    showDatasetList(items, "💎 Hidden Gems", `${level.label} · ${range(level)}`);
  };
}

// --- Mood → TMDB genre combinations (comma = AND, pipe = OR) ---
export const MOODS = [
  { label: "Αγωνιώδες", movie: "53", tv: "80|9648" },
  { label: "Σκοτεινό", movie: "80,53", tv: "80,18" },
  { label: "Μυστηριώδες", movie: "9648", tv: "9648" },
  { label: "Συγκινητικό", movie: "18,10749", tv: "18,10751" },
  { label: "Ανατρεπτικό (twist)", keyword: "twist ending" },
  { label: "Χαλαρό / feel-good", movie: "35|10751", tv: "35" },
  { label: "Τρομακτικό", movie: "27", tv: "10765,9648" },
  { label: "Επικό / περιπέτεια", movie: "12|28", tv: "10759" },
  { label: "Να με βάλει σε σκέψεις", movie: "878,18", tv: "10765,18" },
];

export function v24Mood() {
  if (!requireImdbData()) return;
  showTool(
    `<h3>Τι διάθεση έχω;</h3><label for="moodChoice">Διάθεση</label><select id="moodChoice">${MOODS.map((m, i) => `<option value="${i}">${m.label}</option>`).join("")}</select>${typeSelectHtml("moodType")}<div class="tool-actions"><button class="primary-button" id="moodGo">Βρες τίτλους</button></div><p class="inline-note">Κάθε διάθεση αντιστοιχεί σε συνδυασμό ειδών TMDB (ή λέξη-κλειδί για το «twist»). Δεν είναι κατανόηση της πλοκής.</p>`,
  );
  $("moodGo").onclick = () =>
    runTool("Τι διάθεση έχω;", async () => {
      const isStale = beginLoad();
      const mood = MOODS[Number($("moodChoice").value)];
      if (hasImdbData() && !mood.keyword) {
        const items = queryImdbData({ type: $("moodType").value, genreExpr: { movie: mood.movie, tv: mood.tv } });
        showDatasetList(items, `Διάθεση: ${mood.label}`);
        return;
      }
      let keywordIds = "";
      if (mood.keyword) {
        const k = await apiWithRetry("/search/keyword", { query: mood.keyword, page: 1 });
        keywordIds = (k.results || []).slice(0, 3).map((x) => x.id).join("|");
        if (!keywordIds) {
          showTool("<p>Δεν βρέθηκαν αντίστοιχες λέξεις-κλειδιά TMDB.</p>");
          return;
        }
      }
      const tasks = typesOf($("moodType").value).map((t) => {
        const params = { sort_by: "vote_average.desc", "vote_count.gte": state.minVotes, include_adult: state.showAdult };
        if (keywordIds) params.with_keywords = keywordIds;
        else params.with_genres = mood[t];
        if (!includeAnimation()) params.without_genres = "16";
        return fetchPages(`/discover/${t}`, params, t, { maxPages: 5, label: mood.label, isStale });
      });
      await rankAndShow((await Promise.all(tasks)).flat(), `Διάθεση: ${mood.label}`, { isStale });
    }, true);
}

// --- People: real filmography via combined_credits (TMDB's /discover/tv does not support with_people) ---
export function openPeopleSearch() {
  showTool(
    '<h3>Ηθοποιός ή σκηνοθέτης</h3><label for="personNameInput">Όνομα</label><input id="personNameInput" placeholder="π.χ. Christopher Nolan"><div class="tool-actions"><button class="primary-button" id="personSearchGo">Αναζήτηση</button></div><div id="personSearchStatus"></div>',
  );
  $("personSearchGo").onclick = searchPerson;
  $("personNameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchPerson();
  });
}

export async function searchPerson() {
  if (!requireKey()) return;
  const name = $("personNameInput").value.trim();
  if (!name) return;
  const out = $("personSearchStatus");
  out.textContent = "Αναζήτηση προσώπου…";
  try {
    const d = await apiWithRetry("/search/person", { query: name, language: "el-GR", page: 1 });
    const people = (d.results || []).slice(0, 6);
    if (!people.length) {
      out.textContent = "Δεν βρέθηκε πρόσωπο.";
      return;
    }
    const dept = { Acting: "Ηθοποιός", Directing: "Σκηνοθέτης", Writing: "Σεναριογράφος", Production: "Παραγωγός" };
    out.innerHTML =
      "<p>Επίλεξε πρόσωπο:</p>" +
      people
        .map(
          (p, i) =>
            `<button class="secondary-button person-pick" data-i="${i}">${escapeHtml(p.name)} · ${escapeHtml(dept[p.known_for_department] || p.known_for_department || "—")}${p.known_for?.[0] ? ` · ${escapeHtml(p.known_for[0].title || p.known_for[0].name || "")}` : ""}</button>`,
        )
        .join("");
    out.querySelectorAll(".person-pick").forEach((b) => (b.onclick = () => loadPersonWorks(people[Number(b.dataset.i)])));
    if (people.length === 1) loadPersonWorks(people[0]);
  } catch (e) {
    out.textContent = String(e.message || e);
  }
}

export async function loadPersonWorks(person) {
  await runTool("Ηθοποιός ή σκηνοθέτης", async () => {
    const isStale = beginLoad();
    setStatus(`Φόρτωση φιλμογραφίας: ${person.name}…`);
    const c = await apiWithRetry(`/person/${person.id}/combined_credits`, { language: "el-GR" });
    const crewJobs = new Set(["Director", "Screenplay", "Writer", "Creator", "Novel"]);
    const rows = [...(c.cast || []), ...(c.crew || []).filter((x) => crewJobs.has(x.job))]
      .filter((x) => x.media_type === "movie" || x.media_type === "tv")
      .filter((x) => !(x.media_type === "tv" && (x.genre_ids || []).some((g) => NON_FICTION_TV.includes(g))))
      .map((x) => normalize(x, x.media_type));
    await rankAndShow(rows, `Έργα: ${person.name}`, { isStale });
    $("personSearchStatus").innerHTML = `<p class="inline-note">Εμφανίζεται η φιλμογραφία του/της ${escapeHtml(person.name)} (ρόλοι, σκηνοθεσία, σενάριο) από το TMDB.</p>`;
  });
}

// --- Runtime: filtered on TMDB's side with with_runtime ---
export function v24Runtime() {
  if (!requireImdbData()) return;
  showTool(
    `<h3>Φίλτρο διάρκειας</h3><label for="runtimeType">Τύπος</label><select id="runtimeType"><option value="movie">Ταινίες</option><option value="tv">Σειρές (διάρκεια επεισοδίου)</option></select><label for="runtimeMax">Μέγιστη διάρκεια</label><select id="runtimeMax"><option value="30">30 λεπτά</option><option value="45">45 λεπτά</option><option value="60">60 λεπτά</option><option value="90">90 λεπτά</option><option value="105">105 λεπτά</option><option value="120" selected>120 λεπτά</option><option value="150">150 λεπτά</option></select><div class="tool-actions"><button class="primary-button" id="runtimeGo">Εφαρμογή</button></div><p class="inline-note">Χρησιμοποιεί και τα υπόλοιπα φίλτρα της αρχικής σελίδας (είδος, περίοδο, γλώσσα, χώρα).</p>`,
  );
  $("runtimeGo").onclick = () =>
    runTool("Φίλτρο διάρκειας", async () => {
      const isStale = beginLoad();
      const t = $("runtimeType").value,
        max = Number($("runtimeMax").value);
      state.genre = $("genreFilter").value;
      if (hasImdbData() && $("countryFilter").value === "all") {
        const items = queryImdbData({
          type: t,
          genre: state.genre,
          yearRange: periodRange($("periodFilter").value),
          minRating: Number($("minRatingFilter").value) || 0,
          language: $("languageFilter").value,
          minRuntime: t === "movie" ? 40 : 10,
          maxRuntime: max,
        });
        showDatasetList(items, `${t === "movie" ? "Ταινίες" : "Σειρές"} έως ${max} λεπτά`, "διάρκεια από IMDb");
        return;
      }
      const params = discoverParams(t, "score");
      if (!params) {
        showTool("<p>Το επιλεγμένο είδος δεν υπάρχει για αυτόν τον τύπο.</p>");
        return;
      }
      Object.assign(params, { "with_runtime.gte": t === "movie" ? 40 : 10, "with_runtime.lte": max });
      const rows = await fetchPages(`/discover/${t}`, params, t, { maxPages: 10, label: "Διάρκεια", isStale });
      await rankAndShow(rows, `${t === "movie" ? "Ταινίες" : "Σειρές"} έως ${max} λεπτά`, { isStale });
    }, true);
}

// --- Awards: keyword-based hints only ---
export function v24Awards() {
  if (!requireKey()) return;
  showTool(
    `<h3>Βραβεία & φεστιβάλ</h3><p>Το TMDB δεν έχει επίσημο μητρώο βραβείων. Εδώ αναζητούνται ταινίες με σχετικές λέξεις-κλειδιά TMDB — είναι ενδείξεις, όχι πιστοποίηση βράβευσης.</p><label for="awardSearch">Αναζήτηση</label><select id="awardSearch"><option value="oscar">Oscar / Academy Awards</option><option value="bafta">BAFTA</option><option value="palme d'or">Χρυσός Φοίνικας</option><option value="cannes">Φεστιβάλ Καννών</option><option value="golden globe">Χρυσή Σφαίρα</option></select><div class="tool-actions"><button class="primary-button" id="awardGo">Αναζήτηση</button></div>`,
  );
  $("awardGo").onclick = () =>
    runTool("Βραβεία & φεστιβάλ", async () => {
      const isStale = beginLoad();
      const q = $("awardSearch").value;
      const d = await apiWithRetry("/search/keyword", { query: q, page: 1 });
      const ids = (d.results || []).slice(0, 5).map((x) => x.id);
      if (!ids.length) {
        showTool("<p>Δεν βρέθηκαν σχετικές λέξεις-κλειδιά στο TMDB.</p>");
        return;
      }
      const label = $("awardSearch").selectedOptions[0].textContent;
      const rows = await fetchPages(
        "/discover/movie",
        { with_keywords: ids.join("|"), sort_by: "vote_average.desc", "vote_count.gte": state.minVotes, include_adult: state.showAdult },
        "movie",
        { maxPages: 5, label, isStale },
      );
      await rankAndShow(rows, `Σχετικοί τίτλοι: ${label}`, { isStale });
    });
}

// --- Tonight: prefers your own "want to watch" list, never suggests something already watched ---
export function pickTonight() {
  const prefGenres = (state.profile?.genreIds || []).map(Number);
  const notWatched = (x) => {
    const saved = state.watchlist.find((y) => y.id === x.id && y.media_type === x.media_type);
    return !saved || saved._watchStatus !== "watched";
  };
  const wants = state.watchlist.filter((x) => (x._watchStatus || "want") === "want" && finalCombinedScore(x) >= 7);
  let pool = wants.length ? wants : state.items.filter((x) => finalCombinedScore(x) >= 7 && notWatched(x));
  const source = wants.length ? "από τη λίστα «Θέλω να δω»" : "από τα τρέχοντα αποτελέσματα";
  if (prefGenres.length) {
    const preferred = pool.filter((x) => (x.genre_ids || []).some((g) => prefGenres.includes(g)));
    if (preferred.length) pool = preferred;
  }
  if (!pool.length) {
    showTool("<h3>Τι να δω απόψε;</h3><p>Δεν υπάρχουν διαθέσιμοι τίτλοι με βαθμολογία 7/10+. Κάνε αναζήτηση ή πρόσθεσε τίτλους στη Watchlist.</p>");
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  showTool(
    `<h3>Η πρόταση για απόψε</h3><div class="tonight-pick"><strong>${escapeHtml(pick._title)}</strong><p>${escapeHtml(String(pick._date || "").slice(0, 4))} · ${escapeHtml(genreNames(pick, pick.media_type).join(" · "))}</p><p>${primaryRating(pick).source} ${finalCombinedScore(pick).toFixed(1)}/10 · ${source}</p><button class="primary-button" id="tonightDetails">Λεπτομέρειες</button><button class="secondary-button" id="tonightAgain">Άλλη πρόταση</button></div>`,
  );
  $("tonightDetails").onclick = () => openDetails(pick);
  $("tonightAgain").onclick = pickTonight;
}

// --- Franchise order ---
export function v24Franchise() {
  if (!requireKey()) return;
  showTool(
    '<h3>Σειρές ταινιών</h3><label for="franchiseQuery">Τίτλος ταινίας (π.χ. John Wick)</label><input id="franchiseQuery" placeholder="Όνομα ταινίας"><div class="tool-actions"><button class="primary-button" id="franchiseGo">Αναζήτηση συλλογής</button></div><div id="franchiseOut"></div>',
  );
  $("franchiseGo").onclick = async () => {
    const q = $("franchiseQuery").value.trim();
    if (!q) return;
    try {
      const d = await apiWithRetry("/search/movie", { query: q, page: 1, language: "el-GR" });
      // Prefer the first result that actually belongs to a collection.
      let detail = null;
      for (const r of (d.results || []).slice(0, 5)) {
        const det = await apiWithRetry(`/movie/${r.id}`, { language: "el-GR" });
        if (det.belongs_to_collection) {
          detail = det;
          break;
        }
      }
      if (!detail) {
        $("franchiseOut").textContent = "Δεν βρέθηκε καταχωρισμένη συλλογή TMDB για αυτόν τον τίτλο.";
        return;
      }
      const col = await apiWithRetry(`/collection/${detail.belongs_to_collection.id}`, { language: "el-GR" });
      const today = dateStr(new Date());
      $("franchiseOut").innerHTML = `<h4>${escapeHtml(col.name)}</h4><ol>${(col.parts || [])
        .sort((a, b) => (a.release_date || "9999").localeCompare(b.release_date || "9999"))
        .map(
          (x) =>
            `<li>${escapeHtml(x.title)} (${(x.release_date || "").slice(0, 4) || "—"})${x.release_date > today ? " · επερχόμενη" : ""}${x.vote_count ? ` · TMDB ${Number(x.vote_average).toFixed(1)}` : ""}</li>`,
        )
        .join("")}</ol><p class="inline-note">Σειρά κυκλοφορίας — δεν ταυτίζεται πάντα με τη χρονολογία της ιστορίας.</p>`;
    } catch (e) {
      $("franchiseOut").textContent = e.message;
    }
  };
}
