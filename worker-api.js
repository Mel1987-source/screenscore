/**
 * ScreenScore v26 — optional Cloudflare Worker API proxy.
 *
 * Deploy as a separate Worker and set these as secrets / variables:
 *   TMDB_TOKEN      TMDB "API Read Access Token" (the long eyJ… token)      — required for /tmdb/*
 *   SYNC_TOKEN      Long random secret for device sync                      — required for /sync
 *   SYNC            KV namespace binding (Workers → KV → create, then bind as "SYNC") — required for /sync
 *   ALLOWED_ORIGIN  Origin(s) of your PWA, comma-separated, e.g.
 *                   https://screenscore.example.workers.dev                 — strongly recommended
 *
 * Without ALLOWED_ORIGIN any website could use your tokens through this Worker.
 *
 * Routes:  GET /tmdb/<tmdb v3 path>?<query>   e.g. /tmdb/discover/movie?sort_by=vote_average.desc
 *          GET|PUT /sync  (Authorization: Bearer <SYNC_TOKEN>) — watchlist/profile document
 */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}
function corsHeaders(request, env) {
  const list = allowedOrigins(env);
  const origin = request.headers.get("Origin") || "";
  const allow = !list.length ? "*" : list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}
function originAllowed(request, env) {
  const list = allowedOrigins(env);
  if (!list.length) return true;
  const origin = request.headers.get("Origin");
  // Same-origin navigations and some fetches send no Origin; fall back to Referer.
  const ref = origin || (request.headers.get("Referer") ? new URL(request.headers.get("Referer")).origin : "");
  return list.includes(ref);
}
function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

// Constant-time comparison, so the token cannot be guessed from response timing.
function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a)),
    y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
async function handleSync(request, env, headers) {
  if (!env.SYNC || !env.SYNC_TOKEN) return json({ error: "Sync is not configured (SYNC KV binding and SYNC_TOKEN secret)" }, 503, headers);
  const auth = request.headers.get("Authorization") || "";
  if (!sameSecret(auth.replace(/^Bearer\s+/i, ""), env.SYNC_TOKEN)) return json({ error: "Unauthorized" }, 401, headers);
  if (request.method === "GET") {
    const doc = await env.SYNC.get("doc");
    return new Response(doc || "{}", { status: 200, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  if (request.method === "PUT") {
    const body = await request.text();
    if (body.length > 5 * 1024 * 1024) return json({ error: "Too large" }, 413, headers);
    let doc;
    try {
      doc = JSON.parse(body);
    } catch {
      return json({ error: "Invalid JSON" }, 400, headers);
    }
    if (!doc || !Array.isArray(doc.watchlist)) return json({ error: "Invalid document" }, 400, headers);
    await env.SYNC.put("doc", JSON.stringify(doc));
    return new Response(null, { status: 204, headers });
  }
  return json({ error: "Method not allowed" }, 405, headers);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!originAllowed(request, env)) return json({ error: "Origin not allowed" }, 403, headers);
    if (url.pathname === "/sync") return handleSync(request, env, headers);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, headers);

    // Small per-isolate throttle. For strict global limits use a Cloudflare Rate Limiting rule.
    const now = Date.now();
    let bucket = globalThis.__ssRate || { start: now, count: 0 };
    if (now - bucket.start > 60000) bucket = { start: now, count: 0 };
    bucket.count++;
    globalThis.__ssRate = bucket;
    if (bucket.count > 300) return json({ error: "Rate limit exceeded" }, 429, headers);

    if (url.pathname.startsWith("/tmdb/")) {
      if (!env.TMDB_TOKEN) return json({ error: "Missing TMDB_TOKEN secret" }, 503, headers);
      const path = url.pathname.slice("/tmdb/".length); // no leading slash → no "3//movie" URLs
      if (!/^[a-z0-9_/-]+$/i.test(path)) return json({ error: "Invalid path" }, 400, headers);
      const target = new URL("https://api.themoviedb.org/3/" + path);
      url.searchParams.forEach((v, k) => {
        if (k !== "api_key") target.searchParams.set(k, v);
      });
      // Edge cache: identical TMDB requests from any user are served from Cloudflare for 1 hour.
      const cache = caches.default;
      const cacheKey = new Request(target.toString(), { method: "GET" });
      let upstream = await cache.match(cacheKey);
      if (!upstream) {
        upstream = await fetch(target, { headers: { Authorization: `Bearer ${env.TMDB_TOKEN}`, accept: "application/json" } });
        if (upstream.ok) {
          const toCache = new Response(upstream.clone().body, upstream);
          toCache.headers.set("Cache-Control", "public, max-age=3600");
          ctx.waitUntil(cache.put(cacheKey, toCache));
        }
      }
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
      });
    }

    return json({ service: "ScreenScore API proxy", version: 29, routes: ["/tmdb/*", "/sync"], status: "ok" }, 200, headers);
  },
};
