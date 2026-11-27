// Cloudflare Pages "advanced mode": εξυπηρετεί την εφαρμογή κανονικά και, στη διεύθυνση /api/warnings,
// δίνει τις προειδοποιήσεις του Τμήματος Μετεωρολογίας Κύπρου (MeteoAlarm Atom feed) ως JSON.
const FEED = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-cyprus';
const KINDS = [[/thunder/i, 'thunder'], [/rain|flood/i, 'rain'], [/wind/i, 'wind'], [/snow|ice/i, 'snow'], [/high temp|heat/i, 'hot'],
  [/low temp|cold|frost/i, 'cold'], [/fog/i, 'fog'], [/forest|fire/i, 'fire'], [/coastal|sea|wave/i, 'sea'], [/dust/i, 'dust']];
const LV = { yellow: 1, orange: 2, red: 3 };
const tag = (x, t) => ((x.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')) || [])[1] || '').trim();

async function warnings(now = Date.now()) {
  const r = await fetch(FEED, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!r.ok) throw new Error('feed ' + r.status);
  const out = [];
  for (const e of (await r.text()).split('<entry>').slice(1)) {
    const ev = tag(e, 'cap:event'), m = ev.match(/(yellow|orange|red)\s*$/i);
    if (!m || /cancel/i.test(tag(e, 'cap:message_type'))) continue;
    const expires = Date.parse(tag(e, 'cap:expires'));
    if (!(expires > now)) continue; // το feed κρατά και ληγμένες προειδοποιήσεις
    const name = ev.slice(0, m.index).trim(), kind = KINDS.find(k => k[0].test(name));
    out.push({ id: tag(e, 'cap:identifier'), level: LV[m[1].toLowerCase()], type: kind ? kind[1] : 'other', name,
      onset: Date.parse(tag(e, 'cap:onset')) || Date.parse(tag(e, 'cap:effective')), expires });
  }
  return out.sort((a, b) => b.level - a.level || a.onset - b.onset);
}

const enc = new TextEncoder();
const b64u = {
  enc: b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0))
};
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

// Κεφαλίδες ασφαλείας για όλες τις απαντήσεις. Αν κάτι (π.χ. ο χάρτης) δεν φορτώνει, το πρώτο που ελέγχουμε είναι αυτή η λίστα.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://*.rainviewer.com https://cdnjs.cloudflare.com",
  "connect-src 'self' https://api.open-meteo.com https://air-quality-api.open-meteo.com https://marine-api.open-meteo.com https://geocoding-api.open-meteo.com https://api.rainviewer.com https://api.sunrise-sunset.org https://feeds.meteoalarm.org https://el.wikipedia.org https://en.wikipedia.org https://archive-api.open-meteo.com",
  "font-src 'self'", "manifest-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"
].join('; ');
const SEC = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow' // να μην εμφανίζεται σε μηχανές αναζήτησης
};
const secure = res => { const r = new Response(res.body, res); for (const k in SEC) r.headers.set(k, SEC[k]); return r; };


const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w.-]+\.push\.apple\.com|[\w.-]+\.notify\.windows\.com)\//;
const COOLDOWN = 3 * 3600 * 1000; // ελάχιστο διάστημα ανά τύπο όσο το φαινόμενο συνεχίζεται
const REARM = 3600 * 1000;        // αν το φαινόμενο λείψει ≥1 ώρα και ξαναεμφανιστεί, ειδοποιεί αμέσως
const KT = { thunder: '⛈️ Καταιγίδες', rain: '🌧️ Έντονες βροχές', wind: '💨 Ισχυροί άνεμοι', snow: '❄️ Χιόνι / πάγος', hot: '🌡️ Υψηλές θερμοκρασίες', cold: '🥶 Χαμηλές θερμοκρασίες', fog: '🌫️ Ομίχλη', fire: '🔥 Κίνδυνος πυρκαγιάς', sea: '🌊 Παράκτια φαινόμενα', dust: '🌫️ Σκόνη' };
const LVT = { 1: ['🟡', 'Κίτρινη'], 2: ['🟠', 'Πορτοκαλί'], 3: ['🔴', 'Κόκκινη'] };
const fmt = ms => new Date(ms).toLocaleString('el-GR', { timeZone: 'Asia/Nicosia', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const num = (v, d, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const sha = async s => b64u.enc(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const MAX_SUBS_DEFAULT = 5; // πόσες συσκευές μπορούν να γραφτούν για ειδοποιήσεις (αλλάζει με μεταβλητή MAX_SUBS στο Cloudflare)
// Ο server απαντά μόνο σε κλήσεις από την ίδια την εφαρμογή. Ο browser δηλώνει από πού γίνεται η κλήση (Sec-Fetch-Site / Origin).
// Εξαίρεση: το /api/cron, που το καλεί το cron-job.org (προστατεύεται με το μυστικό κλειδί).
function foreign(request, u) {
  const sfs = request.headers.get('Sec-Fetch-Site'), origin = request.headers.get('Origin');
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') return true;
  if (origin && origin !== u.origin) return true;
  return false;
}
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const needKV = env => { if (!env.SUBS || !env.SUBS.get) throw new Error('KV'); };

// Τα κλειδιά VAPID δημιουργούνται αυτόματα την πρώτη φορά και αποθηκεύονται στο KV του λογαριασμού σου.
async function vapid(env) {
  needKV(env);
  let v = JSON.parse(await env.SUBS.get('cfg:vapid') || 'null');
  if (!v) {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const j = await crypto.subtle.exportKey('jwk', k.privateKey);
    v = { pub: b64u.enc(cat(new Uint8Array([4]), b64u.dec(j.x), b64u.dec(j.y))), priv: j.d };
    await env.SUBS.put('cfg:vapid', JSON.stringify(v));
  }
  return v;
}
async function vapidJwt(v, aud, subject) {
  const pub = b64u.dec(v.pub);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: v.priv, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)) }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = o => b64u.enc(enc.encode(JSON.stringify(o)));
  const data = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud, exp: Math.floor(Date.now() / 1000) + 43200, sub: subject });
  return data + '.' + b64u.enc(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(data)));
}
async function push(v, sub, payload, origin) {
  const body = await encrypt(sub, enc.encode(JSON.stringify(payload)));
  const r = await fetch(sub.endpoint, { method: 'POST', body, headers: {
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high',
    Authorization: `vapid t=${await vapidJwt(v, new URL(sub.endpoint).origin, origin)}, k=${v.pub}` } });
  return r.status;
}

