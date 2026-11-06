import { api, qs } from '../estado.js';
import { html, render, barras, estrelas, badgeComercial, numero, moeda, pct, horas } from '../ui.js';
import { kpi } from './componentes.js';
import { filtroPeriodo, ligarFiltros, tabelaDesempenho } from './indicadores.js';

export async function mostrar(el, _p, query) {
  const d = await api(`/api/rede${qs(query)}`);
  const u = d.unidades;
  const soma = (k) => u.reduce((s, x) => s + (x[k] || 0), 0);
  const t = d.totais;

  render(el, html`
    <div class="cabecalho"><div><h1>Visão consolidada da rede</h1>
      <p class="sub">${u.length} unidade(s) · indicadores de manutenção do período ${new Date(d.periodo.de).toLocaleDateString('pt-BR')} a ${new Date(d.periodo.ate).toLocaleDateString('pt-BR')}; situação dos quartos e pendências em tempo real.</p></div></div>
    <form class="filtros" id="filtros">${filtroPeriodo(query)}</form>
    <div class="kpis">
      ${kpi('Quartos na rede', soma('quartos'), { detalhe: `${soma('liberados')} liberados · ${soma('bloqueados')} bloqueados` })}
      ${kpi('Pendências agora', soma('pendentes_agora'), { href: '#/os?grupo=todas_abertas' })}
      ${kpi('Atrasadas agora', soma('atrasadas_agora'), { classe: soma('atrasadas_agora') ? 'alerta' : 'bom', href: '#/os?grupo=atrasadas' })}
      ${kpi('Emergenciais abertas', soma('emergenciais_abertas'), { classe: soma('emergenciais_abertas') ? 'alerta' : '' })}
      ${kpi('Quartos com baixa avaliação', d.baixaAvaliacao.length, { detalhe: '≤ 2 estrelas', classe: d.baixaAvaliacao.length ? 'atencao' : '' })}
      ${kpi('Inspeções vencidas', soma('inspecoes_vencidas'))}
      ${kpi('Custo no período', moeda(t.custo_total))}
      ${kpi('Resolução no prazo', pct(t.taxa_no_prazo))}
    </div>
    <section class="card"><h2>Comparativo entre unidades</h2>
      <div class="tabela-wrap"><table><thead><tr><th>Unidade</th><th>Conservação</th><th class="num">Quartos</th><th class="num">Bloqueados</th><th class="num">Baixa aval.</th><th class="num">Insp. vencidas</th>
        <th class="num">Pendentes</th><th class="num">Atrasadas</th><th class="num">Demandas (período)</th><th class="num">No prazo</th><th class="num">Tempo concl.</th><th class="num">Custo</th><th class="num">Custo/quarto</th><th class="num">Crônicos</th><th class="num">Recorrências</th></tr></thead>
        <tbody>${u.map((h) => html`<tr><td><strong>${h.nome}</strong><br><span class="muted small">${h.cidade || ''}</span></td>
          <td>${estrelas(h.estrelas_media)} <span class="muted small">${numero(h.estrelas_media, 1)}</span></td>
          <td class="num">${h.quartos}</td><td class="num">${h.bloqueados}</td><td class="num">${h.baixa_avaliacao}</td><td class="num">${h.inspecoes_vencidas}</td>
          <td class="num"><a href="#/os?hotel_id=${h.hotel_id}&grupo=todas_abertas">${h.pendentes_agora}</a></td>
          <td class="num">${h.atrasadas_agora ? html`<a href="#/os?hotel_id=${h.hotel_id}&grupo=atrasadas" style="color:var(--danger);font-weight:700">${h.atrasadas_agora}</a>` : 0}</td>
          <td class="num">${h.total}</td><td class="num">${pct(h.taxa_no_prazo)}</td><td class="num">${horas(h.tempo_conclusao_h)}</td>
          <td class="num">${moeda(h.custo_total)}</td><td class="num">${moeda(h.custo_por_quarto)}</td><td class="num">${h.cronicos}</td><td class="num">${h.alertas_recorrencia}</td></tr>`)}</tbody></table></div>
    </section>
    <div class="grade grade-3" style="margin-top:1rem">
      <section class="card"><h2>Volume de manutenção</h2>${barras(u, { valor: (h) => h.total, rotulo: (h) => h.nome })}</section>
      <section class="card"><h2>Custo operacional</h2>${barras(u, { valor: (h) => h.custo_total, rotulo: (h) => h.nome, formato: moeda })}</section>
      <section class="card"><h2>Custo por quarto</h2>${barras(u, { valor: (h) => h.custo_por_quarto || 0, rotulo: (h) => h.nome, formato: moeda })}</section>
      <section class="card"><h2>Pendências por unidade</h2>${barras(u, { valor: (h) => h.pendentes_agora, rotulo: (h) => h.nome, link: (h) => `#/os?hotel_id=${h.hotel_id}&grupo=todas_abertas` })}</section>
      <section class="card"><h2>Conservação média (estrelas)</h2>${barras(u, { valor: (h) => h.estrelas_media || 0, rotulo: (h) => h.nome, formato: (v) => numero(v, 1) })}</section>
      <section class="card"><h2>Resolução no prazo</h2>${barras(u.filter((h) => h.taxa_no_prazo != null), { valor: (h) => h.taxa_no_prazo, rotulo: (h) => h.nome, formato: pct })}</section>
    </div>
    <div class="grade grade-2" style="margin-top:1rem">
      <section class="card"><h2>Problemas estruturais comuns a diferentes hotéis</h2>
        ${d.problemasComuns.length ? html`<ul class="lista-simples">${d.problemasComuns.map((p) => html`<li><strong>${p.problema}</strong> — recorrente em ${p.n_hoteis} unidades (${p.hoteis.join(', ')})
          <div class="muted small">${p.quartos} quarto(s) com recorrência · ${p.ocorrencias} ocorrências · ${moeda(p.custo)}</div></li>`)}</ul>
          <p class="small muted">Sugestão: avaliar padronização de fornecedor, contrato de manutenção preventiva ou substituição em escala.</p>` : html`<p class="vazio">Nenhum problema recorrente em mais de uma unidade.</p>`}
      </section>
      <section class="card"><h2>Quartos com baixa avaliação</h2>
        ${d.baixaAvaliacao.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Quarto</th><th>Avaliação</th><th>Situação</th><th class="num">OS abertas</th><th class="num">Crônicos</th></tr></thead><tbody>
          ${d.baixaAvaliacao.map((q) => html`<tr class="clicavel" data-href="#/quartos/${q.id}"><td>${q.hotel_nome} · <a href="#/quartos/${q.id}">${q.numero}</a></td><td>${estrelas(q.estrelas)}</td><td>${badgeComercial(q.status_comercial)}</td><td class="num">${q.os_abertas}</td><td class="num">${q.cronicos}</td></tr>`)}</tbody></table></div>` : html`<p class="vazio">Nenhum quarto com avaliação baixa.</p>`}
      </section>
    </div>
    <section class="card" style="margin-top:1rem"><h2>Desempenho das equipes</h2>${tabelaDesempenho(d.equipes)}</section>`);
  ligarFiltros(el, 'rede', query);
}
