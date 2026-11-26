#!/usr/bin/env node
/**
 * ScreenScore — daily IMDb data build (personal, non-commercial use of the IMDb datasets).
 *
 * 1. Streams IMDb's official daily files title.ratings.tsv.gz and title.basics.tsv.gz.
 * 2. Keeps films and series with enough votes and a decent rating.
 * 3. Maps each IMDb id to TMDB (/find) for Greek title, poster, genres, language and release date.
 *    The mapping is cached in data/tmdb-map.json so later runs only look up new titles.
 * 4. Writes data/imdb-titles.json, which the app loads instead of calling OMDb.
 *
 * Env: TMDB_TOKEN (required, TMDB "API Read Access Token")
 *      MIN_VOTES (default 500) · MIN_RATING (default 6.0) · MAX_NEW_LOOKUPS (default 80000)
 *      IMDB_BASE_URL / TMDB_API_BASE (only for tests)
 */
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve(process.argv[2] || "data");
const IMDB = process.env.IMDB_BASE_URL || "https://datasets.imdbws.com";
const TMDB = process.env.TMDB_API_BASE || "https://api.themoviedb.org/3";
const TOKEN = process.env.TMDB_TOKEN;
const MIN_VOTES = Number(process.env.MIN_VOTES || 500);
const MIN_RATING = Number(process.env.MIN_RATING || 6.0); // the app shows only titles rated ≥6.0 from ≥500 votes
const MAX_NEW = Number(process.env.MAX_NEW_LOOKUPS || 80000);
const REFRESH_DAYS = 120; // re-check Greek title/poster of a mapped title after this many days
const RETRY_MISSING_DAYS = 30; // retry titles TMDB did not know
const BACKDROP_MIN_VOTES = 150000; // backdrops only for well-known titles, to keep the file small
const TYPES = { movie: 0, tvMovie: 0, tvSeries: 1, tvMiniSeries: 1 };
const today = Math.floor(Date.now() / 86400000);

if (!TOKEN) {
  console.error("TMDB_TOKEN is missing");
  process.exit(1);
}

async function* tsvRows(file) {
  const res = await fetch(`${IMDB}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const lines = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
  let header = null;
  for await (const line of lines) {
    if (!header) {
      header = line.split("\t");
      continue;
    }
    if (line) yield line.split("\t");
  }
}

// Cinobo titles (independent/festival cinema) only need CINOBO_MIN_VOTES; everything else needs MIN_VOTES.
const CINOBO_MIN_VOTES = Number(process.env.CINOBO_MIN_VOTES || 200);
async function readRatings(cinoboImdb = new Set()) {
  const ratings = new Map();
  for await (const [tconst, avg, votes] of tsvRows("title.ratings.tsv.gz")) {
    const v = Number(votes),
      r = Number(avg);
    if (r >= MIN_RATING && (v >= MIN_VOTES || (v >= CINOBO_MIN_VOTES && cinoboImdb.has(tconst)))) ratings.set(tconst, [r, v]);
  }
  return ratings;
}
// IMDb ids of everything on Cinobo, via TMDB external ids. Cached inside tmdb-map.json under "_cinobo"
// (so the workflow keeps committing a single cache file); only new Cinobo titles cost a request.
async function cinoboImdbIds(where, map) {
  const cache = (map._cinobo = map._cinobo || {});
  const todo = [];
  for (const type of ["movie", "tv"]) for (const [id, bits] of where[type]) if (bits & 2 && !(`${type}:${id}` in cache)) todo.push([type, id]);
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const [type, id] = todo[next++];
      try {
        const d = await tmdbGet(`/${type}/${id}/external_ids`);
        cache[`${type}:${id}`] = /^tt\d+$/.test(d.imdb_id || "") ? d.imdb_id : "";
      } catch (e) {}
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const ids = new Set();
  for (const type of ["movie", "tv"]) for (const [id, bits] of where[type]) if (bits & 2 && cache[`${type}:${id}`]) ids.add(cache[`${type}:${id}`]);
  console.log(`  Cinobo titles with an IMDb id: ${ids.size} (looked up now: ${todo.length})`);
  return ids;
}

async function readBasics(ratings) {
  const titles = [];
  // tconst titleType primaryTitle originalTitle isAdult startYear endYear runtimeMinutes genres
  for await (const c of tsvRows("title.basics.tsv.gz")) {
    const rt = ratings.get(c[0]);
    if (!rt || !(c[1] in TYPES) || c[4] === "1") continue;
    titles.push({ imdb: c[0], type: TYPES[c[1]], name: c[2], year: c[5] === "\\N" ? "" : c[5], runtime: c[7] === "\\N" ? 0 : Number(c[7]) || 0, rating: rt[0], votes: rt[1] });
  }
  return titles;
}

function loadMap(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

async function tmdbFind(imdbId, attempt = 0) {
  const url = `${TMDB}/find/${imdbId}?external_source=imdb_id&language=el-GR`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, accept: "application/json" } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`TMDB ${res.status} for ${imdbId}`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait));
    return tmdbFind(imdbId, attempt + 1);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${imdbId}`);
  return res.json();
}

