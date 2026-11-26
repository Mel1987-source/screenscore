// End-to-end test: builds a small IMDb dataset with the real build script against a mock IMDb/TMDB
// server, serves the app with it, and checks every main feature in a real browser (Playwright).
// Run: npm test   (first time: npx playwright install chromium)
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "screenscore-"));
// Copy the app (everything except tests, build script and Worker) into a temporary site.
for (const f of fs.readdirSync(repo)) if (/\.(html|css|js|png|webmanifest)$/.test(f) && f !== "worker-api.js") fs.copyFileSync(path.join(repo, f), path.join(root, f));
let failures = 0;

// --- 1. Mock IMDb files + TMDB /find, then run the real build script ---
let ratings = "tconst\taverageRating\tnumVotes\n",
  basics = "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\n";
const types = ["movie", "tvSeries", "tvEpisode", "short", "tvMiniSeries", "movie"];
for (let i = 1; i <= 3000; i++) {
  const id = "tt" + String(i).padStart(7, "0");
  ratings += `${id}\t${(5 + (i % 50) / 10).toFixed(1)}\t${i * 37}\n`;
  basics += `${id}\t${types[i % 6]}\tTitle ${i}\tTitle ${i}\t${i % 97 === 0 ? 1 : 0}\t${1960 + (i % 64)}\t\\N\t${i % 5 === 0 ? "\\N" : 80 + (i % 60)}\tDrama\n`;
}
// Two films with only 300 votes: 9996 is on Cinobo (allowed, floor 200), 9997 is not (excluded, floor 500).
for (const id of ["tt0009996", "tt0009997"]) {
  ratings += `${id}\t7.5\t300\n`;
  basics += `${id}\tmovie\tLow ${id}\tLow\t0\t2015\t\\N\t95\tDrama\n`;
}
const gz = { "/title.ratings.tsv.gz": zlib.gzipSync(ratings), "/title.basics.tsv.gz": zlib.gzipSync(basics) };
const dataSrv = http
  .createServer((q, s) => {
    const u = new URL(q.url, "http://x");
    if (gz[u.pathname]) return s.end(gz[u.pathname]);
    const json = (o) => s.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (/^\/3\/watch\/providers\/(movie|tv)$/.test(u.pathname))
      return json({ results: [{ provider_id: 8, provider_name: "Netflix" }, { provider_id: 1796, provider_name: "Netflix basic with Ads" }, { provider_id: 555, provider_name: "Cinobo" }, { provider_id: 9, provider_name: "Amazon Prime Video" }] });
    const dm = u.pathname.match(/^\/3\/discover\/(movie|tv)$/);
    if (dm) {
      // Netflix: ids divisible by 3 · Cinobo: ids divisible by 7 (2 pages each, to exercise paging)
      const prov = u.searchParams.get("with_watch_providers");
      const div = prov.includes("555") ? 7 : 3;
      const ids = [...Array.from({ length: 3000 }, (_, i) => i + 1), 9996, 9997].filter((n) => n % div === 0);
      const page = +u.searchParams.get("page");
      return json({ page, total_pages: 2, results: ids.filter((_, i) => i % 2 === page - 1).map((id) => ({ id })) });
    }
    const ext = u.pathname.match(/^\/3\/(movie|tv)\/(\d+)\/external_ids$/);
    if (ext) return json({ imdb_id: "tt" + String(ext[2]).padStart(7, "0") });
    const m = u.pathname.match(/^\/3\/find\/tt(\d+)$/);
    if (!m) return s.writeHead(404).end();
    if (+m[1] >= 9996) return json({ movie_results: [{ id: +m[1], title: "Ταινία " + m[1], release_date: "2015-01-01", poster_path: "/p.jpg", genre_ids: [18], original_language: "el" }], tv_results: [] });
    const n = +m[1];
    const body = n % 11 === 0 ? { movie_results: [], tv_results: [] } : types[n % 6].startsWith("tv")
      ? { movie_results: [], tv_results: [{ id: n, name: "Σειρά " + n, first_air_date: "2010-01-01", poster_path: "/p.jpg", genre_ids: [18], original_language: "en" }] }
      : { movie_results: [{ id: n, title: "Ταινία " + n, release_date: "2001-02-03", poster_path: "/p.jpg", genre_ids: [18, 53], original_language: "el" }], tv_results: [] };
    s.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  })
  .listen(0);
