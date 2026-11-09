import { api, qs, ehRede } from '../estado.js';
import { html, render, $, seletorHotel, barras, moeda, pct, horas } from '../ui.js';
import { kpi } from './componentes.js';

export const filtroPeriodo = (query) => html`
  <label>De <input type="date" name="de" value="${(query.de || '').slice(0, 10)}"></label>
  <label>Até <input type="date" name="ate" value="${(query.ate || '').slice(0, 10)}"></label>
  <span class="acoes-topo">${[30, 90, 180, 365].map((d) => html`<button type="button" class="btn pequeno" data-dias="${d}">${d} dias</button>`)}</span>`;

export function ligarFiltros(el, rota, query) {
  const form = $('#filtros', el);
  const ir = (f) => { location.hash = `#/${rota}${qs(f)}`; };
  form.addEventListener('change', () => ir(Object.fromEntries(new FormData(form))));
  for (const b of form.querySelectorAll('[data-dias]')) {
    b.addEventListener('click', () => {
      const de = new Date(Date.now() - Number(b.dataset.dias) * 86400e3).toISOString().slice(0, 10);
      ir({ ...query, de, ate: '' });
    });
  }
}

export function tabelaDesempenho(linhas, titulo = 'Profissional') {
  if (!linhas.length) return html`<p class="vazio">Sem dados no período.</p>`;
  return html`<div class="tabela-wrap"><table><thead><tr><th>${titulo}</th><th class="num">Demandas</th><th class="num">Concluídas</th><th class="num">Pendentes</th><th class="num">Atrasadas</th>
    <th class="num">No prazo</th><th class="num">Tempo atend.</th><th class="num">Tempo concl.</th><th class="num">Correções</th><th class="num">Reabertas</th><th class="num">Custo médio</th></tr></thead>
    <tbody>${linhas.map((l) => html`<tr><td>${l.rotulo}</td><td class="num">${l.total}</td><td class="num">${l.concluidas}</td><td class="num">${l.pendentes}</td>
      <td class="num">${l.atrasadas ? html`<strong style="color:var(--danger)">${l.atrasadas}</strong>` : 0}</td><td class="num">${pct(l.taxa_no_prazo)}</td>
      <td class="num">${horas(l.tempo_atendimento_h)}</td><td class="num">${horas(l.tempo_conclusao_h)}</td><td class="num">${l.correcoes}</td><td class="num">${l.reabertas}</td><td class="num">${moeda(l.custo_medio)}</td></tr>`)}</tbody></table></div>`;
}

