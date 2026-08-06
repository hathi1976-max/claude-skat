// Versionsnummer kommt aus version.js – der einzigen Stelle, an der sie steht.
importScripts('./version.js');
const CACHE = 'skat-' + self.APP_VERSION;
// Neue Module hier eintragen – sonst fehlt offline genau die eine Datei und
// die App startet nicht.
const ASSETS = [
  './', './index.html', './style.css', './app.js', './version.js',
  './js/regeln.js', './js/zustand.js', './js/takt.js', './js/ki.js',
  './js/wertung.js', './js/anzeige.js', './js/ablauf.js',
  './manifest.webmanifest', './icons/icon.svg'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
// Network-first: online immer aktuell, offline aus dem Cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
  );
});
