// Estado global da sessão e cliente HTTP.
export const estado = { usuario: null, meta: null, hoteis: [], naoLidas: 0 };

export class ErroApi extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const r = await fetch(caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin',
  });
  const dados = await r.json().catch(() => ({}));
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
