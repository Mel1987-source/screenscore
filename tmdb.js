import { API_BASE, normalize, setStatus, state } from "./core.js";

export function hasTmdbAccess() {
  return Boolean(state.key || state.proxy);
}

export function getHeaders() {
  return { Authorization: state.key.startsWith("eyJ") ? `Bearer ${state.key}` : "", accept: "application/json" };
}

export function makeUrl(path, params = {}) {
  const url = new URL(state.proxy ? state.proxy.replace(/\/$/, "") + "/tmdb" + path : API_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  if (!state.proxy && !state.key.startsWith("eyJ")) url.searchParams.set("api_key", state.key);
  return url.toString();
}

export async function api(path, params = {}) {
  if (!hasTmdbAccess()) throw new Error("Χρειάζεται TMDB API key ή Cloudflare Proxy URL. Άνοιξε τις ρυθμίσεις.");
  const headers = !state.proxy && state.key.startsWith("eyJ") ? getHeaders() : {};
  const r = await fetch(makeUrl(path, params), { headers });
  if (!r.ok) throw new Error(r.status === 401 ? "Το API key δεν έγινε δεκτό. Έλεγξε τις ρυθμίσεις." : `Σφάλμα δεδομένων (${r.status}).`);
  return r.json();
}

export async function apiWithRetry(path, params = {}, attempt = 0) {
  try {
    return await api(path, params);
  } catch (e) {
    const retryable = /\(429\)|\(5\d\d\)/.test(e.message);
    if (retryable && attempt < 5) {
      const delay = Math.min(30000, 1500 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return apiWithRetry(path, params, attempt + 1);
    }
    throw e;
  }
}

// Runs async jobs over a list with a small concurrency limit (avoids 429 bursts).
export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

// Fetches up to maxPages of a TMDB list, stopping early at TMDB's own total_pages.
export async function fetchPages(path, params, type, { maxPages = 50, label = "", isStale = () => false } = {}) {
  const first = await apiWithRetry(path, { language: "el-GR", ...params, page: 1 });
  const total = Math.max(1, Math.min(maxPages, Number(first.total_pages) || 1, 500));
  const pages = [first];
  let completed = 1;
  if (label) setStatus(`${label}: ${completed}/${total} σελίδες`);
  const rest = Array.from({ length: total - 1 }, (_, i) => i + 2);
  const more = await mapLimit(rest, 4, async (page) => {
    if (isStale()) return null;
    const d = await apiWithRetry(path, { language: "el-GR", ...params, page });
    completed++;
    if (label && !isStale()) setStatus(`${label}: ${completed}/${total} σελίδες`);
    return d;
  });
  pages.push(...more.filter(Boolean));
  return pages.flatMap((d) => (d.results || []).map((x) => normalize(x, type)));
}
