/* ═══════════════════════════════════════════════
   PandaAI 🐼 — Service Worker
   Strategy: pre-cache everything on first install.
   Tokyo: pay the download cost once, then offline forever.
   Only network calls during a session: Groq API + GitHub API.
═══════════════════════════════════════════════ */

const VERSION = 'pandaai-v5';

// All app shell files to pre-cache on install
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './charmap.json',
  './modules/crypto.js',
  './modules/github-sync.js',
  './modules/file-store.js',
  './modules/renderer.js',
  './modules/ai-router.js',
  './modules/analysis.js',
  './modules/loaders/loader-dxf.js',
  './modules/loaders/loader-ifc.js',
  './modules/loaders/loader-step.js',
  './modules/loaders/loader-dwg.js',
  './modules/loaders/loader-3dm.js',
  './modules/loaders/loader-cloud.js',
  './modules/loaders/loader-geo.js',
  './modules/loaders/loader-gcode.js',
  './modules/loaders/loader-vox.js',
];

// CDN libraries — pre-cached after install
const CDN_LIBS = [
  // Three.js core
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js',
  // Three.js loaders (ES module versions via CDN)
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/STLLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/OBJLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/MTLLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/FBXLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/ColladaLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/PLYLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/PCDLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/TDSLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/VRMLLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/VTKLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/3MFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/AMFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/USDZLoader.js',
  // LWOLoader removed from Three.js r157 — skip
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/FirstPersonControls.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/PointerLockControls.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/helpers/VertexNormalsHelper.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js',
  // DXF parser (fetched on demand, not pre-cached — CDN version varies)
  // 'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/src/DxfParser.js',
  // web-ifc (BIM/IFC)
  'https://cdn.jsdelivr.net/npm/web-ifc@0.0.51/web-ifc-api.js',
  'https://cdn.jsdelivr.net/npm/web-ifc-three@0.0.126/IFCLoader.js',
  // Rhino 3DM
  'https://cdn.jsdelivr.net/npm/rhino3dm@8.0.1/rhino3dm.module.min.js',
  // Point cloud libs fetched on demand
];

// ── Install: pre-cache all app files ──────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(async cache => {
      // Cache local files first (must succeed)
      for (const url of PRECACHE) {
        try {
          await cache.add(url);
        } catch(e) {
          console.warn('[SW] Could not pre-cache:', url, e.message);
        }
      }
      // Cache CDN libs (best-effort — some may not exist yet)
      for (const url of CDN_LIBS) {
        try {
          await cache.add(new Request(url, { mode: 'cors' }));
        } catch(e) {
          console.warn('[SW] CDN cache miss (will retry on demand):', url);
        }
      }
      return self.skipWaiting();
    })
  );
});

// ── Activate: delete old caches ───────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first, network-fallback ─────
// Exception: Groq API and GitHub API always go to network
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Always pass through to network: API calls
  if (
    url.includes('api.groq.com') ||
    url.includes('api.github.com') ||
    url.includes('github.com/login')
  ) {
    return; // default fetch — no interception
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      // Not in cache — fetch from network and cache for next time
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }
        const clone = response.clone();
        caches.open(VERSION).then(cache => {
          // Only cache GET requests
          if (event.request.method === 'GET') cache.put(event.request, clone);
        });
        return response;
      }).catch(() => {
        // Fully offline and not cached — return offline page if it's a nav
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// ── Message: manual cache clear from app ─────
self.addEventListener('message', event => {
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(VERSION).then(() => {
      event.ports[0] && event.ports[0].postMessage('cleared');
    });
  }
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
