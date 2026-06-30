const CACHE='budget-master-v9';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE?caches.delete(k):null))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.url.includes('/api/')) return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});
