// Service worker de VillaLluvia: permite abrir la app sin internet y recibir avisos.
const VERSION = "villalluvia-v1";
const ARCHIVOS = [
  "./",
  "index.html",
  "css/estilos.css",
  "js/app.js",
  "js/motor.js",
  "js/iconos.js",
  "js/avisos.js",
  "js/config.js",
  "datos/lugares.json",
  "datos/calibracion.json",
  "manifest.webmanifest",
  "iconos/icono-192.png",
  "iconos/icono-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Archivos de la app: primero internet (para tener siempre la última versión), si no hay, la copia.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r ?? caches.match("index.html")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data?.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.titulo ?? "VillaLluvia Norte", {
      body: d.cuerpo ?? "",
      icon: "iconos/icono-192.png",
      badge: "iconos/insignia-96.png",
      tag: d.etiqueta ?? "villalluvia",
      renotify: true,
      silent: Boolean(d.silencioso),
      data: { url: d.url ?? "./" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) if ("focus" in v) return v.focus();
      return self.clients.openWindow(e.notification.data?.url ?? "./");
    })
  );
});
