// Service Worker：本地资源预缓存 + 同源资源运行时缓存；GitHub / Google API 一律走网络
const VERSION = 'crm-v15';
const CORE = [
  './', 'index.html', 'manifest.json',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/sync.js', 'js/drive.js', 'js/calendar.js', 'js/clients.js', 'js/settings.js', 'js/google.js', 'js/library.js', 'js/share.js', 'js/crypto.js', 'js/lock.js', 'css/tailwind.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const NETWORK_ONLY = ['api.github.com', 'googleapis.com', 'accounts.google.com', 'www.google.com', 'gstatic.com'];

self.addEventListener('install', (e) => {
  // cache:'reload'：安装时绕过浏览器 HTTP 缓存，避免把新旧文件混在一起缓存
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (NETWORK_ONLY.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // 页面导航：网络优先，离线回退到缓存的 index.html
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  // 其余（本地脚本、样式、本地拼音库）：先读缓存，同时后台更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