const dataPort = dataSrv.address().port;
await new Promise((res, rej) => {
  const p = spawn(process.execPath, [path.join(repo, "build-imdb-data.mjs"), path.join(root, "data")], {
    env: { ...process.env, TMDB_TOKEN: "test", IMDB_BASE_URL: `http://localhost:${dataPort}`, TMDB_API_BASE: `http://localhost:${dataPort}/3` },
    stdio: "inherit",
  });
  p.on("exit", (code) => (code === 0 ? res() : rej(new Error("build script failed"))));
});
dataSrv.close();

// --- 2. Serve the app ---
let serveData = true;
const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  if (!serveData && p.startsWith("/data/")) return res.writeHead(404).end();
  const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" }[path.extname(f)] || "image/png" }); res.end(fs.readFileSync(f)); }).listen(8770);
const errors = [], calls = [];
const ok = (name, cond, extra = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " · " + extra : ""}`);
};
function tmdb(u) {
  const p = u.pathname.replace(/^\/3/, "").replace(/^\/tmdb/, ""); const q = u.searchParams; calls.push(p + "?" + q);
  let m;
  if ((m = p.match(/^\/discover\/(movie|tv)$/)))
    return { page: 1, total_pages: 1, results: [{ id: m[1] === "movie" ? 2999 : 2998, title: "Platform Movie", name: "Platform Show", vote_average: 8, vote_count: 900, genre_ids: [18], release_date: "2015-01-01", first_air_date: "2015-01-01" }, { id: 777, title: "Obscure", name: "Obscure", vote_average: 9.9, vote_count: 60, genre_ids: [18], release_date: "2020-01-01", first_air_date: "2020-01-01" }] };
  if (p === "/search/multi" && q.get("query") === "cinobo")
    return { results: [9996, 9997].map((id) => ({ media_type: "movie", id, title: "Ταινία " + id, vote_average: 8, vote_count: 40, genre_ids: [18] })) };
  if (p === "/search/multi") return { results: [{ media_type: "movie", id: 2999, title: "Ταινία 2999", vote_average: 1, vote_count: 5, genre_ids: [18] }, { media_type: "movie", id: 4242, title: "Νέα ταινία", vote_average: 9, vote_count: 3, genre_ids: [18] }] };
  if ((m = p.match(/^\/find\/tt(\d+)$/))) return { movie_results: [{ id: 5000 + +m[1], title: "Βρέθηκε μέσω find", release_date: "1999-01-01", genre_ids: [18], vote_average: 7, vote_count: 100 }], tv_results: [] };
  if (p === "/search/movie") return { results: q.get("query") === "Unknown Film" ? [] : [{ id: 9000 + q.get("query").length, title: q.get("query"), release_date: `${q.get("year") || 2000}-01-01`, genre_ids: [35], vote_average: 7, vote_count: 50 }] };
  if (p.startsWith("/watch/providers/")) return { results: [{ provider_id: 8, provider_name: "Netflix", display_priorities: { CY: 1 } }, { provider_id: 337, provider_name: "Disney Plus", display_priorities: { CY: 2 } }] };
  if ((m = p.match(/^\/(movie|tv)\/(\d+)\/watch\/providers$/)))
    return { results: { CY: { flatrate: [{ provider_name: "Amazon Prime Video" }, ...(+m[2] % 7 === 0 ? [{ provider_name: "Cinobo" }] : []), ...(+m[2] % 3 === 0 ? [{ provider_name: "Netflix" }] : [])] } } };
  if ((m = p.match(/^\/(movie|tv)\/(\d+)$/))) return { id: +m[2], title: "Λεπτομέρεια", overview: `Ελληνική περίληψη ${m[2]}`, runtime: 100, genres: [{ id: 18 }], videos: { results: [] } };
  return { results: [] };
}
const kv = { doc: null };
async function setup(ctx, init) {
    await ctx.route("https://api.themoviedb.org/**", (r) => r.fulfill({ json: tmdb(new URL(r.request().url())) }));
  await ctx.route("https://proxy.example/**", async (r) => { const u = new URL(r.request().url());
    if (u.pathname === "/sync") { if (r.request().headers()["authorization"] !== "Bearer s3cret") return r.fulfill({ status: 401, json: {} });
      if (r.request().method() === "PUT") { kv.doc = r.request().postData(); return r.fulfill({ status: 204, body: "" }); }
      return r.fulfill({ status: 200, body: kv.doc || "{}", contentType: "application/json" }); }
    return r.fulfill({ json: tmdb(u) }); });
  await ctx.route("https://image.tmdb.org/**", (r) => r.fulfill({ status: 404 }));
  await ctx.addInitScript((init) => {
    try {
      if (!sessionStorage.getItem("i")) {
        for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v);
        sessionStorage.setItem("i", 1);
      }
    } catch (e) {}
  }, init);
}
const status = (page) => page.textContent("#statusText");
const waitStatus = (page, re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById("statusText").textContent), re.source, { timeout: 20000 });
const browser = await chromium.launch();
const ctxA = await browser.newContext(); await setup(ctxA, { screenscore_tmdb_key: "abc" });
const page = await ctxA.newPage(); page.on("pageerror", (e) => errors.push(e.message));
let t0 = Date.now();
await page.goto("http://localhost:8770/"); await waitStatus(page, /δεδομένα IMDb/);
ok("dataset main list", (await page.$$("#results .movie-card")).length === 100, `${Date.now() - t0} ms · ${await status(page)}`);
ok("no discover calls in dataset mode", !calls.some((c) => c.startsWith("/discover")));
const first = await page.$eval("#results .movie-card", (c) => c.querySelector(".rating-score").textContent + " | " + c.querySelector(".votes").textContent);
ok("IMDb rating on card", first.startsWith("IMDb"), first);
const allCards = await page.$$eval("#results .movie-card", (n) => n.map((c) => [parseFloat(c.querySelector(".rating-score").textContent.split("★")[1]), +c.querySelector(".votes").textContent.replace(/\D/g, "")]));
ok("every title ≥6.0 and ≥500 votes", allCards.every(([r, v]) => r >= 6 && v >= 500), `${allCards.length} titles`);
await page.waitForFunction(() => /Ελληνική περίληψη/.test(document.querySelector("#results .overview").textContent), null, { timeout: 5000 }).catch(() => {});
ok("lazy overview", /Ελληνική περίληψη/.test(await page.textContent("#results .overview")));
const lazyCalls = calls.filter((c) => /^\/(movie|tv)\/\d+\?/.test(c)).length;
ok("lazy overview only for visible cards", lazyCalls > 0 && lazyCalls < 40, `${lazyCalls} requests`);
await page.selectOption("#typeFilter", "tv"); await waitStatus(page, /δεδομένα IMDb/);
ok("type filter (dataset)", await page.$$eval("#results .type-tag", (n) => n.every((x) => x.textContent === "SERIES")));
ok("filters in URL", page.url().includes("type=tv"), page.url());
await page.selectOption("#minRatingFilter", "8.5"); await page.waitForTimeout(200);
const mins = await page.$$eval("#results .rating-score", (n) => n.map((x) => parseFloat(x.textContent.split("★")[1])));
ok("min rating (dataset)", mins.length > 0 && Math.min(...mins) >= 8.5, `${mins.length} titles`);
await page.selectOption("#minRatingFilter", "6"); await page.selectOption("#typeFilter", "all"); await page.waitForTimeout(200);
// Hidden gems from dataset
await page.click("#hiddenGemsBtn"); await page.selectOption("#hgLevel", "rare"); await page.click("#hgGo"); await waitStatus(page, /Hidden Gems · \d+ τίτλοι/);
const gems = await page.$$eval("#results .movie-card", (n) => n.map((c) => [+c.querySelector(".votes").textContent.replace(/\D/g, ""), !!c.querySelector(".svc-cinobo")]));
const gv = gems.map((g) => g[0]);
ok("gems via IMDb votes (≥500, or ≥200 on Cinobo)", gems.length > 0 && Math.max(...gv) <= 10000 && gems.every(([v, cin]) => v >= (cin ? 200 : 500)), `${gems.length} titles, ${Math.min(...gv)}–${Math.max(...gv)}`);
ok("tool in URL", page.url().includes("tool=gems"));
// Details deep link + back button
await page.click("#standardResultsBtn"); await waitStatus(page, /δεδομένα IMDb/);
await page.click("#results .details-link");
ok("details opens & URL has title", (await page.$eval("#detailsDialog", (d) => d.open)) && /title=(movie|tv)-\d+/.test(page.url()), page.url());
await page.goBack(); await page.waitForTimeout(300);
ok("back button closes details", !(await page.$eval("#detailsDialog", (d) => d.open)) && !page.url().includes("title="), page.url());
await page.click("#results .details-link"); await page.click("#closeDetails"); await page.waitForTimeout(300);
ok("close button cleans URL", !page.url().includes("title="), page.url());
await page.goto("http://localhost:8770/?title=movie-2999"); await page.waitForFunction(() => document.getElementById("detailsDialog").open, null, { timeout: 10000 });
ok("shared title link", (await page.textContent("#detailTitle")) === "Ταινία 2999");
await page.goto("http://localhost:8770/?type=tv&sort=votes&tool=gems"); await waitStatus(page, /δεδομένα IMDb/);
ok("filters + tool from link", (await page.$eval("#typeFilter", (s) => s.value)) === "tv" && (await page.$eval("#sortFilter", (s) => s.value)) === "votes" && /Hidden Gems/.test(await page.textContent("#toolPanel")));
// Import IMDb + Letterboxd
await page.goto("http://localhost:8770/"); await waitStatus(page, /δεδομένα IMDb/);
const imdbCsv = 'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors\ntt0002999,9,2024-03-01,"Movie, with comma",x,u,Movie,9.9,100,2001,Drama,1,2001-01-01,"A, B"\ntt0099999,7,2024-03-02,Not In Dataset,x,u,movie,7,100,1999,Drama,1,1999-01-01,x\ntt0000005,8,2024-03-03,An Episode,x,u,TV Episode,8,30,2010,Drama,1,2010-01-01,x\n';
fs.writeFileSync(path.join(root, "ratings.csv"), imdbCsv);
fs.writeFileSync(path.join(root, "lb-ratings.csv"), "Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,Some Film,2011,https://boxd.it/x,4.5\n2024-01-02,Unknown Film,2012,https://boxd.it/y,2\n");
for (const [file, expect] of [[path.join(root, "ratings.csv"), /Νέοι: 2 · ενημερώθηκαν: 0 · δεν βρέθηκαν: 0/], [path.join(root, "lb-ratings.csv"), /Νέοι: 1 · ενημερώθηκαν: 0 · δεν βρέθηκαν: 1/]]) {
  await page.click("#importBtn"); await page.setInputFiles("#importFile", file); await page.click("#importGo");
  await page.waitForFunction(() => /Ολοκληρώθηκε/.test(document.getElementById("importPreview").textContent), null, { timeout: 10000 });
  const txt = await page.textContent("#importPreview"); ok(`import ${path.basename(file)}`, expect.test(txt), txt.slice(0, 80));
}
const wl = await page.evaluate(() => JSON.parse(localStorage.getItem("screenscore_watchlist")).map((x) => [x._title, x._watchStatus, x.personalRating, x.watchedDate]));
ok("imported data correct", wl.length === 3 && wl.some((x) => x[2] === 9 && x[1] === "watched" && x[3] === "2024-03-01") && wl.some((x) => x[0] === "Some Film" && x[2] === 9), JSON.stringify(wl));
// Netflix / Cinobo
const chipsOk = await page.$$eval("#results .movie-card", (n) =>
  n.every((c) => {
    const id = +c.querySelector(".details-link").href.match(/\/(\d+)$/)?.[1];
    const chips = [...c.querySelectorAll(".service-chip")].map((x) => x.textContent);
    return !id || ((id % 3 === 0) === chips.includes("Netflix") && (id % 7 === 0) === chips.includes("Cinobo"));
  }),
);
ok("Netflix / Cinobo badges match the catalogue", chipsOk);
await page.selectOption("#serviceFilter", "2"); await waitStatus(page, /δεδομένα IMDb/);
const cinobo = await page.$$eval("#results .movie-card", (n) => n.map((c) => [...c.querySelectorAll(".service-chip")].map((x) => x.textContent)));
ok("filter: only Cinobo", cinobo.length > 0 && cinobo.every((c) => c.includes("Cinobo")), `${cinobo.length} titles`);
ok("service filter in URL", page.url().includes("service=2"));
await page.click("#results .details-link"); await page.waitForTimeout(500);
const streamTxt = await page.textContent("#detailStreaming");
ok("details show only Netflix/Cinobo", /Cinobo/.test(streamTxt) && !/Amazon/.test(streamTxt), streamTxt.slice(0, 80));
await page.click("#closeDetails");
await page.selectOption("#serviceFilter", "0");
// Live list (country filter) is ranked only by IMDb
await page.selectOption("#countryFilter", "US"); await waitStatus(page, /Ολοκληρώθηκε.*IMDb ≥/);
const liveCards = await page.$$eval("#results .movie-card", (n) => n.map((c) => c.querySelector(".rating-score").textContent));
ok("live list ranked only by IMDb (unrated & TMDB 9.9 excluded)", liveCards.length === 2 && liveCards.every((t) => t.startsWith("IMDb")), JSON.stringify(liveCards));
await page.selectOption("#countryFilter", "all");
await page.fill("#searchInput", "ταινία"); await page.press("#searchInput", "Enter"); await waitStatus(page, /Αναζήτηση:/);
const searchCards = await page.$$eval("#results .movie-card", (n) => n.map((c) => c.querySelector(".rating-score").textContent));
ok("search shows only titles meeting the rules", searchCards.length === 1 && searchCards[0].startsWith("IMDb"), JSON.stringify(searchCards));
ok("no TMDB rating shown anywhere", !(await page.textContent("#results")).includes("TMDB ★"));
await page.fill("#searchInput", "cinobo"); await page.press("#searchInput", "Enter"); await waitStatus(page, /Αναζήτηση: \d+ τίτλοι για «cinobo»/);
const lowVotes = await page.$$eval("#results .movie-card", (n) => n.map((c) => c.querySelector(".movie-title").textContent + " | " + c.querySelector(".votes").textContent + " | " + [...c.querySelectorAll(".service-chip")].map((x) => x.textContent).join(",")));
ok("Cinobo title with 300 votes shown, non-Cinobo excluded", lowVotes.length === 1 && lowVotes[0].includes("9996") && lowVotes[0].includes("Cinobo"), JSON.stringify(lowVotes));
await page.fill("#searchInput", ""); await page.press("#searchInput", "Enter");
// Sync between two devices
await page.click("#settingsBtn"); await page.fill("#workerProxyUrl", "https://proxy.example"); await page.fill("#syncToken", "s3cret"); await page.click('#settingsForm button[type=submit]');
await page.waitForTimeout(800);
ok("device A pushed", kv.doc && JSON.parse(kv.doc).watchlist.length === 3);
const ctxB = await browser.newContext(); await setup(ctxB, { screenscore_proxy_url: "https://proxy.example", screenscore_sync_token: "s3cret" });
const pB = await ctxB.newPage(); pB.on("pageerror", (e) => errors.push("B " + e.message));
await pB.goto("http://localhost:8770/"); await pB.waitForFunction(() => /Συγχρονίστηκε/.test(document.getElementById("syncStatus")?.textContent || "") || JSON.parse(localStorage.getItem("screenscore_watchlist") || "[]").length === 3, null, { timeout: 10000 }).catch(() => {});
ok("device B received watchlist", (await pB.evaluate(() => JSON.parse(localStorage.getItem("screenscore_watchlist") || "[]").length)) === 3);
await pB.click("#watchlist .save-button"); await pB.waitForTimeout(2600); // remove one title on B (debounced push)
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await page.waitForTimeout(800);
ok("deletion synced back to A", (await page.evaluate(() => JSON.parse(localStorage.getItem("screenscore_watchlist")).length)) === 2);
// Accessibility smoke checks
const a11y = await page.evaluate(() => ({ unlabeled: [...document.querySelectorAll("button")].filter((b) => !b.textContent.trim() && !b.getAttribute("aria-label")).length, live: document.getElementById("statusText").getAttribute("aria-live") }));
ok("all buttons have a name", a11y.unlabeled === 0, JSON.stringify(a11y));
// Without the dataset the app falls back to live TMDB lists
serveData = false;
const ctxC = await browser.newContext();
await setup(ctxC, { screenscore_tmdb_key: "abc" });
const pC = await ctxC.newPage();
pC.on("pageerror", (e) => errors.push("C " + e.message));
await pC.goto("http://localhost:8770/");
await waitStatus(pC, /Χωρίς δεδομένα IMDb/);
ok("without dataset: clear message, no ratings", /Λείπουν τα ημερήσια δεδομένα IMDb/.test(await pC.textContent("#results")));

ok("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
srv.close();
fs.rmSync(root, { recursive: true, force: true });
console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
