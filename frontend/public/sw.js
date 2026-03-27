self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/upload') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData();
        const file = formData.get('pdf');

        if (file && file instanceof File) {
          const cache = await caches.open('share-target-v1');
          await cache.put('/shared-file', new Response(file, {
            headers: { 'Content-Type': file.type, 'X-File-Name': file.name },
          }));
        }

        return Response.redirect('/upload?shared=1', 303);
      })()
    );
    return;
  }

  event.respondWith(fetch(event.request));
});