// ---------- Βοηθητικά: ζώνη ώρας, ώρες ησυχίας ----------
const TZ0 = 'Asia/Nicosia';
const okTz = z => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch (e) { return false; } };
function lp(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms).reduce((o, p) => (o[p.type] = p.value, o), {});
  return { date: `${f.year}-${f.month}-${f.day}`, hh: f.hour, mi: f.minute, min: (+f.hour) * 60 + (+f.minute) };
}
const toMin = s => { const m = /^(\d\d):(\d\d)$/.exec(s || ''); return m && +m[1] < 24 && +m[2] < 60 ? (+m[1]) * 60 + (+m[2]) : null; };
function isQuiet(prefs, tz, ms) {
  if (!prefs.quiet) return false;
  const a = toMin(prefs.qFrom), b = toMin(prefs.qTo); if (a == null || b == null || a === b) return false;
  const m = lp(ms, tz).min; return a < b ? (m >= a && m < b) : (m >= a || m < b);
}

// ---------- Open-Meteo με επαναλήψεις και ΟΡΑΤΟ σφάλμα ----------
async function omFetch(url) {
  let last = 'άγνωστο σφάλμα';
  for (let t = 0; t < 3; t++) {
    let r;
    try { r = await fetch(url); } catch (e) { last = 'δίκτυο: ' + e.message; await new Promise(res => setTimeout(res, 700)); continue; }
    if (r.ok) { const j = await r.json(); if (j && !j.error) return j; last = 'Open-Meteo: ' + ((j && j.reason) || 'σφάλμα απάντησης'); break; }
    last = 'Open-Meteo HTTP ' + r.status;
    if (![429, 500, 502, 503, 504].includes(r.status)) break;
    await new Promise(res => setTimeout(res, 700 * (t + 1)));
  }
  throw new Error(last);
}

