const CACHE = 'kairos-v45';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html')))
  );
});
// ---- Θυρίδα ειδοποιήσεων (IndexedDB): κάθε ειδοποίηση φυλάγεται, για να φαίνεται ξανά μέσα στην εφαρμογή ----
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('kairos', 1); r.onupgradeneeded = () => { r.result.createObjectStore('inbox', { keyPath: 'id' }); r.result.createObjectStore('meta'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = (db, st, mode, f) => new Promise((res, rej) => { const t = db.transaction(st, mode); const out = f(t.objectStore(st)); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); });
async function keep(n) {
  const db = await idb();
  await tx(db, 'inbox', 'readwrite', s => s.put(n));
  const all = (await tx(db, 'inbox', 'readonly', s => s.getAll())) || [];
  all.sort((a, b) => b.t - a.t).slice(100).forEach(x => tx(db, 'inbox', 'readwrite', s => s.delete(x.id)));
  return all.filter(x => !x.read).length;
}
self.addEventListener('push', e => {
  let d = { title: 'Καιρός', body: 'Νέα ειδοποίηση καιρού' };
  try { if (e.data) d = e.data.json(); } catch (_) {}
  const n = { id: d.id || String(Date.now()) + Math.random().toString(36).slice(2, 6), t: d.t || Date.now(), title: d.title, body: d.body, read: false };
  e.waitUntil((async () => {
    let unread = 0; try { unread = await keep(n); } catch (_) {}
    try { if (unread && self.navigator.setAppBadge) await self.navigator.setAppBadge(unread); } catch (_) {}
    const l = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    l.forEach(c => c.postMessage({ type: 'notif-new' }));
    await self.registration.showNotification(d.title, { body: d.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag, data: { id: n.id } });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = (e.notification.data && e.notification.data.id) || '';
  e.waitUntil((async () => {
    try { const db = await idb(); await tx(db, 'meta', 'readwrite', s => s.put(id, 'open')); } catch (_) {}  // για σιγουριά, αν χαθεί το μήνυμα
    const l = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (l.length) { const c = l[0]; try { await c.focus(); } catch (_) {} c.postMessage({ type: 'notif-open', id }); return; }
    await clients.openWindow('./?n=' + encodeURIComponent(id));
  })());
});
