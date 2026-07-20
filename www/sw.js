const CACHE = 'cargo-panic-v1';
const FILES = ['./','index.html','style.css','game.js','manifest.webmanifest','assets/warehouse-bg.png','assets/worker-sheet.png','assets/crates-sheet.png','assets/icon-192.png','assets/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
