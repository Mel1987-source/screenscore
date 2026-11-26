// Shareable URLs: filters, search, open title and open tool live in the address bar,
// and the phone's back button closes an open title instead of leaving the app.
import { $, genreOptions } from "./core.js";

const FILTERS = { type: "typeFilter", genre: "genreFilter", sort: "sortFilter", period: "periodFilter", min: "minRatingFilter", country: "countryFilter", lang: "languageFilter", service: "serviceFilter" };
let defaults = null;

export function initRouter() {
  defaults = Object.fromEntries(Object.entries(FILTERS).map(([k, id]) => [k, $(id).value]));
}
function setIfOption(id, value) {
  const sel = $(id);
  if ([...sel.options].some((o) => o.value === value)) sel.value = value;
}
export function applyUrlToFilters() {
  const p = new URLSearchParams(location.search);
  if (p.has("type")) {
    setIfOption("typeFilter", p.get("type"));
    genreOptions();
  }
  for (const [k, id] of Object.entries(FILTERS)) if (k !== "type" && p.has(k)) setIfOption(id, p.get(k));
  if (p.has("q")) $("searchInput").value = p.get("q");
}
function buildParams({ title = null, tool = null } = {}) {
  const p = new URLSearchParams();
  if (defaults)
    for (const [k, id] of Object.entries(FILTERS)) {
      const v = $(id).value;
      if (v !== defaults[k]) p.set(k, v);
    }
  const q = $("searchInput").value.trim();
  if (q) p.set("q", q);
  if (tool) p.set("tool", tool);
  if (title) p.set("title", `${title.media_type}-${title.id}`);
  const s = p.toString();
  return location.pathname + (s ? `?${s}` : "");
}
function currentTool() {
  return new URLSearchParams(location.search).get("tool");
}
export function updateUrlFromFilters() {
  if (!defaults) return;
  try {
    history.replaceState(history.state, "", buildParams({ title: titleFromUrl(), tool: currentTool() }));
  } catch (e) {}
}
export function setToolInUrl(tool) {
  try {
    history.replaceState(history.state, "", buildParams({ tool, title: titleFromUrl() }));
  } catch (e) {}
}
export function toolFromUrl() {
  return currentTool();
}
export function pushTitle(x) {
  try {
    history.pushState({ dialog: true }, "", buildParams({ title: x, tool: currentTool() }));
  } catch (e) {}
}
// Called when the details dialog closes by any means (button, Esc, back).
export function leaveTitle(fromPopstate) {
  if (fromPopstate || !titleFromUrl()) return;
  if (history.state?.dialog) history.back();
  else history.replaceState(null, "", buildParams({ tool: currentTool() }));
}
export function titleFromUrl() {
  const m = /^(movie|tv)-(\d+)$/.exec(new URLSearchParams(location.search).get("title") || "");
  return m ? { media_type: m[1], id: Number(m[2]) } : null;
}
export function titleShareUrl(x) {
  return new URL(`${location.pathname}?title=${x.media_type}-${x.id}`, location.origin).toString();
}
