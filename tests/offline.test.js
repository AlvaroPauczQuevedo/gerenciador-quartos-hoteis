// Modo offline do técnico (public/js/offline.js + api() de estado.js), com um IndexedDB de mentira em memória.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function bancoFalso() {
  const lojas = {}; const contadores = {}; const chaves = {};
  const loja = (nome) => (lojas[nome] ||= new Map());
  return {
    open() {
      const req = {};
      setTimeout(() => {
        const bd = {
          createObjectStore(nome, { keyPath, autoIncrement }) { chaves[nome] = { keyPath, autoIncrement }; loja(nome); },
          transaction(nome) {
            const t = {}; const m = loja(nome);
            const r = (v) => ({ result: v });
            t.objectStore = () => ({
              get: (k) => r(m.get(k)),
              getAll: () => r([...m.values()]),
              put: (v) => { m.set(v[chaves[nome].keyPath], v); return r(); },
              add: (v) => { const id = (contadores[nome] = (contadores[nome] || 0) + 1); v[chaves[nome].keyPath] = id; m.set(id, v); return r(id); },
              delete: (k) => { m.delete(k); return r(); },
              clear: () => { m.clear(); return r(); },
            });
            setTimeout(() => t.oncomplete?.(), 0);
            return t;
          },
        };
        req.result = bd;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      }, 0);
      return req;
    },
  };
}

const memoria = new Map();
globalThis.indexedDB = bancoFalso();
globalThis.window = new EventTarget();
globalThis.localStorage = { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, String(v)), removeItem: (k) => memoria.delete(k) };
const eventos = [];
window.addEventListener('fila-mudou', () => eventos.push('mudou'));
window.addEventListener('fila-sincronizada', () => eventos.push('sincronizada'));

const off = await import('../public/js/offline.js');
const { api, estado } = await import('../public/js/estado.js');

const tec = { id: 7, nome: 'Tiago Técnico', papel: 'tecnico' };
const detalheOs = () => ({
  id: 41, protocolo: 'OS-2026-00041', status: 'aprovada', responsavel_id: null, tarefas: [{ id: 3, tecnico_id: 7, concluida: 0 }], eventos: [],
  acoes: [{ chave: 'assumir', rotulo: 'Assumir demanda', interna: false }, { chave: 'comentar', rotulo: 'Comentar', interna: true }],
});

test('cache de leitura fica separado por usuário e /api/eu só volta para técnico', async () => {
  await off.guardarCache('/api/os/41', detalheOs(), 7);
  assert.ok(await off.lerCache('/api/os/41', 7));
  assert.equal(await off.lerCache('/api/os/41', 8), null, 'outro usuário no mesmo aparelho não vê');
  await off.guardarCache('/api/eu', { usuario: { id: 9, papel: 'gerente' } });
  assert.equal(await off.lerCache('/api/eu'), null);
  await off.guardarCache('/api/eu', { usuario: tec });
  assert.equal((await off.lerCache('/api/eu')).dados.usuario.id, 7);
  assert.deepEqual([off.cacheavel('/api/os?x=1'), off.cacheavel('/api/os/41'), off.cacheavel('/api/usuarios'), off.cacheavel('/api/auditoria')], [true, true, false, false]);
  assert.deepEqual([off.ehAcaoOffline('/api/os/41/acoes/concluir'), off.ehAcaoOffline('/api/fotos'), off.ehAcaoOffline('/api/os/41/acoes/validar'), off.ehAcaoOffline('/api/os/41/acoes/autorizar')], [true, true, false, false]);
});

test('ação sem internet: entra na fila, ficha local avança (iniciar → concluir) e ordem é mantida', async () => {
  const a = await off.guardarAcao('/api/os/41/acoes/iniciar', { texto: 'Cheguei', _idem: 'chave-0001' }, tec);
  assert.deepEqual(a, { ok: true, enfileirado: true });
  let os = (await off.lerCache('/api/os/41', 7)).dados;
  assert.deepEqual([os.status, os.responsavel_id, os.responsavel_nome], ['em_execucao', 7, 'Tiago Técnico']);
  const chaves = os.acoes.map((x) => x.chave);
  assert.ok(chaves.includes('concluir') && chaves.includes('aguardar_materiais') && chaves.includes('comentar') && chaves.includes('concluir_tarefa'));
  assert.ok(!chaves.includes('iniciar'), 'iniciar já foi feito');
  assert.equal(os.acoes.find((x) => x.chave === 'comentar').interna, true, 'mantém o que é interno');
  assert.match(os.eventos.at(-1).texto, /sem conexão.*Iniciar execução: Cheguei/);

  await off.guardarAcao('/api/os/41/acoes/concluir', { texto: 'Trocado', fotos: [{ arquivo: 'data:image/png;base64,AA==' }], _idem: 'chave-0002' }, tec);
  await off.guardarAcao('/api/os/41/acoes/concluir_tarefa', { tarefa_id: 3, _idem: 'chave-0003' }, tec);
  os = (await off.lerCache('/api/os/41', 7)).dados;
  assert.equal(os.status, 'concluida');
  assert.equal(os.tarefas[0].concluida, 1);
  assert.ok(!os.acoes.some((x) => x.chave === 'concluir'));

  const fila = await off.listarFila();
  assert.deepEqual(fila.map((i) => [i.acao, i.os_id, i.fotos]), [['iniciar', 41, 0], ['concluir', 41, 1], ['concluir_tarefa', 41, 0]]);
  assert.ok(fila[0].id < fila[1].id && fila[1].id < fila[2].id);
});

