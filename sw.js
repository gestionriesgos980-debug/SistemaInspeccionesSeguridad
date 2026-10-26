/* CAM-CACHE-01 — actualización automática controlada.
   No elimina localStorage ni IndexedDB; solo administra Cache Storage. */
const CACHE_NAME = "inspecciones-seguridad-v3-cache-auto";
const ARCHIVOS_BASE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./tecchnex-banner-compacto.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // La instalación no falla si un recurso opcional no está disponible.
    await Promise.all(ARCHIVOS_BASE.map(async ruta => {
      try {
        const respuesta = await fetch(ruta, { cache: "reload" });
        if (respuesta.ok) await cache.put(ruta, respuesta);
      } catch (error) {
        // Se recuperará por red cuando el recurso esté disponible.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter(nombre => nombre.startsWith("inspecciones-seguridad-") && nombre !== CACHE_NAME)
      .map(nombre => caches.delete(nombre)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const solicitud = event.request;
  const url = new URL(solicitud.url);
  if (solicitud.method !== "GET" || url.origin !== self.location.origin) return;

  // HTML/navegación: red primero para evitar servir una versión antigua.
  if (solicitud.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const respuesta = await fetch(solicitud, { cache: "no-store" });
        if (respuesta && respuesta.ok) await cache.put(solicitud, respuesta.clone());
        return respuesta;
      } catch (error) {
        return (await cache.match(solicitud)) || (await cache.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // Recursos estáticos: caché primero, con actualización en segundo plano.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const guardada = await cache.match(solicitud);
    const actualizacion = fetch(solicitud).then(async respuesta => {
      if (respuesta && respuesta.ok) await cache.put(solicitud, respuesta.clone());
      return respuesta;
    }).catch(() => null);
    if (guardada) {
      event.waitUntil(actualizacion);
      return guardada;
    }
    return (await actualizacion) || Response.error();
  })());
});
