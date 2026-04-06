// ── DIT SERVICES — SERVICE WORKER ──────────────────────────
// Versão do cache — incremente para forçar atualização
const CACHE_NAME = 'dit-v1';

// Arquivos que ficam disponíveis offline
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/Logo_DIT.png',
  '/Logo_DIT_B.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// ── INSTALL: cacheia os assets na primeira instalação ──────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── ACTIVATE: limpa caches antigos ────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: responde com cache quando offline ───────────────
self.addEventListener('fetch', event => {
  // Não interceptar requisições ao Google Script (POST de dados)
  if (event.request.url.includes('script.google.com')) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ── BACKGROUND SYNC: dispara quando a internet volta ──────
self.addEventListener('sync', event => {
  if (event.tag === 'dit-sync-fila') {
    event.waitUntil(processarFila());
  }
});

// ── Processa todos os itens salvos na fila offline ─────────
async function processarFila() {
  const db = await abrirDB();
  const itens = await lerTodosDB(db);

  for (const { key, dados } of itens) {
    try {
      const r = await fetch(dados.SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify(dados.payload)
      });
      const d = await r.json();
      if (d.status === 'ok') {
        await deletarDB(db, key);
        // Notifica a aba aberta que o item foi enviado
        const clients = await self.clients.matchAll();
        clients.forEach(c => c.postMessage({
          tipo: 'sync-ok',
          id: key,
          tipoChecklist: dados.payload.tipo
        }));
      }
    } catch (err) {
      // Mantém na fila para tentar novamente
      console.warn('Falha ao reenviar item da fila:', key, err);
    }
  }
}

// ── Helpers IndexedDB ──────────────────────────────────────
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dit-offline', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('fila', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

function lerTodosDB(db) {
  return new Promise((resolve, reject) => {
    const store = db.transaction('fila', 'readonly').objectStore('fila');
    const req = store.getAll();
    req.onsuccess = e => resolve(
      e.target.result.map(item => ({ key: item.id, dados: item.dados }))
    );
    req.onerror = e => reject(e.target.error);
  });
}

function deletarDB(db, key) {
  return new Promise((resolve, reject) => {
    const store = db.transaction('fila', 'readwrite').objectStore('fila');
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}
