// Unit tests for pure logic (no browser): CSV import parsing and sync merge.
import assert from "node:assert/strict";
// The modules touch localStorage/document at import time; provide minimal stand-ins.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] };
const { parseCsv, detectFormat, toEntries } = await import("./importer.js");
const { mergeDocs } = await import("./sync.js");

const rows = parseCsv('﻿Const,Your Rating,Title,Title Type\r\ntt0000001,8,"A, ""quoted"" title",Movie\ntt0000002,,"Line\nbreak",TV Series\n');
assert.equal(rows.length, 2);
assert.equal(rows[0].Title, 'A, "quoted" title');
assert.equal(rows[1].Title, "Line\nbreak");
assert.equal(detectFormat(rows), "imdb-ratings");
assert.equal(detectFormat(parseCsv("Date,Name,Year,Letterboxd URI\n2024-01-01,X,2000,u\n"), "watchlist.csv"), "lb-watchlist");
assert.equal(detectFormat(parseCsv("Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,X,2000,u,3.5\n")), "lb-ratings");
assert.equal(detectFormat(parseCsv("a,b\n1,2\n")), null);
const lb = toEntries(parseCsv("Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,X,2000,u,3.5\n"), "lb-ratings");
assert.equal(lb[0].personalRating, 7);

const now = Date.now();
const a = { watchlist: [{ id: 1, media_type: "movie", _updated: now - 10, n: "old" }, { id: 2, media_type: "tv", _updated: now - 5 }], tombstones: {}, profile: { _updated: 1 } };
const b = { watchlist: [{ id: 1, media_type: "movie", _updated: now, n: "new" }], tombstones: { "tv:2": now }, profile: { _updated: 2, name: "B" } };
const m = mergeDocs(a, b);
assert.equal(m.watchlist.length, 1, "deleted on B stays deleted");
assert.equal(m.watchlist[0].n, "new", "newest change wins");
assert.equal(m.profile.name, "B");
const old = mergeDocs({ watchlist: [], tombstones: { "movie:9": now - 100 * 86400000 } }, {});
assert.deepEqual(old.tombstones, {}, "old tombstones are pruned");
console.log("Unit tests passed");
