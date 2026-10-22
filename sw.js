const CACHE_NAME = "inspecciones-seguridad-v2";

const ARCHIVOS = [
    "./",
    "./index.html",
    "./manifest.json",
    "./tecchnex-banner-compacto.jpg"
];

self.addEventListener("install", event => {

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ARCHIVOS))
    );

});

self.addEventListener("fetch", event => {

    event.respondWith(
        caches.match(event.request)
            .then(respuesta => {

                return respuesta || fetch(event.request);

            })
    );

});
