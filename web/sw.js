/* sw.js — Supervisor Lube: o app abre mesmo sem internet.
 *
 * Guarda a "casca" (tela, estilo, código, fontes, ícones). A página e o código vêm
 * primeiro da rede (versão nova assim que publicada) e caem na cópia só sem conexão.
 * Os DADOS não passam por aqui: o app guarda o pacote no IndexedDB e a /api nunca é
 * guardada pelo service worker (é por pessoa, com login).
 */
const CASCA = 'sup-lube-casca-v6';   // v6: versão 1.6 (2026-10-29, faturado e margem do Central Comercial)
const ARQUIVOS = [
  './', 'index.html', 'css/app.css', 'fonts/fonts.css', 'js/config.js', 'js/acesso.js', 'js/app.js',
  'logo-lube.png', 'logo-lube-mini.png', 'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png',
  'fonts/Archivo-700.woff2', 'fonts/Archivo-800.woff2', 'fonts/IBMPlexSans-500.woff2', 'fonts/IBMPlexSans-600.woff2',
  'fonts/IBMPlexSans-700.woff2', 'fonts/JetBrainsMono-600.woff2', 'fonts/JetBrainsMono-700.woff2', 'fonts/JetBrainsMono-800.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CASCA).then(c => c.addAll(ARQUIVOS)).catch(() => null).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sup-lube-casca') && k !== CASCA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/.sentinela')) return;
  // rede primeiro (versão nova), cópia só sem conexão
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && r.type === 'basic') { const copia = r.clone(); caches.open(CASCA).then(c => c.put(e.request, copia)).catch(() => null); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