// Cache record: [tmdbId, type, title, date, poster, genreIds, language, backdrop, day]  or  [0, day] when TMDB has no match.
function toRecord(found, wantedType) {
  const movie = found.movie_results?.[0],
    tv = found.tv_results?.[0];
  const hit = wantedType === 1 ? tv || movie : movie || tv;
  if (!hit) return [0, today];
  const type = hit === tv ? 1 : 0;
  return [hit.id, type, (type ? hit.name : hit.title) || "", (type ? hit.first_air_date : hit.release_date) || "", hit.poster_path || "", hit.genre_ids || [], hit.original_language || "", hit.backdrop_path || "", today];
}

async function mapAll(titles, map) {
  const todo = titles.filter((t) => {
    const rec = map[t.imdb];
    if (!rec) return true;
    if (rec[0] === 0) return today - rec[1] > RETRY_MISSING_DAYS;
    return today - rec[8] > REFRESH_DAYS;
  });
  // New titles first, then the most-voted, so a capped run covers what matters most.
  todo.sort((a, b) => Number(Boolean(map[a.imdb])) - Number(Boolean(map[b.imdb])) || b.votes - a.votes);
  const batch = todo.slice(0, MAX_NEW);
  console.log(`TMDB lookups this run: ${batch.length} (pending ${todo.length})`);
  let next = 0,
    done = 0,
    failed = 0;
  async function worker() {
    while (next < batch.length) {
      const t = batch[next++];
      try {
        map[t.imdb] = toRecord(await tmdbFind(t.imdb), t.type);
      } catch (e) {
        failed++;
      }
      if (++done % 2000 === 0) console.log(`  ${done}/${batch.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`Lookups done: ${done}, failed: ${failed}`);
}

// ===== Streaming availability in Cyprus (JustWatch data via TMDB): only Netflix and Cinobo =====
const REGION = "CY";
const SERVICES = [
  { bit: 1, name: "Netflix", match: /^netflix/i },
  { bit: 2, name: "Cinobo", match: /^cinobo/i },
];
async function tmdbGet(pathAndQuery, attempt = 0) {
  const res = await fetch(`${TMDB}${pathAndQuery}`, { headers: { Authorization: `Bearer ${TOKEN}`, accept: "application/json" } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) throw new Error(`TMDB ${res.status} for ${pathAndQuery}`);
    await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt));
    return tmdbGet(pathAndQuery, attempt + 1);
  }
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${pathAndQuery}`);
  return res.json();
}
// All TMDB ids (per type) offered by one service in Cyprus. Splits by year when a list exceeds TMDB's 500-page cap.
async function catalogue(type, providerIds, from = 1900, to = new Date().getFullYear() + 1) {
  const dateField = type === "movie" ? "primary_release_date" : "first_air_date";
  const base = `/discover/${type}?watch_region=${REGION}&with_watch_providers=${providerIds.join("|")}&with_watch_monetization_types=flatrate|free|ads&${dateField}.gte=${from}-01-01&${dateField}.lte=${to}-12-31&sort_by=popularity.desc`;
  const first = await tmdbGet(`${base}&page=1`);
  if (first.total_pages > 500 && to > from) {
    const mid = Math.floor((from + to) / 2);
    const [a, b] = await Promise.all([catalogue(type, providerIds, from, mid), catalogue(type, providerIds, mid + 1, to)]);
    return new Set([...a, ...b]);
  }
  const ids = new Set(first.results.map((r) => r.id));
  for (let page = 2; page <= Math.min(first.total_pages, 500); page++) (await tmdbGet(`${base}&page=${page}`)).results.forEach((r) => ids.add(r.id));
  return ids;
}
async function streamingAvailability() {
  const where = { movie: new Map(), tv: new Map() };
  try {
    const lists = await Promise.all(["movie", "tv"].map((t) => tmdbGet(`/watch/providers/${t}?watch_region=${REGION}`)));
    const all = lists.flatMap((l) => l.results || []);
    for (const svc of SERVICES) {
      const ids = [...new Set(all.filter((p) => svc.match.test(p.provider_name)).map((p) => p.provider_id))];
      if (!ids.length) {
        console.log(`  ${svc.name}: not listed for ${REGION}`);
        continue;
      }
      for (const type of ["movie", "tv"]) {
        const set = await catalogue(type, ids);
        set.forEach((id) => where[type].set(id, (where[type].get(id) || 0) | svc.bit));
        console.log(`  ${svc.name} ${type}: ${set.size} titles (provider ids ${ids.join(",")})`);
      }
    }
  } catch (e) {
    // Availability is a bonus: a failure here must not stop the ratings update.
    console.log(`Streaming availability skipped: ${e.message}`);
  }
  return where;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mapFile = path.join(OUT_DIR, "tmdb-map.json");
  const map = loadMap(mapFile);
  // Availability first: Cinobo titles get the lower vote threshold.
  console.log(`Streaming availability in ${REGION} (Netflix, Cinobo)…`);
  const where = await streamingAvailability();
  const cinobo = await cinoboImdbIds(where, map);
  console.log(`Reading IMDb ratings (votes ≥ ${MIN_VOTES}, Cinobo ≥ ${CINOBO_MIN_VOTES}, rating ≥ ${MIN_RATING})…`);
  const ratings = await readRatings(cinobo);
  console.log(`  ${ratings.size} rated titles pass the thresholds`);
  const titles = await readBasics(ratings);
  console.log(`  ${titles.length} films/series after type filter`);
  await mapAll(titles, map);
  fs.writeFileSync(mapFile, JSON.stringify(map));

  const rows = [];
  for (const t of titles) {
    const rec = map[t.imdb];
    if (!rec || rec[0] === 0) continue;
    const [tmdbId, type, name, date, poster, genreIds, lang, backdrop] = rec;
    rows.push([Number(t.imdb.slice(2)), tmdbId, type, name || t.name, date || (t.year ? `${t.year}-01-01` : ""), Math.round(t.rating * 10), t.votes, t.runtime, genreIds, lang, poster, t.votes >= BACKDROP_MIN_VOTES ? backdrop : "", where[type ? "tv" : "movie"].get(tmdbId) || 0]);
  }
  rows.sort((a, b) => b[6] - a[6]);
  const out = {
    v: 1,
    generated: new Date().toISOString(),
    minVotes: MIN_VOTES,
    cinoboMinVotes: CINOBO_MIN_VOTES,
    minRating: MIN_RATING,
    fields: ["imdb", "tmdb", "type", "title", "date", "rating10", "votes", "runtime", "genres", "lang", "poster", "backdrop", "where"],
    services: Object.fromEntries(SERVICES.map((s) => [s.bit, s.name])),
    rows,
  };
  const file = path.join(OUT_DIR, "imdb-titles.json");
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`Wrote ${rows.length} titles, ${(fs.statSync(file).size / 1048576).toFixed(1)} MB → ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
