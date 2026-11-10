import { api, qs, ehRede } from '../estado.js';
import { html, render, raw, $, seletorHotel, dataHora } from '../ui.js';

const detalhar = (d) => {
  if (!d) return '';
  try {
    const o = JSON.parse(d);
    return typeof o === 'object' ? Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : String(o);
  } catch { return d; }
};

export async function mostrar(el, _p, query) {
  const acessos = query.grupo === 'acessos';
  const { acoes, itens } = await api(`/api/auditoria${qs({ hotel_id: query.hotel_id, acao: query.acao, grupo: query.grupo })}`);
  render(el, html`
    <div class="cabecalho"><div><h1>Registro de ações</h1>
      <p class="sub">${acessos ? 'Entradas e saídas do sistema e tentativas de senha errada, com o endereço de internet (IP) e o aparelho. Guardado por 180 dias.' : 'Quem fez cada alteração administrativa: usuários, senhas, quartos, checklist, bloqueios, preventiva, estoque e backups. As etapas das demandas ficam no histórico de cada OS.'}</p></div></div>
    <div class="abas"><a class="btn ${acessos ? '' : 'primario'}" href="#/auditoria${qs({ hotel_id: query.hotel_id })}">Ações</a> <a class="btn ${acessos ? 'primario' : ''}" href="#/auditoria${qs({ hotel_id: query.hotel_id, grupo: 'acessos' })}">Acessos</a></div>
    <form class="filtros" id="filtros">
      <input type="hidden" name="grupo" value="${acessos ? 'acessos' : ''}">
      ${ehRede() ? html`<label>Unidade ${seletorHotel(query.hotel_id)}</label>` : ''}
      <label>Ação <select name="acao"><option value="">Todas</option>${Object.entries(acoes).map(([k, v]) => html`<option value="${k}" ${query.acao === k ? raw('selected') : ''}>${v}</option>`)}</select></label>
    </form>
    <section class="card">${itens.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Sobre</th>${ehRede() ? html`<th>Hotel</th>` : ''}<th>Detalhes</th></tr></thead><tbody>
      ${itens.map((a) => html`<tr><td class="nowrap">${dataHora(a.criado_em)}</td><td>${a.usuario_nome || (acessos ? 'Não identificado' : '—')}<br><span class="muted small">${a.usuario_login || ''}</span></td>
        <td>${acessos && a.acao !== 'login_ok' && a.acao !== 'logout' ? html`<strong style="color:var(--perigo,#b42318)">${acoes[a.acao] || a.acao}</strong>` : (acoes[a.acao] || a.acao)}</td><td>${a.alvo || '—'}</td>${ehRede() ? html`<td>${a.hotel_nome || 'Rede'}</td>` : ''}<td class="small muted">${detalhar(a.detalhes)}</td></tr>`)}
      </tbody></table></div>${itens.length >= 300 ? html`<p class="small muted">Mostrando as 300 ações mais recentes.</p>` : ''}` : html`<p class="vazio">${acessos ? 'Nenhum acesso registrado ainda.' : 'Nenhuma ação registrada ainda.'}</p>`}</section>`);
  $('#filtros', el).addEventListener('change', (e) => { location.hash = `#/auditoria${qs(Object.fromEntries(new FormData(e.currentTarget)))}`; });
}
