const CACHE = 'money-mastery-shell-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const req=event.request, url=new URL(req.url);
  // Never cache financial API responses. Cache only this app's same-origin shell.
  if(req.method!=='GET'||url.origin!==self.location.origin||(!req.headers.get('accept')?.includes('text/html')&&!/\.(css|js|png|svg|ico)$/.test(url.pathname))) return;
  event.respondWith(fetch(req).then(response=>{
    if(response.ok) event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,response.clone())));
    return response;
  }).catch(async()=> (await caches.match(req)) || Response.error()));
});
