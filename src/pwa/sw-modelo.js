// Service worker do app instalável. O servidor preenche a versão e a lista de arquivos ao servir este arquivo:
// a cada deploy que muda o frontend, a versão muda e os celulares recebem a atualização.
const VERSAO = '__VERSAO__';
const CASCA = __ARQUIVOS__;
const CACHE = `manutencao-${VERSAO}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)));
  // Não ativa sozinho: a página mostra "Nova versão disponível" e o usuário confirma (evita trocar no meio de um cadastro).
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nome of await caches.keys()) if (nome !== CACHE) await caches.delete(nome);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.tipo === 'atualizar') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Dados (API, fotos) sempre da rede: nada de informação desatualizada.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/') || url.pathname === '/healthz') return;
  // Abertura do app: rede primeiro; sem conexão, a casca guardada.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  // Arquivos do app (versionados): cache primeiro, completando o cache com o que faltar (ex.: logos dos hotéis).
  e.respondWith((async () => {
    const guardado = await caches.match(e.request);
    if (guardado) return guardado;
    const resp = await fetch(e.request);
    if (resp.ok && /^\/(img|css|js)\//.test(url.pathname)) (await caches.open(CACHE)).put(e.request, resp.clone());
    return resp;
  })());
});

self.addEventListener('push', (e) => {
  let dados = {};
  try { dados = e.data ? e.data.json() : {}; } catch { dados = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(dados.title || 'Manutenção Tri Hotéis', {
    body: dados.body || '',
    icon: '/img/app/icone-192.png',
    badge: '/img/app/badge-96.png',
    tag: dados.tag,
    renotify: !!dados.tag,
    requireInteraction: !!dados.emergencial,
    vibrate: dados.emergencial ? [300, 120, 300, 120, 300] : [150],
    data: { url: dados.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aberta = janelas.find((c) => new URL(c.url).origin === self.location.origin);
    if (aberta) {
      await aberta.focus();
      return aberta.navigate ? aberta.navigate(destino) : aberta.postMessage({ tipo: 'abrir', url: destino });
    }
    return self.clients.openWindow(destino);
  })());
});
