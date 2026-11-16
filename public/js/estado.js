// Estado global da sessão e cliente HTTP.
import * as offline from './offline.js';

export const estado = { usuario: null, meta: null, hoteis: [], naoLidas: 0 };

export class ErroApi extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const prazo = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
const FALHA_DE_REDE = (e) => e instanceof TypeError || e?.name === 'TimeoutError' || e?.name === 'AbortError';

export async function api(caminho, { metodo = 'GET', corpo } = {}) {
  // Profissional de manutenção: leituras ficam guardadas no aparelho e ações feitas sem internet entram numa fila.
  const tecnico = offline.modoTecnico();
  const acaoOffline = tecnico && metodo === 'POST' && offline.ehAcaoOffline(caminho);
  if (acaoOffline && corpo && !corpo._idem) corpo = { ...corpo, _idem: offline.novoId() };
  let r;
  try {
    r = await fetch(caminho, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin',
      signal: tecnico ? prazo(acaoOffline && JSON.stringify(corpo).length > 2e5 ? 60000 : 20000) : undefined,
    });
    if (tecnico) offline.marcarRede(true);
  } catch (e) {
    if (!FALHA_DE_REDE(e)) throw e;
    offline.marcarRede(false);
    if (metodo === 'GET' && offline.cacheavel(caminho)) {
      const c = await offline.lerCache(caminho, estado.usuario?.id);
      if (c) { const d = c.dados; if (d && typeof d === 'object') d._cache_em = c.em; return d; }
    }
    if (acaoOffline && estado.usuario) return offline.guardarAcao(caminho, corpo, estado.usuario);
    throw new ErroApi(0, 'Sem conexão com a internet. Tente novamente quando a rede voltar.');
  }
  const dados = await r.json().catch(() => ({}));
  if (r.ok && metodo === 'GET' && (tecnico || caminho === '/api/eu') && offline.cacheavel(caminho)) offline.guardarCache(caminho, dados, estado.usuario?.id);
  if (!r.ok) {
    if (r.status === 401 && caminho !== '/api/login') window.dispatchEvent(new Event('sessao-expirada'));
    throw new ErroApi(r.status, dados.erro || `Erro ${r.status}`);
  }
  return dados;
}
export const post = (c, corpo = {}) => api(c, { metodo: 'POST', corpo });
export const put = (c, corpo = {}) => api(c, { metodo: 'PUT', corpo });

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v != null && v !== false) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Seletores e colunas de unidade só aparecem quando há mais de um hotel cadastrado.
export const ehRede = () => estado.hoteis.length > 1 && (['admin', 'diretoria'].includes(estado.usuario?.papel) || estado.usuario?.hotel_id == null);
export const papel = (...p) => p.includes(estado.usuario?.papel);

// Marca exibida no menu: a logo do hotel do usuário; para acessos da rede, a logo Tri Hotéis.
export function marcaDoUsuario() {
  const h = estado.usuario?.hotel_id ? estado.hoteis.find((x) => x.id === estado.usuario.hotel_id) : null;
  return h?.logo
    ? { src: `/img/hoteis/${h.logo}/horizontal-branco.svg`, alt: h.nome }
    : { src: '/img/rede/horizontal-branco.svg', alt: 'Tri Hotéis' };
}
