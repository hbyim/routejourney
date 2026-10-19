/* 오프라인에서도 앱 화면이 열리도록 정적 파일만 캐시한다. 서버 API와 지도 타일은 캐시하지 않는다. */
const VERSION = 'routelog-v14';
const SHELL = [
  './', 'index.html', 'css/style.css', 'css/theme.css', 'js/config.js', 'js/legal.js', 'js/seed.js', 'js/cloud.js', 'js/app.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'assets/icon.svg', 'manifest.webmanifest'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 네트워크 우선, 실패하면 캐시. no-cache로 브라우저 HTTP 캐시(GitHub Pages 10분)도 건너뛰고 서버에 확인해 배포 직후 새 버전이 보이도록 한다.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
