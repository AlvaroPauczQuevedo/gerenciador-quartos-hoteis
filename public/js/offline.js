// Modo offline do profissional de manutenção: dados guardados no aparelho (IndexedDB) e uma fila de
// ações que é enviada quando a internet volta. Cada ação leva uma chave única (_idem): se a resposta se
// perder no meio do caminho, o reenvio não duplica nada, pois o servidor reconhece a chave.
const NOME_DB = 'manutencao-offline';
const MODO = 'modo-tecnico';

export const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

let conexao = null;
function abrir() {
  conexao ||= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Armazenamento indisponível.'));
    const r = indexedDB.open(NOME_DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('fila', { keyPath: 'id', autoIncrement: true });
      r.result.createObjectStore('cache', { keyPath: 'url' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return conexao;
}

async function operar(loja, modo, fn) {
  const bd = await abrir();
  return new Promise((resolve, reject) => {
    const t = bd.transaction(loja, modo);
    let resultado;
    try { resultado = fn(t.objectStore(loja)); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(resultado?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ---- modo (só o perfil técnico usa o offline) ----
export const modoTecnico = () => { try { return localStorage.getItem(MODO) === '1'; } catch { return false; } };
export function definirModoTecnico(ativo) {
  try { ativo ? localStorage.setItem(MODO, '1') : localStorage.removeItem(MODO); } catch { /* sem armazenamento local */ }
  if (ativo) navigator.storage?.persist?.().catch(() => {});
}

// ---- estado da rede ----
let semRede = false;
export const estaSemRede = () => semRede || navigator.onLine === false;
export function marcarRede(ok) { if (semRede === !ok) return; semRede = !ok; window.dispatchEvent(new Event('fila-mudou')); }

// ---- cache de leitura ----
const CACHEAVEL = /^\/api\/(os|resumo|notificacoes|quartos\/\d+$|eu$)/;
export const cacheavel = (caminho) => CACHEAVEL.test(caminho);

export async function guardarCache(url, dados, usuarioId) {
  try {
    if (JSON.stringify(dados).length > 3e6) return;
    await operar('cache', 'readwrite', (s) => s.put({ url, dados, usuario_id: usuarioId ?? dados?.usuario?.id ?? null, em: new Date().toISOString() }));
  } catch { /* cache é um extra: falha silenciosa */ }
}

export async function lerCache(url, usuarioId) {
  try {
    const r = await operar('cache', 'readonly', (s) => s.get(url));
    if (!r) return null;
    if (url === '/api/eu') return r.dados?.usuario?.papel === 'tecnico' ? r : null;
    return r.usuario_id === usuarioId ? r : null;
  } catch { return null; }
}

// ---- fila de ações ----
const avisar = () => window.dispatchEvent(new Event('fila-mudou'));
export async function listarFila() { try { return await operar('fila', 'readonly', (s) => s.getAll()) || []; } catch { return []; } }
export async function contarPendentes() { return (await listarFila()).length; }
export async function removerDaFila(id) { await operar('fila', 'readwrite', (s) => s.delete(id)); avisar(); }
async function atualizarFila(id, patch) {
  const atual = await operar('fila', 'readonly', (s) => s.get(id));
  if (atual) await operar('fila', 'readwrite', (s) => s.put({ ...atual, ...patch }));
}
export async function reabrirItem(id) { await atualizarFila(id, { erro: null }); avisar(); }

const ACAO_OFFLINE = /^\/api\/os\/(\d+)\/acoes\/(assumir|iniciar|concluir|aguardar_materiais|solicitar_material|materiais_disponiveis|registrar_dificuldade|registrar_custo|baixar_estoque|concluir_tarefa|comentar|solicitar_orcamento)$/;
export const ehAcaoOffline = (caminho) => ACAO_OFFLINE.test(caminho) || caminho === '/api/fotos';

const ROTULOS = {
  assumir: 'Assumir demanda', iniciar: 'Iniciar execução', aguardar_materiais: 'Pausar: aguardando materiais', solicitar_material: 'Solicitar materiais',
  materiais_disponiveis: 'Materiais disponíveis — retomar execução', registrar_dificuldade: 'Registrar dificuldade', registrar_custo: 'Registrar custo',
  baixar_estoque: 'Usar material do estoque', concluir_tarefa: 'Concluir atividade', concluir: 'Registrar conclusão', comentar: 'Comentário',
  solicitar_orcamento: 'Informar necessidade de orçamento', fotos: 'Fotos anexadas',
};
const TRANSICAO = { iniciar: 'em_execucao', concluir: 'concluida', aguardar_materiais: 'aguardando_materiais', materiais_disponiveis: 'em_execucao' };
const ACOES_POR_STATUS = {
  aprovada: ['iniciar', 'solicitar_material', 'registrar_dificuldade', 'solicitar_orcamento'],
  em_correcao: ['iniciar', 'solicitar_material', 'registrar_dificuldade', 'solicitar_orcamento'],
  em_execucao: ['concluir', 'aguardar_materiais', 'solicitar_material', 'registrar_dificuldade', 'registrar_custo', 'baixar_estoque', 'solicitar_orcamento'],
  aguardando_materiais: ['materiais_disponiveis', 'solicitar_material', 'registrar_dificuldade'],
};
const INTERNAS = ['comentar', 'concluir_tarefa'];

// Depois de uma ação feita sem internet, a ficha guardada reflete o novo andamento (o servidor confirma depois).
async function aplicarLocal(item, usuario) {
  const chave = `/api/os/${item.os_id}`;
  const r = await operar('cache', 'readonly', (s) => s.get(chave)).catch(() => null);
  if (!r || r.usuario_id !== usuario.id) return;
  const os = r.dados;
  if (TRANSICAO[item.acao]) os.status = TRANSICAO[item.acao];
  if (['assumir', 'iniciar'].includes(item.acao) && !os.responsavel_id) { os.responsavel_id = usuario.id; os.responsavel_nome = usuario.nome; }
  if (item.acao === 'concluir_tarefa') os.tarefas = (os.tarefas || []).map((t) => (String(t.id) === String(item.corpo.tarefa_id) ? { ...t, concluida: 1, concluida_em: item.criado_em } : t));
  const detalhe = item.corpo.texto ? `: ${item.corpo.texto}` : '';
  os.eventos = [...(os.eventos || []), { tipo: item.acao === 'comentar' ? 'comentario' : 'status', texto: `(sem conexão, aguardando envio) ${item.rotulo}${detalhe}`, usuario_nome: usuario.nome, usuario_papel: usuario.papel, criado_em: item.criado_em }];
  const anteriores = new Map((os.acoes || []).map((a) => [a.chave, a]));
  const chaves = [...(ACOES_POR_STATUS[os.status] || []), ...((os.tarefas || []).some((t) => !t.concluida && t.tecnico_id === usuario.id) ? ['concluir_tarefa'] : []), 'comentar'];
  os.acoes = chaves.map((c) => anteriores.get(c) || { chave: c, rotulo: ROTULOS[c], interna: INTERNAS.includes(c), exigeTexto: false });
  await guardarCache(chave, os, usuario.id);
}

// Guarda a ação no aparelho; chamada quando a internet falhou no meio de uma ação do técnico.
export async function guardarAcao(caminho, corpo, usuario) {
  const m = ACAO_OFFLINE.exec(caminho);
  const item = {
    url: caminho, corpo, usuario_id: usuario.id, criado_em: new Date().toISOString(),
    os_id: m ? Number(m[1]) : Number(corpo.os_id) || null, acao: m ? m[2] : 'fotos', erro: null,
  };
  item.rotulo = ROTULOS[item.acao] || item.acao;
  item.fotos = Array.isArray(corpo.fotos) ? corpo.fotos.length : (corpo.arquivo ? 1 : 0);
  await operar('fila', 'readwrite', (s) => s.add(item));
  if (m) await aplicarLocal(item, usuario);
  avisar();
  return { ok: true, enfileirado: true };
}

// Envia a fila em ordem. Falha de rede ou de servidor: para e tenta depois. Recusa do servidor (4xx): marca o item
// com o motivo para o usuário decidir (descartar ou refazer), e segue com os demais.
let sincronizando = false;
export async function sincronizar(usuarioId) {
  if (sincronizando) return 0;
  sincronizando = true;
  let enviados = 0;
  try {
    for (const it of await listarFila()) {
      if (it.erro) continue;
      if (usuarioId != null && it.usuario_id !== usuarioId) { await atualizarFila(it.id, { erro: 'Feita por outro usuário neste aparelho. Entre com a conta de origem para enviar.' }); continue; }
      let r;
      try { r = await fetch(it.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(it.corpo), credentials: 'same-origin' }); } catch { marcarRede(false); break; }
      marcarRede(true);
      if (r.status === 401 || r.status >= 500) break;
      if (r.ok) { await removerDaFila(it.id); enviados++; continue; }
      const d = await r.json().catch(() => ({}));
      await atualizarFila(it.id, { erro: d.erro || `Erro ${r.status}` });
    }
  } finally { sincronizando = false; }
  avisar();
  if (enviados) window.dispatchEvent(new Event('fila-sincronizada'));
  return enviados;
}

// Ao sair da conta: apaga os dados guardados (aparelho compartilhado) e o modo offline.
export async function limparTudo() {
  definirModoTecnico(false);
  try { await operar('cache', 'readwrite', (s) => s.clear()); await operar('fila', 'readwrite', (s) => s.clear()); } catch { /* nada a limpar */ }
  avisar();
}