test('sincronizar: envia em ordem, para na falha de rede, marca a recusa do servidor e segue', async () => {
  const respostas = [];
  const enviados = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opcoes) => {
    const r = respostas.shift();
    if (r === 'rede') throw new TypeError('Failed to fetch');
    enviados.push([url, JSON.parse(opcoes.body)._idem]);
    return { ok: r.status < 400, status: r.status, json: async () => r.corpo || {} };
  };
  try {
    respostas.push('rede');
    assert.equal(await off.sincronizar(7), 0);
    assert.equal((await off.listarFila()).length, 3, 'sem rede nada se perde');
    assert.equal(off.estaSemRede(), true);

    respostas.push({ status: 200 }, { status: 409, corpo: { erro: 'Ação não permitida no status atual.' } }, { status: 200 });
    eventos.length = 0;
    assert.equal(await off.sincronizar(7), 2);
    assert.deepEqual(enviados.map((e) => e[1]), ['chave-0001', 'chave-0002', 'chave-0003'], 'mesma chave que seguiu na 1ª tentativa');
    const resto = await off.listarFila();
    assert.deepEqual(resto.map((i) => [i.acao, i.erro]), [['concluir', 'Ação não permitida no status atual.']]);
    assert.ok(eventos.includes('sincronizada'));
    assert.equal(off.estaSemRede(), false, 'respondeu: voltou a ter rede');

    // item recusado não é reenviado sozinho; "tentar de novo" libera
    respostas.length = 0; enviados.length = 0;
    assert.equal(await off.sincronizar(7), 0);
    assert.equal(enviados.length, 0);
    await off.reabrirItem(resto[0].id);
    respostas.push({ status: 503 });
    assert.equal(await off.sincronizar(7), 0, '5xx: mantém na fila para tentar depois');
    assert.equal((await off.listarFila()).length, 1);
    respostas.push({ status: 401 });
    assert.equal(await off.sincronizar(7), 0, 'sessão expirada: mantém');
    assert.equal((await off.listarFila())[0].erro, null);

    // fila de outro usuário não é enviada com a sessão de quem entrou depois
    assert.equal(await off.sincronizar(99), 0);
    assert.match((await off.listarFila())[0].erro, /outro usuário/);
    await off.removerDaFila((await off.listarFila())[0].id);
    assert.equal((await off.listarFila()).length, 0);
  } finally { globalThis.fetch = original; }
});

test('api(): técnico sem internet lê do cache e guarda ações; ação fora da lista falha; outros perfis não usam o offline', async () => {
  off.definirModoTecnico(true);
  estado.usuario = tec;
  await off.guardarCache('/api/os/41', detalheOs(), 7);
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    const os = await api('/api/os/41');
    assert.equal(os.id, 41);
    assert.ok(os._cache_em, 'marca que veio do aparelho');
    const r = await api('/api/os/41/acoes/iniciar', { metodo: 'POST', corpo: { texto: 'x' } });
    assert.equal(r.enfileirado, true);
    const [item] = await off.listarFila();
    assert.match(item.corpo._idem, /^[\w.-]{8,64}$/, 'a chave de idempotência é criada antes da 1ª tentativa');
    await assert.rejects(() => api('/api/os/41/acoes/validar', { metodo: 'POST', corpo: {} }), (e) => e.status === 0);
    await assert.rejects(() => api('/api/usuarios'), (e) => e.status === 0, 'leitura que não é guardada falha com mensagem clara');

    off.definirModoTecnico(false);
    estado.usuario = { id: 1, papel: 'gerente' };
    await assert.rejects(() => api('/api/os/41/acoes/iniciar', { metodo: 'POST', corpo: {} }), (e) => e.status === 0);
    assert.equal((await off.listarFila()).length, 1, 'gerente não enfileira');
  } finally { globalThis.fetch = original; }
  await off.limparTudo();
  assert.deepEqual([(await off.listarFila()).length, await off.lerCache('/api/os/41', 7), off.modoTecnico()], [0, null, false], 'sair apaga os dados do aparelho');
});
