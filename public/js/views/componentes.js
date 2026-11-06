import { estado, ehRede } from '../estado.js';
import { html, raw, badgePrioridade, badgeStatus, badgeAtraso, dataHora, relativo, moeda } from '../ui.js';

export function tabelaOS(lista, { vazio = 'Nenhuma demanda encontrada.', compacta = false } = {}) {
  if (!lista.length) return html`<p class="vazio">${vazio}</p>`;
  const M = estado.meta;
  const rede = ehRede();
  // Larguras fixas: as tabelas de demandas ficam alinhadas entre si em todas as telas.
  const cols = [['9.5rem'], rede ? ['9rem'] : null, [null], ['7.5rem'], ['12rem'], compacta ? null : ['9.5rem'], compacta ? null : ['9rem'], ['9rem']].filter(Boolean);
  return html`<div class="tabela-wrap"><table class="fixa" style="min-width:${compacta ? 720 : 980}px">
    <colgroup>${cols.map(([w]) => html`<col ${w ? raw(`style="width:${w}"`) : ''}>`)}</colgroup>
    <thead><tr><th>OS</th>${rede ? html`<th>Hotel</th>` : ''}<th>Local / problema</th><th>Prioridade</th><th>Situação</th>
      ${compacta ? '' : html`<th>Aberta em</th><th>Responsável</th>`}<th>Prazo</th></tr></thead>
    <tbody>${lista.map((o) => html`<tr class="clicavel ${o.atrasada ? 'atrasada' : ''}" data-href="#/os/${o.id}">
      <td class="nowrap"><a href="#/os/${o.id}"><strong>${o.protocolo}</strong></a>${o.recorrente ? html`<br><span class="badge danger sem-ponto" title="Problema recorrente">↻ recorrente</span>` : ''}</td>
      ${rede ? html`<td>${o.hotel_nome}</td>` : ''}
      <td><strong>${o.titulo}</strong><br><span class="muted small">${M.LOCAIS[o.local]}${o.quarto_numero ? html` · Quarto ${o.quarto_numero}` : ''} · ${M.CATEGORIAS[o.categoria]}</span>
        ${compacta ? '' : html`<br><span class="small">${o.descricao.length > 110 ? `${o.descricao.slice(0, 110)}…` : o.descricao}</span>`}</td>
      <td>${badgePrioridade(o.prioridade)}</td>
      <td>${badgeStatus(o.status)} ${badgeAtraso(o)}${o.aprovacoes_pendentes ? html`<br><span class="badge warn sem-ponto">orçamento pendente</span>` : ''}</td>
      ${compacta ? '' : html`<td class="nowrap">${dataHora(o.criado_em)}<br><span class="muted small">por ${o.aberto_por_nome}</span></td>
      <td>${o.responsavel_nome || html`<span class="muted">—</span>`}${o.custo_total ? html`<br><span class="muted small">${moeda(o.custo_total)}</span>` : ''}</td>`}
      <td class="nowrap">${o.prazo_previsto ? html`${dataHora(o.prazo_previsto)}<br><span class="small ${o.atrasada ? '' : 'muted'}" style="${o.atrasada ? 'color:var(--danger);font-weight:600' : ''}">${relativo(o.prazo_previsto)}</span>` : '—'}</td>
    </tr>`)}</tbody></table></div>`;
}

// Linhas clicáveis em tabelas.
document.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-href]');
  if (tr && !e.target.closest('a, button, input, select')) location.hash = tr.dataset.href;
});

export function kpi(rotulo, valor, { detalhe, classe = '', href } = {}) {
  const corpo = html`<div class="rotulo">${rotulo}</div><div class="valor">${valor}</div>${detalhe ? html`<div class="detalhe">${detalhe}</div>` : ''}`;
  return href ? html`<a class="kpi ${classe}" href="${href}">${corpo}</a>` : html`<div class="kpi ${classe}">${corpo}</div>`;
}