export async function mostrar(el, _p, query) {
  const d = await api(`/api/indicadores${qs(query)}`);
  const g = d.geral;
  render(el, html`
    <div class="cabecalho"><div><h1>Indicadores de desempenho da manutenção</h1>
      <p class="sub">Demandas abertas entre ${new Date(d.periodo.de).toLocaleDateString('pt-BR')} e ${new Date(d.periodo.ate).toLocaleDateString('pt-BR')}</p></div>
      <div class="acoes-topo"><a class="btn" href="/api/exportar/indicadores.csv${qs(query)}" download>⬇ Excel</a></div></div>
    <form class="filtros" id="filtros">${ehRede() ? html`<label>Unidade ${seletorHotel(query.hotel_id)}</label>` : ''}${filtroPeriodo(query)}</form>
    <div class="kpis">
      ${kpi('Demandas abertas', g.total)}
      ${kpi('Concluídas', g.concluidas, { detalhe: `${g.encerradas} encerradas e validadas` })}
      ${kpi('Pendentes', g.pendentes)}
      ${kpi('Atrasadas', g.atrasadas, { classe: g.atrasadas ? 'alerta' : 'bom' })}
      ${kpi('Tempo médio de resposta', horas(g.tempo_resposta_h), { detalhe: 'abertura → recebimento' })}
      ${kpi('Tempo médio de atendimento', horas(g.tempo_atendimento_h), { detalhe: 'abertura → início da execução' })}
      ${kpi('Tempo médio de conclusão', horas(g.tempo_conclusao_h), { detalhe: 'abertura → conclusão' })}
      ${kpi('Resolução dentro do prazo', pct(g.taxa_no_prazo), { classe: g.taxa_no_prazo >= 80 ? 'bom' : g.taxa_no_prazo != null ? 'atencao' : '' })}
      ${kpi('Demandas reabertas', g.reabertas, { detalhe: `${g.correcoes} correção(ões) solicitada(s)` })}
      ${kpi('Problemas recorrentes', g.recorrentes, { href: '#/recorrencia' })}
      ${kpi('Custo total', moeda(g.custo_total))}
      ${kpi('Custo médio por manutenção', moeda(g.custo_medio))}
    </div>
    <div class="grade grade-3">
      <section class="card"><h2>Volume por hotel</h2>${barras(d.porHotel, { valor: (i) => i.total })}</section>
      <section class="card"><h2>Volume por profissional</h2>${barras(d.porProfissional, { valor: (i) => i.total })}</section>
      <section class="card"><h2>Demandas por categoria</h2>${barras(d.porCategoria, { valor: (i) => i.total })}</section>
      <section class="card"><h2>Custo por categoria</h2>${barras([...d.porCategoria].sort((a, b) => b.custo_total - a.custo_total), { valor: (i) => i.custo_total, formato: moeda })}</section>
      <section class="card"><h2>Por prioridade</h2>${barras(d.porPrioridade, { valor: (i) => i.total })}</section>
      <section class="card"><h2>Taxa no prazo por hotel</h2>${barras(d.porHotel.filter((h) => h.taxa_no_prazo != null), { valor: (i) => i.taxa_no_prazo, formato: pct })}</section>
    </div>
    <section class="card" style="margin-top:1rem"><h2>Gargalos operacionais</h2>
      <p class="muted small">Tempo médio de permanência em cada etapa do fluxo, calculado a partir do histórico das demandas.</p>
      ${d.gargalos.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Etapa</th><th>Tempo médio</th><th class="num">Passagens</th><th class="num">Paradas agora</th></tr></thead><tbody>
        ${d.gargalos.map((x) => html`<tr><td>${x.rotulo}</td><td style="min-width:200px">${barras([x], { valor: (i) => i.media_h, rotulo: () => '', formato: horas })}</td><td class="num">${x.passagens}</td><td class="num">${x.parados_agora}</td></tr>`)}</tbody></table></div>` : html`<p class="vazio">Sem dados.</p>`}
    </section>
    <section class="card"><h2>Comparativo de desempenho das equipes</h2>${tabelaDesempenho(d.porProfissional)}</section>
    <section class="card"><h2>Comparativo por hotel</h2>${tabelaDesempenho(d.porHotel, 'Hotel')}</section>
    <section class="card"><h2>Evolução mensal</h2>
      ${d.evolucao.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Mês</th><th class="num">Abertas</th><th class="num">Concluídas</th><th class="num">Custo</th></tr></thead><tbody>
        ${d.evolucao.map((m) => html`<tr><td>${new Date(`${m.mes}-15`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</td><td class="num">${m.abertas}</td><td class="num">${m.concluidas}</td><td class="num">${moeda(m.custo)}</td></tr>`)}</tbody></table></div>` : html`<p class="vazio">Sem dados.</p>`}
    </section>
    <section class="card"><div class="card-titulo"><h2>Problemas recorrentes</h2><a href="#/recorrencia">Análise completa →</a></div>
      ${d.problemasRecorrentes.length ? html`<ul class="lista-simples">${d.problemasRecorrentes.map((a) => html`<li><span class="badge ${a.nivel === 'critico' ? 'danger' : 'warn'}">${a.nivel === 'critico' ? 'Crítico' : 'Atenção'}</span> ${a.recomendacao}</li>`)}</ul>` : html`<p class="vazio">Nenhuma recorrência identificada.</p>`}
    </section>`);
  ligarFiltros(el, 'indicadores', query);
}
