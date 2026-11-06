import { estado, api, post, qs, ehRede, papel } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, $, $$, toast, seletorHotel, barras, data, moeda, numero } from '../ui.js';

export async function mostrar(el, _p, query) {
  const r = await api(`/api/recorrencia${qs(query)}`);
  const M = estado.meta;
  const rede = ehRede();
  const criticos = r.alertas.filter((a) => a.nivel === 'critico');
  const podeCronico = papel('gerente', 'governanta', 'admin', 'manutencao_chefe', 'diretoria');

  render(el, html`
    <div class="cabecalho"><div><h1>Índice de recorrência de problemas</h1>
      <p class="sub">Cruza o histórico de manutenções dos últimos ${r.parametros.janelaDias} dias: intervalos entre ocorrências, retornos após intervenção (até ${r.parametros.retornoDias} dias), reaberturas e custos.</p></div></div>
    <form class="filtros" id="filtros">
      ${rede ? html`<label>Unidade ${seletorHotel(query.hotel_id)}</label>` : ''}
      <label>Janela de histórico <select name="janela_dias">${[180, 365, 730].map((d) => html`<option value="${d}" ${Number(query.janela_dias || 365) === d ? 'selected' : ''}>${d} dias</option>`)}</select></label>
    </form>
    <div class="kpis">
      <div class="kpi ${criticos.length ? 'alerta' : 'bom'}"><div class="rotulo">Recorrências críticas</div><div class="valor">${criticos.length}</div></div>
      <div class="kpi ${r.alertas.length - criticos.length ? 'atencao' : ''}"><div class="rotulo">Em atenção</div><div class="valor">${r.alertas.length - criticos.length}</div></div>
      <div class="kpi"><div class="rotulo">Repetições em curto intervalo</div><div class="valor">${r.repeticoes.length}</div><div class="detalhe">até ${r.parametros.intervaloCurtoDias} dias</div></div>
      <div class="kpi"><div class="rotulo">Retornos após intervenção</div><div class="valor">${r.retornos.length}</div></div>
      <div class="kpi"><div class="rotulo">Quartos com custo elevado</div><div class="valor">${r.custosElevados.length}</div></div>
    </div>

    <section class="card"><h2>Alertas gerenciais</h2>
      ${r.alertas.length ? r.alertas.map((a, i) => html`<div class="aviso ${a.nivel === 'critico' ? 'danger' : 'warn'}" style="margin-bottom:.75rem">
        <span class="icone">↻</span><div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap"><strong>${a.hotel_nome} · <a href="#/quartos/${a.quarto_id}">Quarto ${a.quarto_numero}</a> · ${a.equipamento_tipo || M.CATEGORIAS[a.categoria]}</strong>
            <span>${a.nivel === 'critico' ? html`<span class="badge danger">Crítico</span>` : html`<span class="badge warn">Atenção</span>`} <span class="badge sem-ponto" title="Índice que pondera ocorrências, retornos, intervalos curtos e reaberturas">índice ${a.indice}</span></span></div>
          <p style="margin:.3rem 0">${a.recomendacao}</p>
          <div class="small">${a.historico.map((h, j) => html`${j ? ' → ' : ''}<a href="#/os/${h.id}" title="${h.titulo}">${new Date(h.criado_em).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}</a>`)}
            <span class="muted"> · custo acumulado ${moeda(a.custo)}${a.acelerando ? ' · intervalos diminuindo' : ''}</span></div>
          <div class="acoes-topo" style="margin-top:.5rem">
            ${a.cronico_registrado ? html`<span class="badge warn">Problema crônico registrado</span>` : podeCronico ? html`<button class="btn pequeno" data-cronico="${i}">Registrar como problema crônico</button>` : ''}
            <a class="btn pequeno" href="#/quartos/${a.quarto_id}">${a.equipamento_tipo ? 'Avaliar / substituir equipamento' : 'Ver quarto'}</a>
          </div></div></div>`) : html`<p class="vazio">Nenhuma recorrência identificada no período.</p>`}
    </section>

    <div class="grade grade-2" style="margin-top:1rem">
      <section class="card"><h2>Quartos com maior número de ocorrências</h2>
        ${barras(r.quartos.slice(0, 10), { valor: (q) => q.ocorrencias, rotulo: (q) => `${rede ? `${q.hotel_nome} · ` : ''}${q.quarto_numero}`, link: (q) => `#/quartos/${q.quarto_id}` })}</section>
      <section class="card"><h2>Equipamentos com maior índice de falhas</h2>
        ${r.equipamentos.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Equipamento</th><th class="num">Falhas</th><th class="num">Unidades</th><th class="num">Falhas/unid.</th><th class="num">Quartos</th><th class="num">Custo</th></tr></thead><tbody>
          ${r.equipamentos.map((e) => html`<tr><td>${e.tipo}</td><td class="num">${e.falhas}</td><td class="num">${e.unidades}</td><td class="num"><strong>${numero(e.indice, 2)}</strong></td><td class="num">${e.quartos_afetados}</td><td class="num">${moeda(e.custo)}</td></tr>`)}</tbody></table></div>` : html`<p class="vazio">Sem falhas vinculadas a equipamentos.</p>`}</section>
      <section class="card"><h2>Problemas recorrentes por categoria</h2>
        <div class="tabela-wrap"><table><thead><tr><th>Categoria</th><th class="num">Ocorrências</th><th class="num">Quartos</th><th class="num">Com recorrência</th><th class="num">Hotéis</th><th class="num">Custo</th></tr></thead><tbody>
          ${r.categorias.map((c) => html`<tr><td>${c.rotulo}</td><td class="num">${c.ocorrencias}</td><td class="num">${c.quartos_afetados}</td><td class="num">${c.quartos_com_recorrencia ? html`<strong>${c.quartos_com_recorrencia}</strong>` : 0}</td><td class="num">${c.hoteis}</td><td class="num">${moeda(c.custo)}</td></tr>`)}</tbody></table></div></section>
      <section class="card"><h2>Quartos com custos elevados</h2><p class="muted small">Custo acima de 1,5× a média por quarto do próprio hotel.</p>
        ${r.custosElevados.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Quarto</th><th class="num">Custo</th><th class="num">Média do hotel</th><th class="num">Razão</th></tr></thead><tbody>
          ${r.custosElevados.map((q) => html`<tr class="clicavel" data-href="#/quartos/${q.quarto_id}"><td>${rede ? html`${q.hotel_nome} · ` : ''}${q.quarto_numero}</td><td class="num">${moeda(q.custo)}</td><td class="num">${moeda(q.media_hotel)}</td><td class="num"><strong>${numero(q.razao, 1)}×</strong></td></tr>`)}</tbody></table></div>` : html`<p class="vazio">Nenhum quarto acima da média.</p>`}</section>
      <section class="card"><h2>Manutenções repetidas em curto intervalo</h2>
        ${r.repeticoes.length ? html`<ul class="lista-simples">${r.repeticoes.map((x) => html`<li><a href="#/quartos/${x.quarto_id}">Quarto ${x.quarto_numero}</a>${rede ? html` <span class="muted small">(${x.hotel_nome})</span>` : ''} · ${x.alvo}: <a href="#/os/${x.anterior.id}">${x.anterior.protocolo}</a> → <a href="#/os/${x.atual.id}">${x.atual.protocolo}</a> <strong>${x.dias} dias</strong></li>`)}</ul>` : html`<p class="vazio">Nenhuma.</p>`}</section>
      <section class="card"><h2>Problemas que voltaram após intervenção</h2>
        ${r.retornos.length ? html`<ul class="lista-simples">${r.retornos.map((x) => html`<li><a href="#/quartos/${x.quarto_id}">Quarto ${x.quarto_numero}</a>${rede ? html` <span class="muted small">(${x.hotel_nome})</span>` : ''} · ${x.alvo}:
          ${x.reaberta ? html`<a href="#/os/${x.atual.id}">${x.atual.protocolo}</a> reaberta ${x.reaberta}×` : html`voltou <strong>${x.dias_apos_conclusao} dias</strong> após a conclusão de <a href="#/os/${x.anterior.id}">${x.anterior.protocolo}</a> (<a href="#/os/${x.atual.id}">${x.atual.protocolo}</a>, ${data(x.atual.criado_em)})`}</li>`)}</ul>` : html`<p class="vazio">Nenhum.</p>`}</section>
    </div>`);

  $('#filtros', el).addEventListener('change', (e) => { location.hash = `#/recorrencia${qs(Object.fromEntries(new FormData(e.currentTarget)))}`; });
  for (const b of $$('[data-cronico]', el)) {
    b.addEventListener('click', async () => {
      const a = r.alertas[Number(b.dataset.cronico)];
      await post('/api/cronicos', { quarto_id: a.quarto_id, equipamento_id: a.equipamento_id, categoria: a.categoria, descricao: a.recomendacao, origem: 'recorrencia' });
      toast('Problema crônico registrado.');
      recarregar();
    });
  }
}
