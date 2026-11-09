import { estado, api, qs, ehRede, papel } from '../estado.js';
import { html, render, $, $$, opcoes, seletorHotel } from '../ui.js';
import { tabelaOS } from './componentes.js';

export async function mostrar(el, _p, query) {
  const filtros = { grupo: 'todas_abertas', ...query };
  if (filtros.status || filtros.responsavel_id || filtros.aberto_por) { if (!query.grupo) delete filtros.grupo; }
  const [painel, lista] = await Promise.all([
    api(`/api/os/painel${qs({ hotel_id: filtros.hotel_id })}`),
    api(`/api/os${qs(filtros)}`),
  ]);
  const M = estado.meta;
  const ir = (novo) => { location.hash = `#/os${qs(novo)}`; };
  const manut = papel('manutencao_chefe', 'tecnico');

  render(el, html`
    <div class="cabecalho">
      <div><h1>${manut ? 'Painel da manutenção' : 'Demandas de manutenção'}</h1>
        <p class="sub">Central de ordens de serviço — ${lista.length} resultado(s)</p></div>
      <div class="acoes-topo">
        <a class="btn" href="/api/exportar/demandas.csv${qs(filtros)}" download>⬇ Excel</a>
        ${papel('tecnico', 'manutencao_chefe') ? html`<button class="btn ${filtros.responsavel_id === 'eu' ? 'primario' : ''}" id="minhas">Minhas (${painel.minhas})</button>` : ''}
        ${papel('gerente', 'governanta', 'admin', 'manutencao_chefe') ? html`<a class="btn primario" href="#/os/nova">+ Nova solicitação</a>` : ''}
      </div>
    </div>
    <nav class="abas" aria-label="Situação">
      ${painel.grupos.map((g) => html`<button class="aba ${filtros.grupo === g.chave ? 'ativa' : ''} ${g.chave === 'atrasadas' && g.total ? 'alerta' : ''}" data-grupo="${g.chave}">${g.rotulo} <span class="n">${g.total}</span></button>`)}
    </nav>
    <form class="filtros" id="filtros">
      ${ehRede() ? html`<label>Unidade ${seletorHotel(filtros.hotel_id)}</label>` : ''}
      <label>Prioridade <select name="prioridade">${opcoes(M.PRIORIDADES, filtros.prioridade, { vazio: 'Todas' })}</select></label>
      <label>Categoria <select name="categoria">${opcoes(M.CATEGORIAS, filtros.categoria, { vazio: 'Todas' })}</select></label>
      <label>Situação <select name="status">${opcoes(M.STATUS, filtros.status, { vazio: 'Conforme a aba' })}</select></label>
      <label style="flex:1;min-width:180px">Buscar <input name="busca" type="search" value="${filtros.busca || ''}" placeholder="Protocolo, quarto ou texto"></label>
      <button class="btn" type="submit">Filtrar</button>
      <button class="btn" type="button" id="limpar">Limpar</button>
    </form>
    <section class="card">${tabelaOS(lista)}</section>`);

  for (const b of $$('[data-grupo]', el)) b.addEventListener('click', () => ir({ ...filtros, status: '', grupo: b.dataset.grupo }));
  $('#filtros', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    ir({ ...filtros, ...f, grupo: f.status ? '' : filtros.grupo || 'todas_abertas' });
  });
  $('#filtros', el).addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.currentTarget.requestSubmit(); });
  $('#limpar', el).addEventListener('click', () => ir({}));
  $('#minhas', el)?.addEventListener('click', () => ir(filtros.responsavel_id === 'eu' ? {} : { responsavel_id: 'eu', grupo: 'todas_abertas' }));
}
