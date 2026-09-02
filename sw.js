/* TODERO — Service Worker
 * Estrategia:
 *   - El HTML (la app) SIEMPRE se pide primero a la red, con caché como red de seguridad.
 *     Así cualquier cambio nuevo se ve de inmediato, y sin señal la app igual abre.
 *   - Los archivos estáticos (iconos, fuentes) salen del caché al instante y se
 *     actualizan por detrás.
 *   - Las llamadas a Firebase NUNCA se cachean: los casos deben ser siempre los de verdad.
 *
 * IMPORTANTE: al publicar un cambio, sube el número de VERSION.
 * Eso borra el caché viejo y obliga a la app a refrescarse en todos los celulares.
 */

const VERSION = 9;
const CACHE = 'todero-v' + VERSION;
const TIEMPO_MAX_RED = 4000; // ms que esperamos a la red antes de usar el caché

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icono-192.png',
  './icono-512.png'
];

// ---------- INSTALACIÓN ----------
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => {
      // Uno por uno: si un archivo falla, no tumba toda la instalación.
      return Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ---------- ACTIVACIÓN ----------
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nombres) =>
        Promise.all(
          nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Permite que la página pida activar una versión nueva de inmediato.
self.addEventListener('message', (e) => {
  if (e.data === 'ACTUALIZAR_YA') self.skipWaiting();
});

// ---------- HELPERS ----------
function esFirebase(url) {
  return url.hostname.indexOf('firebaseio.com') !== -1;
}

function esNavegacion(req) {
  if (req.mode === 'navigate') return true;
  if ((req.headers.get('accept') || '').indexOf('text/html') !== -1) return true;
  // El HTML de la app siempre va por red primero, se pida como se pida.
  var ruta = new URL(req.url).pathname;
  return ruta.charAt(ruta.length - 1) === '/' || ruta.slice(-5) === '.html';
}

// Red primero, con tope de tiempo y caída al caché.
function redPrimero(req) {
  return new Promise((resolve) => {
    let resuelto = false;

    const usarCache = () => {
      if (resuelto) return;
      resuelto = true;
      caches.match(req).then((hit) => {
        resolve(hit || caches.match('./index.html').then((idx) =>
          idx || new Response(
            '<h1 style="font-family:sans-serif;padding:24px">Sin conexión</h1>' +
            '<p style="font-family:sans-serif;padding:0 24px">Revisa tus datos o el wifi y vuelve a abrir TODERO.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        ));
      });
    };

    const reloj = setTimeout(usarCache, TIEMPO_MAX_RED);

    fetch(req).then((resp) => {
      clearTimeout(reloj);
      if (resuelto) return;
      resuelto = true;
      // Guardamos copia fresca para la próxima vez que no haya señal.
      if (resp && resp.status === 200) {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
      }
      resolve(resp);
    }).catch(() => {
      clearTimeout(reloj);
      usarCache();
    });
  });
}

// Caché primero, y refresca por detrás para la próxima.
function cachePrimero(req) {
  return caches.match(req).then((hit) => {
    const enRed = fetch(req).then((resp) => {
      if (resp && resp.status === 200) {
        const copia = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
      }
      return resp;
    }).catch(() => hit);
    return hit || enRed;
  });
}

// ---------- INTERCEPCIÓN ----------
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Solo lecturas simples. Guardar/actualizar casos pasa directo a la red.
  if (req.method !== 'GET') return;

  // Firebase siempre en vivo, jamás desde caché.
  if (esFirebase(url)) return;

  if (esNavegacion(req)) {
    e.respondWith(redPrimero(req));
    return;
  }

  e.respondWith(cachePrimero(req));
});