// ---------- MET Norway (δεύτερη πηγή / εφεδρεία). Θέλει ταυτοποίηση με User-Agent, γι' αυτό καλείται από τον server ----------
async function metFetch(lat, lon, origin) {
  const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`, { headers: { 'User-Agent': `kairos-weather-pwa/1.0 (+${origin})` }, cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw new Error('MET Norway HTTP ' + r.status);
  const ts = (await r.json())?.properties?.timeseries;
  if (!ts || !ts.length) throw new Error('MET Norway: κενή απάντηση');
  return ts.slice(0, 40).map(x => {
    const d = x.data?.instant?.details || {}, n1 = x.data?.next_1_hours || {}, n6 = x.data?.next_6_hours || {};
    return { time: x.time, t: d.air_temperature ?? null, wind: d.wind_speed ?? null, gust: d.wind_speed_of_gust ?? null,
      sym: n1.summary?.symbol_code || n6.summary?.symbol_code || '', p: n1.details?.precipitation_amount ?? null,
      pp: n1.details?.probability_of_precipitation ?? null, th: n1.details?.probability_of_thunder ?? null };
  });
}
const metCode = (s, th) => {
  s = String(s || '').toLowerCase();
  if (/thunder/.test(s) || th >= 60) return 95; if (/heavysnow/.test(s)) return 75; if (/snow|sleet/.test(s)) return 73;
  if (/heavyrain/.test(s)) return 65; if (/rain|showers/.test(s)) return /light/.test(s) ? 61 : 63; if (/fog/.test(s)) return 45;
  if (/partlycloudy/.test(s)) return 2; if (/cloudy/.test(s)) return 3; if (/fair/.test(s)) return 1; if (/clearsky/.test(s)) return 0; return 3;
};
function metToH(rows, tz) { // ίδια μορφή με τα ωριαία δεδομένα του Open-Meteo (δείκτης 0 = τώρα)
  const rs = rows.slice(0, 13);
  return { time: rs.map(r => { const l = lp(Date.parse(r.time), tz); return `${l.date}T${l.hh}:${l.mi}`; }),
    temperature_2m: rs.map(r => r.t), precipitation: rs.map(r => r.p ?? 0), precipitation_probability: rs.map(r => r.pp),
    weather_code: rs.map(r => metCode(r.sym, r.th)), wind_gusts_10m: rs.map(r => r.gust != null ? r.gust * 3.6 : null) };
}

// ---------- Ανάλυση ακραίων φαινομένων (εκτιμήσεις, όχι επίσημες προειδοποιήσεις) ----------
function analyze(h, prefs) {
  const out = [];
  const rainMmOn = prefs.rainMm ?? true, rainProbOn = prefs.rainProb ?? true, rainP = prefs.rainP ?? 50, rainT = prefs.rainT ?? 7.6,
    dustT = prefs.dustT ?? 50, gustT = prefs.gust ?? 60, hotT = prefs.hotT ?? 38, coldT = prefs.coldT ?? 0;
  const G = h.wind_gusts_10m.filter(v => v != null), T = h.temperature_2m.filter(v => v != null), PP = h.precipitation_probability.map(v => v ?? 0);
  const info = { rainP, rainMmOn, rainProbOn, probMax: Math.max(0, ...PP), gustT, hotT, coldT, rainT, dustT,
    gustNow: h.wind_gusts_10m[0], gustMax: Math.max(0, ...G), tempNow: h.temperature_2m[0], tempMax: Math.max(...T), tempMin: Math.min(...T),
    precipNow: h.precipitation[0], precipMax: Math.max(0, ...h.precipitation), dustMax: null };
  const idx = f => { for (let i = 0; i < h.time.length; i++) if (f(i)) return i; return -1; };
  const hh = i => h.time[i].slice(11, 16), code = i => h.weather_code[i];
  let i;
  if (prefs.storm && (i = idx(i => [95, 96, 99].includes(code(i)))) >= 0)
    out.push({ type: 'storm', kind: 'thunder', title: '⛈️ Καταιγίδα και κεραυνοί', body: i === 0 ? 'Καταιγίδα τώρα.' : `Πιθανή καταιγίδα με κεραυνούς από τις ${hh(i)}.` });
  if (prefs.rain) {
    const iMm = rainMmOn ? idx(i => h.precipitation[i] >= rainT) : -1;
    const iPr = rainProbOn ? idx(i => (h.precipitation_probability[i] ?? 0) >= rainP) : -1;
    if (iMm >= 0 || iPr >= 0) {
      const first = Math.min(...[iMm, iPr].filter(x => x >= 0)), parts = [];
      if (iMm >= 0) parts.push(`έως ${info.precipMax.toFixed(1)} mm/ώρα`);
      if (iPr >= 0) parts.push(`πιθανότητα έως ${Math.round(info.probMax)}%`);
      out.push({ type: 'rain', kind: 'rain', title: iMm >= 0 ? '🌧️ Έντονη βροχή' : '🌦️ Πιθανή βροχή',
        body: (first === 0 ? 'Βροχή τώρα' : `Βροχή από τις ${hh(first)}`) + ` (${parts.join(', ')}).` + (iMm >= 0 ? ' Πιθανά λιμνάζοντα νερά.' : '') });
    }
  }
  if (prefs.wind && (i = idx(i => h.wind_gusts_10m[i] >= gustT)) >= 0)
    out.push({ type: 'wind', kind: 'wind', title: '💨 Ισχυροί άνεμοι', body: `Ριπές έως ${Math.round(info.gustMax)} km/h ${i === 0 ? 'τώρα' : 'γύρω στις ' + hh(i)}.` });
  if (prefs.hot && (i = idx(i => h.temperature_2m[i] >= hotT)) >= 0)
    out.push({ type: 'hot', kind: 'hot', title: '🌡️ Καύσωνας', body: `Θερμοκρασία έως ${Math.round(info.tempMax)}° τις επόμενες ώρες.` });
  if (prefs.frost && (i = idx(i => h.temperature_2m[i] <= coldT)) >= 0)
    out.push({ type: 'frost', kind: 'cold', title: '🥶 Παγετός', body: `Θερμοκρασία έως ${Math.round(info.tempMin)}° τις επόμενες ώρες.` });
  if (prefs.snow) {
    if ((i = idx(i => [71, 73, 75, 77, 85, 86].includes(code(i)))) >= 0) out.push({ type: 'snow', kind: 'snow', title: '❄️ Χιόνι', body: i === 0 ? 'Χιονίζει τώρα.' : `Αναμένεται χιόνι από τις ${hh(i)}.` });
    if ((i = idx(i => [56, 57, 66, 67].includes(code(i)))) >= 0) out.push({ type: 'ice', kind: 'snow', title: '🧊 Πάγος', body: `Πιθανή παγωμένη βροχή ή ψιχάλα από τις ${hh(i)}. Προσοχή σε δρόμους και πεζοδρόμια.` });
  }
  out.info = info;
  return out;
}

async function evaluate(rec, origin, tz) {
  const { place, prefs } = rec; let h = null, src = 'Open-Meteo', omErr = null;
  try {
    const j = await omFetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,precipitation,weather_code,wind_gusts_10m&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,wind_gusts_10m&forecast_hours=12&timezone=auto&wind_speed_unit=kmh`);
    h = j.hourly; if (!h) throw new Error('Open-Meteo: λείπουν τα ωριαία δεδομένα');
    const c = j.current; // ό,τι συμβαίνει ΤΩΡΑ μπαίνει πρώτο
    if (c && c.time) { h.time.unshift(c.time); h.temperature_2m.unshift(c.temperature_2m); h.precipitation.unshift(c.precipitation ?? 0); h.precipitation_probability.unshift((c.precipitation ?? 0) >= 0.1 ? 100 : 0); h.weather_code.unshift(c.weather_code); h.wind_gusts_10m.unshift(c.wind_gusts_10m); }
  } catch (e) { omErr = e.message; h = null; }
  if (!h) { // εφεδρεία: MET Norway
    try { h = metToH(await metFetch(place.lat, place.lon, origin), tz); src = 'MET Norway'; }
    catch (e2) { throw new Error(omErr + ' · ' + e2.message); }
  }
  const out = analyze(h, prefs); out.info.source = src; if (omErr) out.info.omError = omErr; out.h = h;
  if (prefs.dust) {
    try {
      const d = await omFetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}&current=dust&hourly=dust&forecast_hours=12&timezone=auto`);
      const mx = Math.max(d.current?.dust || 0, ...(d.hourly?.dust || []).filter(v => v != null));
      out.info.dustMax = mx;
      if (mx >= (prefs.dustT ?? 50)) out.push({ type: 'dust', kind: 'dust', title: '🌫️ Σκόνη (εκτίμηση)', body: `Αυξημένη σκόνη στην ατμόσφαιρα (έως ${Math.round(mx)} µg/m³). Εκτίμηση μοντέλου, όχι επίσημη προειδοποίηση.` });
    } catch (e) { out.info.dustError = e.message; }
  }
  return out;
}

// ---------- Έγκαιρη ειδοποίηση: φαινόμενα έως 7 ημέρες μπροστά ----------
// Μία ειδοποίηση την ημέρα (στην ώρα της πρωινής περίληψης) για όσο το φαινόμενο παραμένει στην πρόγνωση.
// Αν εμφανιστεί νέο φαινόμενο μέσα στην ημέρα, στέλνεται αμέσως. Αν εξαφανιστεί από την πρόγνωση, σταματά σιωπηλά.
const AHN = { storm: 'Καταιγίδα', rainmm: 'Έντονη βροχή', rain: 'Βροχή', wind: 'Ισχυροί άνεμοι', hot: 'Καύσωνας', frost: 'Παγετός', snow: 'Χιόνι', ice: 'Παγωμένη βροχή', dust: 'Σκόνη' };
const WD = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ'];
function dayLabel(date) { const [y, m, d] = date.split('-').map(Number); return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + '/' + m; }
const dDiff = (a, b) => Math.round((Date.parse(b + 'T00:00Z') - Date.parse(a + 'T00:00Z')) / 864e5);
function aheadScan(h, prefs, today, days, dust, start = 12, end = Infinity) {
  const rainT = prefs.rainT ?? 7.6, rainP = prefs.rainP ?? 50, gustT = prefs.gust ?? 60, hotT = prefs.hotT ?? 38, coldT = prefs.coldT ?? 0, dustT = prefs.dustT ?? 50;
  const ev = {}, put = (type, i, val, txt, icon) => {
    const date = h.time[i].slice(0, 10), k = type + '|' + date, d = dDiff(today, date);
    if (d < 0 || i >= end) return;
    const e = ev[k] || (ev[k] = { key: k, type, date, d, hh: h.time[i].slice(11, 16), max: val, icon, txt });
    if (val > e.max) e.max = val;
    if (typeof txt === 'function') e.txt = txt;
  };
  for (let i = start; i < h.time.length; i++) { // οι επόμενες 12 ώρες καλύπτονται ήδη από τις κανονικές ειδοποιήσεις
    const c = h.weather_code[i], pr = h.precipitation[i] ?? 0, pp = h.precipitation_probability[i] ?? 0, g = h.wind_gusts_10m[i], t = h.temperature_2m[i];
    if (prefs.storm && [95, 96, 99].includes(c)) put('storm', i, 1, () => 'Πιθανή καταιγίδα με κεραυνούς', '⛈️');
    if (prefs.rain) {
      const mm = (prefs.rainMm ?? true) && pr >= rainT, p = (prefs.rainProb ?? true) && pp >= rainP;
      if (mm) put('rainmm', i, pr, e => 'Έντονη βροχή, έως ' + e.max.toFixed(1) + ' mm/ώρα', '🌧️');
      else if (p) put('rain', i, pp, e => 'Βροχή, πιθανότητα έως ' + Math.round(e.max) + '%', '🌦️');
    }
    if (prefs.wind && g != null && g >= gustT) put('wind', i, g, e => 'Ριπές ανέμου έως ' + Math.round(e.max) + ' km/h', '💨');
    if (prefs.hot && t != null && t >= hotT) put('hot', i, t, e => 'Καύσωνας, έως ' + Math.round(e.max) + '°', '🌡️');
    if (prefs.frost && t != null && t <= coldT) put('frost', i, -t, e => 'Παγετός, έως ' + Math.round(-e.max) + '°', '🥶');
    if (prefs.snow && [71, 73, 75, 77, 85, 86].includes(c)) put('snow', i, 1, () => 'Χιόνι', '❄️');
    if (prefs.snow && [56, 57, 66, 67].includes(c)) put('ice', i, 1, () => 'Παγωμένη βροχή, πιθανός πάγος', '🧊');
  }
  if (dust && prefs.dust) for (let i = start; i < dust.time.length; i++) if ((dust.dust[i] ?? 0) >= dustT) put('dust', i, dust.dust[i], e => 'Σκόνη, έως ' + Math.round(e.max) + ' µg/m³ (εκτίμηση)', '🌫️');
  // αν υπάρχει και «έντονη βροχή» και «βροχή» την ίδια μέρα, κρατάμε μόνο την έντονη
  for (const k of Object.keys(ev)) if (ev[k].type === 'rain' && ev['rainmm|' + ev[k].date]) delete ev[k];
  return Object.values(ev).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.hh < b.hh ? -1 : 1)
    .map(e => ({ ...e, line: `${e.icon} ${dayLabel(e.date)} από ${e.hh} · ${e.txt(e)} (${e.d === 0 ? 'σήμερα' : e.d === 1 ? 'αύριο' : 'σε ' + e.d + ' ημέρες'})` }));
}
async function aheadFetch(place, prefs, days) {
  const H = days * 24 + 1 + 72; // +3 ημέρες μόνο για εντοπισμό μετακινήσεων πέρα από το όριο
  const j = await omFetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,wind_gusts_10m&forecast_hours=${H}&timezone=auto&wind_speed_unit=kmh`);
  if (!j.hourly || !j.hourly.time) throw new Error('Open-Meteo: λείπει η πρόγνωση ημερών');
  let dust = null;
  if (prefs.dust) try { const d = await omFetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}&hourly=dust&forecast_hours=${Math.min(days * 24 + 1, 120)}&timezone=auto`); dust = d.hourly || null; } catch (e) {}
  return { h: j.hourly, dust };
}

function summaryText(h, prefs) {
  const T = h.temperature_2m.filter(v => v != null), P = h.precipitation_probability, rp = prefs.rainP ?? 50;
  let i = -1; for (let k = 0; k < h.time.length; k++) if (P[k] != null ? P[k] >= rp : h.precipitation[k] >= 0.2) { i = k; break; }
  return `Σήμερα ${Math.round(Math.min(...T))}°–${Math.round(Math.max(...T))}°. ` + (i >= 0 ? `Βροχή γύρω στις ${h.time[i].slice(11, 16)}.` : 'Χωρίς βροχή τις επόμενες ώρες.');
}

// ---------- Επεξεργασία μίας συσκευής (κύρια τοποθεσία + προαιρετικά αγαπημένες) ----------
async function processSub(env, v, W, key, rec, origin) {
  const rep = { sent: [], notes: [], error: null, info: null };
  const now = Date.now(), tz = rec.place.tz || TZ0; let changed = false, dead = false;
  rec.gone = rec.gone || {}; rec.sent = rec.sent || {}; rec.seen = rec.seen || []; rec.xs = rec.xs || {}; rec.hist = rec.hist || [];
  const quiet = isQuiet(rec.prefs, tz, now);
  if (quiet) rep.notes.push('Ώρες ησυχίας: οι ειδοποιήσεις αναβάλλονται (εκτός από κόκκινες επίσημες προειδοποιήσεις).');
  const send = async payload => {
    payload = { ...payload, id: payload.id || now.toString(36) + '-' + Math.random().toString(36).slice(2, 7), t: now };
    const st = await push(v, rec.sub, payload, origin);
    if (st === 404 || st === 410) { dead = true; await env.SUBS.delete(key); rep.notes.push('Η συσκευή δεν δέχεται πια ειδοποιήσεις (HTTP ' + st + '). Πάτα «Ενεργοποίηση» ξανά.'); }
    else if (st < 300) { rec.hist.unshift({ id: payload.id, t: now, title: payload.title, body: payload.body }); rec.hist.length = Math.min(rec.hist.length, 30); changed = true; }
    return st;
  };
  // αν υπάρχει ενεργή επίσημη προειδοποίηση για το ίδιο φαινόμενο, δεν στέλνουμε και εκτίμηση
  const covered = new Set(rec.prefs.official && W ? W.filter(w => w.level >= (rec.prefs.min || 1)).map(w => w.type) : []);
  const locs = [{ place: rec.place, st: rec, main: true }];
  if (rec.prefs.favAlerts) for (const p of (rec.extra || []).slice(0, 5)) { const id = p.lat.toFixed(2) + ',' + p.lon.toFixed(2); rec.xs[id] = rec.xs[id] || { sent: {}, gone: {} }; locs.push({ place: p, st: rec.xs[id] }); }
  let hMain = null;
  for (const loc of locs) {
    if (dead) break;
    let al = null;
    try { al = await evaluate({ place: loc.place, prefs: rec.prefs }, origin, tz); if (loc.main) { rep.info = al.info; hMain = al.h; } }
    catch (e) { if (loc.main) rep.error = e.message; else rep.notes.push(loc.place.name + ': ' + e.message); }
    if (!al) continue;
    const list = al.filter(a => !covered.has(a.kind)), present = new Set(list.map(a => a.type)), st = loc.st;
    st.sent = st.sent || {}; st.gone = st.gone || {};
    al.filter(a => covered.has(a.kind)).forEach(a => rep.notes.push(a.title + ': καλύπτεται από επίσημη προειδοποίηση'));
    for (const t of Object.keys(st.sent)) if (!present.has(t) && !st.gone[t]) { st.gone[t] = now; changed = true; }
    for (const a of list) {
      if (dead) break;
      const label = loc.main ? a.title : `${a.title} (${loc.place.name})`;
      if (st.gone[a.type]) { if (now - st.gone[a.type] >= REARM) st.sent[a.type] = 0; delete st.gone[a.type]; changed = true; }
      const wait = COOLDOWN - (now - (st.sent[a.type] || 0));
      if (wait > 0) { rep.notes.push(label + ': ήδη στάλθηκε, παύση ακόμα ' + Math.ceil(wait / 60000) + ' λεπτά'); continue; }
      if (quiet) { rep.notes.push(label + ': αναβλήθηκε (ώρες ησυχίας)'); continue; }
      // μοναδική ετικέτα: με την ίδια ετικέτα το iOS αντικαθιστά σιωπηλά την προηγούμενη ειδοποίηση
      const res = await send({ title: a.title, body: loc.place.name + ': ' + a.body, tag: a.type + '-' + (loc.main ? '' : 'x-') + now });
      if (res < 300) { st.sent[a.type] = now; changed = true; rep.sent.push(label); } else if (!dead) rep.notes.push(label + ': αποτυχία αποστολής (HTTP ' + res + ')');
    }
  }
  if (rec.prefs.official && W && !dead) {
    const live = new Set(W.map(w => w.id)), n = rec.seen.length;
    rec.seen = rec.seen.filter(id => live.has(id)); if (rec.seen.length !== n) changed = true;
    for (const w of W) {
      if (dead || w.level < (rec.prefs.min || 1) || rec.seen.includes(w.id)) continue;
      if (quiet && w.level < 3) { rep.notes.push('Επίσημη προειδοποίηση αναβλήθηκε (ώρες ησυχίας)'); continue; }
      const lv = LVT[w.level] || LVT[1], kt = KT[w.type] || '⚠️ ' + w.name;
      const when = now >= w.onset ? 'Σε ισχύ έως ' + fmt(w.expires + 1000) : 'Ισχύει από ' + fmt(w.onset) + ' έως ' + fmt(w.expires + 1000);
      const res = await send({ title: `${lv[0]} ${kt} · ${lv[1]} προειδοποίηση`, body: `Κύπρος · ${when} (Τμήμα Μετεωρολογίας)`, tag: w.id });
      if (res < 300) { rec.seen.push(w.id); changed = true; rep.sent.push(`${lv[0]} ${kt}`); }
    }
  }
  if (rec.prefs.official && !W) rep.notes.push('Δεν διαβάστηκε το feed των επίσημων προειδοποιήσεων αυτή τη στιγμή.');
  const aheadDays = Math.min(7, Math.max(0, Math.round(rec.prefs.ahead ?? 7)));
  if (aheadDays > 0 && !dead) {
    try {
      const l = lp(now, tz), t0 = toMin(rec.prefs.mornT) ?? 450, A = await aheadFetch(rec.place, rec.prefs, aheadDays);
      const END = aheadDays * 24 + 1, ev = aheadScan(A.h, rec.prefs, l.date, aheadDays, A.dust, 12, END), old = rec.ahead || {}, cur = {}, gone = rec.aheadGone || {}, pre = rec.aheadPre || {};
      const nearEv = aheadScan(A.h, rec.prefs, l.date, aheadDays, A.dust, 0), near = new Set(nearEv.map(e => e.key)); // μαζί με τις επόμενες 12 ώρες
      const fam = k => k.replace(/^rainmm\|/, 'rain|'), famNow = new Set(ev.map(e => fam(e.key)));
      for (const e of ev) {
        if (old[e.key]) cur[e.key] = old[e.key];
        else if (pre[e.key]) { cur[e.key] = pre[e.key]; delete pre[e.key]; }                 // είχε ήδη αναφερθεί σε «μετακινήθηκε» πριν μπει στο όριο
        else if (gone[e.key]) { cur[e.key] = gone[e.key].sent; delete gone[e.key]; }          // επανεμφανίστηκε πριν σταλεί ακύρωση: συνεχίζει κανονικά
        else { const o = Object.keys(old).find(k => k !== e.key && fam(k) === fam(e.key)); cur[e.key] = e.type === 'rain' && o ? old[o] : 0; } // «έντονη» → «απλή» βροχή: όχι ως νέο
      }
      for (const k of Object.keys(old)) {
        if (cur[k] !== undefined || !old[k]) continue;                    // ακόμα στην πρόγνωση, ή δεν είχε σταλεί ποτέ
        const date = k.split('|')[1];
        if (date < l.date || near.has(k) || famNow.has(fam(k)) || date > A.h.time[Math.min(END, A.h.time.length) - 1].slice(0, 10)) continue; // ή βγήκε εκτός ορίου ημερών (π.χ. άλλαξε η ρύθμιση) // πέρασε, είναι πια στις επόμενες 12 ώρες, ή άλλαξε μόνο η ένταση
        gone[k] = gone[k] || { since: now, sent: old[k] };
      }
      for (const k of Object.keys(gone)) if (k.split('|')[1] < l.date || near.has(k)) delete gone[k];
      for (const k of Object.keys(pre)) if (!near.has(k)) delete pre[k];
      if (JSON.stringify(Object.keys(cur).sort()) !== JSON.stringify(Object.keys(old).sort()) || JSON.stringify(gone) !== JSON.stringify(rec.aheadGone || {}) || JSON.stringify(pre) !== JSON.stringify(rec.aheadPre || {})) changed = true;
      rec.ahead = cur; rec.aheadGone = gone; rec.aheadPre = pre;
      // Μετακίνηση: χάθηκε από μια μέρα και το ίδιο είδος εμφανίστηκε σε κοντινή μέρα (±3) → ένα μήνυμα «μετακινήθηκε»
      const kind = k => fam(k).split('|')[0], pair = {}, used = new Set();
      for (const g of Object.keys(gone).sort((a, b) => gone[a].since - gone[b].since)) {
        const gd = g.split('|')[1];
        const c = nearEv.filter(e => kind(e.key) === kind(g) && e.date !== gd && !used.has(e.key) && !cur[e.key] && Math.abs(dDiff(gd, e.date)) <= 3)
          .sort((x, y) => Math.abs(dDiff(gd, x.date)) - Math.abs(dDiff(gd, y.date)))[0];
        if (c) { pair[g] = c; used.add(c.key); }
      }
      const ripe = k => now - gone[k].since >= 3600e3, byDate = (a, b) => a.split('|')[1] < b.split('|')[1] ? -1 : 1;
      const moved = Object.keys(pair).filter(ripe).sort(byDate), cancel = Object.keys(gone).filter(k => !pair[k] && ripe(k)).sort(byDate);
      if (moved.length) {
        if (quiet) rep.notes.push('Μετακίνηση φαινομένου: αναβλήθηκε (ώρες ησυχίας)');
        else {
          const far = moved.some(g => pair[g].d >= 3);
          const body = rec.place.name + '\n' + moved.map(g => { const e = pair[g]; return `${e.icon} ${dayLabel(g.split('|')[1])} → ${dayLabel(e.date)} από ${e.hh} · ${e.txt(e)} (${e.d === 0 ? 'σήμερα' : e.d === 1 ? 'αύριο' : 'σε ' + e.d + ' ημέρες'})`; }).join('\n') + (far ? '\nΠρόγνωση ημερών: μπορεί να αλλάξει.' : '');
          const res = await send({ title: '🔁 Το φαινόμενο μετακινήθηκε', body, tag: 'ahead-m-' + now });
          if (res < 300) { moved.forEach(g => { const k = pair[g].key; if (cur[k] !== undefined) cur[k] = now; else pre[k] = now; delete gone[g]; }); changed = true; rep.sent.push('Μετακίνηση φαινομένου'); }
        }
      }
      if (cancel.length) {
        if (quiet) rep.notes.push('Ακύρωση έγκαιρης ειδοποίησης: αναβλήθηκε (ώρες ησυχίας)');
        else {
          const body = rec.place.name + '\n' + cancel.map(k => { const [t, d] = k.split('|'); return `${dayLabel(d)} · ${AHN[t] || t}`; }).join('\n') + '\nΔεν προβλέπεται πλέον.';
          const res = await send({ title: '✅ Ακυρώθηκε από την πρόγνωση', body, tag: 'ahead-x-' + now });
          if (res < 300) { cancel.forEach(k => delete gone[k]); changed = true; rep.sent.push('Ακύρωση έγκαιρης ειδοποίησης'); }
        }
      }
      const wait = new Set(Object.keys(pair).filter(g => gone[g]).map(g => pair[g].key)); // πιθανή μετακίνηση: περιμένουμε την επιβεβαίωση
      const evs = ev.filter(e => !wait.has(e.key)), fresh = evs.filter(e => !cur[e.key]);
      const daily = evs.length && l.min >= t0 && rec.aheadDay !== l.date;
      const soon = l.min < t0 && t0 - l.min <= 120;  // λίγο πριν την καθημερινή ώρα: περιμένουμε για να μη σταλούν δύο μαζί
      const list = daily ? evs : (!soon && fresh.length ? fresh : []);
      if (list.length) {
        if (quiet) rep.notes.push('Έγκαιρη ειδοποίηση: αναβλήθηκε (ώρες ησυχίας)');
        else {
          const far = list.some(e => e.d >= 3);
          const body = rec.place.name + '\n' + list.slice(0, 6).map(e => e.line).join('\n') + (list.length > 6 ? `\n+${list.length - 6} ακόμα` : '') + (far ? '\nΠρόγνωση ημερών: μπορεί να αλλάξει.' : '');
          const res = await send({ title: list.every(e => !cur[e.key]) ? '📅 Νέο φαινόμενο στην πρόγνωση' : '📅 Τι έρχεται τις επόμενες ημέρες', body, tag: 'ahead-' + now });
          if (res < 300) { for (const e of list) cur[e.key] = now; if (daily) rec.aheadDay = l.date; changed = true; rep.sent.push(daily ? 'Έγκαιρη ειδοποίηση (ημερήσια)' : 'Έγκαιρη ειδοποίηση (νέο)'); }
        }
      }
      rep.ahead = ev.map(e => e.line);
    } catch (e) { rep.notes.push('Έγκαιρη ειδοποίηση: ' + e.message); }
    } else if (rec.ahead || rec.aheadGone) { delete rec.ahead; delete rec.aheadGone; delete rec.aheadDay; delete rec.aheadPre; changed = true; } // απενεργοποιημένο: καθαρή αρχή αν ξανανοίξει
  if (rec.prefs.morn && hMain && !dead) { // πρωινή περίληψη: μία φορά την ημέρα, μέσα σε 2 ώρες από την ώρα που διάλεξες
    const l = lp(now, tz), t0 = toMin(rec.prefs.mornT) ?? 450;
    if (l.min >= t0 && l.min < t0 + 120 && rec.lastMorn !== l.date) {
      if (quiet) rep.notes.push('Πρωινή περίληψη: η ώρα πέφτει στις ώρες ησυχίας');
      else { const res = await send({ title: '☀️ Καλημέρα · ' + rec.place.name, body: summaryText(hMain, rec.prefs), tag: 'morn-' + now }); if (res < 300) { rec.lastMorn = l.date; changed = true; rep.sent.push('Πρωινή περίληψη'); } }
    }
  }
  if (changed && !dead) await env.SUBS.put(key, JSON.stringify(rec));
  return rep;
}

async function run(env, origin) {
  const v = await vapid(env); let W = null, sent = 0; const errors = [];
  try { W = await warnings(); } catch (e) { errors.push('feed: ' + e.message); }
  const { keys } = await env.SUBS.list({ prefix: 's:' });
  for (const k of keys) {
    try {
      const rec = JSON.parse(await env.SUBS.get(k.name) || 'null'); if (!rec) continue;
      const rep = await processSub(env, v, W, k.name, rec, origin);
      sent += rep.sent.length; if (rep.error) errors.push(rep.error);
    } catch (e) { errors.push(e.message); }
  }
  const last = { at: Date.now(), subs: keys.length, sent, errors };
  await env.SUBS.put('cfg:last', JSON.stringify(last));
  return last;
}

async function api(request, env, u, p) {
  if (p === '/api/met') { // δεύτερη γνώμη: MET Norway
    const lat = Number(u.searchParams.get('lat')), lon = Number(u.searchParams.get('lon'));
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return json({ error: 'bad place' }, 400);
    return json({ rows: (await metFetch(lat, lon, u.origin)).slice(0, 25), source: 'MET Norway' });
  }
  if (p === '/api/avwx') { // METAR/TAF Λάρνακας & Πάφου από NOAA Aviation Weather Center (χωρίς CORS, γι' αυτό μέσω server)
    const H = { headers: { 'User-Agent': `kairos-weather-pwa/1.0 (+${u.origin})` }, cf: { cacheTtl: 600, cacheEverything: true } };
    const B = 'https://aviationweather.gov/api/data/';
    const get = async q => { const r = await fetch(B + q, H); if (!r.ok) throw new Error('avwx ' + r.status); return (await r.text()).slice(0, 20000); };
    const [metar, taf] = await Promise.all([get('metar?ids=LCLK,LCPH&format=raw&hours=2'), get('taf?ids=LCLK,LCPH&format=raw')]);
    return json({ metar, taf, at: Date.now(), source: 'NOAA Aviation Weather Center' });
  }
  if (p === '/api/status') { // πότε έτρεξε τελευταία φορά ο αυτόματος έλεγχος (χωρίς προσωπικά στοιχεία)
    needKV(env); const l = JSON.parse(await env.SUBS.get('cfg:last') || 'null');
    return json({ last: l ? { at: l.at, sent: l.sent, errors: (l.errors || []).slice(0, 3) } : null, now: Date.now() });
  }
  if (p === '/api/key') return json({ key: (await vapid(env)).pub });
  if (p === '/api/setup') {
    needKV(env);
    if (await env.SUBS.get('cfg:cron')) return json({ error: 'already configured' }, 403);
    const k = b64u.enc(crypto.getRandomValues(new Uint8Array(18)));
    await env.SUBS.put('cfg:cron', k); await vapid(env);
    return json({ cron: u.origin + '/api/cron?key=' + k });
  }
  if (p === '/api/cron') {
    needKV(env);
    const k = await env.SUBS.get('cfg:cron');
    if (!k || u.searchParams.get('key') !== k) return json({ error: 'forbidden' }, 403);
    return json(await run(env, u.origin));
  }
  if (request.method !== 'POST' || !/application\/json/.test(request.headers.get('content-type') || '')) return json({ error: 'not found' }, 404);
  const b = await request.json().catch(() => ({})); needKV(env);
  if (p === '/api/subscribe') {
    const s = b.sub, pl = b.place, f = b.prefs || {};
    if (!s?.endpoint || !PUSH_HOSTS.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return json({ error: 'bad subscription' }, 400);
    const lat = Number(pl?.lat), lon = Number(pl?.lon);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return json({ error: 'bad place' }, 400);
    const key = 's:' + await sha(s.endpoint), old = JSON.parse(await env.SUBS.get(key) || 'null'), hm = (x, d) => toMin(x) != null ? x : d;
    if (!old) { // νέα συσκευή: έλεγχος ορίου
      const max = num(env.MAX_SUBS, MAX_SUBS_DEFAULT, 1, 1000), { keys } = await env.SUBS.list({ prefix: 's:' });
      if (keys.length >= max) return json({ error: 'limit', max }, 403);
    }
    const prefs = { official: !!f.official, min: num(f.min, 1, 1, 3), storm: !!f.storm, rain: !!f.rain, rainMm: f.rainMm !== false, rainProb: f.rainProb !== false, rainP: num(f.rainP, 50, 1, 100), rainT: num(f.rainT, 7.6, 0.1, 100),
      wind: !!f.wind, gust: num(f.gust, 60, 1, 250), hot: !!f.hot, hotT: num(f.hotT, 38, -30, 60), frost: !!f.frost, coldT: num(f.coldT, 0, -50, 50), snow: !!f.snow, dust: !!f.dust, dustT: num(f.dustT, 50, 1, 2000),
      morn: !!f.morn, mornT: hm(f.mornT, '07:30'), quiet: !!f.quiet, qFrom: hm(f.qFrom, '23:00'), qTo: hm(f.qTo, '07:00'), favAlerts: !!f.favAlerts, ahead: Math.round(num(f.ahead, 7, 0, 7)) };
    const extra = (Array.isArray(b.extra) ? b.extra : []).slice(0, 5).map(x => ({ lat: Number(x.lat), lon: Number(x.lon), name: String(x.name || '').slice(0, 60) })).filter(x => Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180);
    await env.SUBS.put(key, JSON.stringify({ sub: { endpoint: s.endpoint, keys: s.keys }, place: { lat, lon, name: String(pl.name || '').slice(0, 60), tz: okTz(String(pl.tz || '')) ? String(pl.tz) : TZ0 }, extra, prefs,
      sent: old?.sent || {}, gone: old?.gone || {}, seen: old?.seen || [], xs: old?.xs || {}, hist: old?.hist || [], lastMorn: old?.lastMorn,
      // έγκαιρες ειδοποιήσεις: κρατάμε τι έχει σταλεί, εκτός αν άλλαξε η κύρια τοποθεσία
      ...(old && Math.abs(old.place.lat - lat) < 0.02 && Math.abs(old.place.lon - lon) < 0.02 ? { ahead: old.ahead || {}, aheadDay: old.aheadDay, aheadGone: old.aheadGone || {}, aheadPre: old.aheadPre || {} } : {}) }));
    return json({ ok: true });
  }
  if (p === '/api/unsubscribe' && b.endpoint) { await env.SUBS.delete('s:' + await sha(b.endpoint)); return json({ ok: true }); }
  if (p === '/api/test' && b.endpoint) {
    const rec = JSON.parse(await env.SUBS.get('s:' + await sha(b.endpoint)) || 'null');
    if (!rec) return json({ error: 'subscription not found' }, 404);
    const st = await push(await vapid(env), rec.sub, { title: '✅ Δοκιμή', body: 'Οι ειδοποιήσεις καιρού λειτουργούν.', tag: 'test-' + Date.now() }, u.origin);
    return json({ status: st }, st < 300 ? 200 : 502);
  }
  if (p === '/api/check' && b.endpoint) {
    const key = 's:' + await sha(b.endpoint), rec = JSON.parse(await env.SUBS.get(key) || 'null');
    if (!rec) return json({ error: 'subscription not found' }, 404);
    let W = null; try { W = await warnings(); } catch (e) { /* αναφέρεται στις σημειώσεις */ }
    const report = await processSub(env, await vapid(env), W, key, rec, u.origin);
    return json({ report, last: JSON.parse(await env.SUBS.get('cfg:last') || 'null') });
  }
  if ((p === '/api/history' || p === '/api/diag') && b.endpoint) {
    const rec = JSON.parse(await env.SUBS.get('s:' + await sha(b.endpoint)) || 'null');
    if (!rec) return json({ error: 'subscription not found' }, 404);
    if (p === '/api/history') return json({ hist: rec.hist || [] });
    return json({ last: JSON.parse(await env.SUBS.get('cfg:last') || 'null'), prefs: rec.prefs, extra: (rec.extra || []).length, sentKeys: Object.keys(rec.sent || {}), seen: (rec.seen || []).length, hist: (rec.hist || []).length, tz: rec.place.tz, lastMorn: rec.lastMorn || null });
  }
  return json({ error: 'not found' }, 404);
}

async function handle(request, env) {
  const u = new URL(request.url), p = u.pathname;
  if (p === '/api/warnings') {
    if (foreign(request, u)) return json({ error: 'forbidden' }, 403);
    try { return json({ warnings: await warnings(), updated: Date.now() }); }
    catch (e) { return json({ error: 'feed unavailable' }, 502); }
  }
  if (p.startsWith('/api/')) {
    if (p !== '/api/cron' && foreign(request, u)) return json({ error: 'forbidden' }, 403);
    try { return await api(request, env, u, p); }
    catch (e) { return json({ error: e.message === 'KV' ? 'KV' : 'server' }, 500); }
  }
  return env.ASSETS.fetch(request);
}

export default { async fetch(request, env) { return secure(await handle(request, env)); } };

// RFC 8291 (aes128gcm)
async function encrypt(sub, data) {
  const ua = b64u.dec(sub.keys.p256dh), auth = b64u.dec(sub.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  const hkdf = async (s, ikm, info, len) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));
  const prk = await hkdf(auth, secret, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(data, new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0, 65]), asPub, ct);
}
