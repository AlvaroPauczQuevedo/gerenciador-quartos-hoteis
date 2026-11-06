import { api, post, qs, ehRede, papel } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, $, $$, modal, toast, seletorHotel, dadosForm, estrelas, data, numero, relativo } from '../ui.js';

export async function mostrar(el, _p, query) {
  const [{ inspecoes, agenda }, quartos] = await Promise.all([
    api(`/api/inspecoes${qs(query)}`),
    api(`/api/quartos${qs({ hotel_id: query.hotel_id })}`),
  ]);
  const rede = ehRede();
  const vencidas = agenda.filter((a) => a.vencida);
  const podeProgramar = papel('gerente', 'admin', 'governanta');

  render(el, html`
    <div class="cabecalho">
      <div><h1>Inspeções periódicas</h1><p class="sub">Checklist por ambiente e equipamento — funciona no computador, tablet ou celular.</p></div>
      <div class="acoes-topo">${podeProgramar ? html`<button class="btn" id="programar">Programar periodicidade</button>` : ''}</div>
    </div>
    ${rede ? html`<form class="filtros" id="filtros"><label>Unidade ${seletorHotel(query.hotel_id)}</label></form>` : ''}
    <section class="card">
      <h2>Iniciar inspeção</h2>
      <form class="filtros" id="f-nova" style="margin:0">
        <label style="flex:1;min-width:200px">Quarto <select name="quarto_id" required><option value="">Selecione…</option>
          ${quartos.map((q) => html`<option value="${q.id}">${rede ? `${q.hotel_nome} — ` : ''}${q.numero}${q.inspecao_vencida ? ' (vencida)' : ''}</option>`)}</select></label>
        <button class="btn primario" type="submit">Iniciar</button>
      </form>
    </section>
    <div class="grade grade-2" style="margin-top:1rem">
      <section class="card">
        <h2>Agenda: vencidas e próximos 7 dias ${vencidas.length ? html`<span class="badge danger">${vencidas.length} vencida(s)</span>` : ''}</h2>
        ${agenda.length ? html`<ul class="lista-simples">${agenda.map((a) => html`<li style="display:flex;justify-content:space-between;gap:.5rem;align-items:center">
          <span><a href="#/quartos/${a.id}"><strong>Quarto ${a.numero}</strong></a>${rede ? html` <span class="muted small">· ${a.hotel_nome}</span>` : ''}<br>
            <span class="small ${a.vencida ? '' : 'muted'}" style="${a.vencida ? 'color:var(--danger);font-weight:600' : ''}">${a.vencida ? 'Vencida' : 'Prevista'} ${relativo(a.proxima_inspecao_em)} (${data(a.proxima_inspecao_em)})</span></span>
          ${a.inspecao_aberta ? html`<a class="btn pequeno" href="#/inspecoes/${a.inspecao_aberta}">Continuar</a>` : html`<button class="btn pequeno primario" data-iniciar="${a.id}">Inspecionar</button>`}</li>`)}</ul>`
          : html`<p class="vazio">Nenhuma inspeção vencida ou próxima.</p>`}
      </section>
      <section class="card">
        <h2>Inspeções realizadas</h2>
        <div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Quarto</th><th>Resultado</th><th>Pendências</th></tr></thead><tbody>
          ${inspecoes.map((i) => html`<tr class="clicavel" data-href="#/inspecoes/${i.id}"><td class="nowrap"><a href="#/inspecoes/${i.id}">${data(i.iniciada_em)}</a><br><span class="muted small">${i.inspetor_nome}</span></td>
            <td>${i.quarto_numero}${rede ? html`<br><span class="muted small">${i.hotel_nome}</span>` : ''}</td>
            <td>${i.status === 'concluida' ? html`${numero(i.pontuacao, 0)}%<br>${estrelas(i.estrelas)}` : html`<span class="badge info">Em andamento</span><br><span class="muted small">${i.sem_resposta} sem resposta</span>`}</td>
            <td>${i.pendencias ? html`<span class="badge warn">${i.pendencias}</span>` : html`<span class="badge ok">0</span>`}</td></tr>`)}</tbody></table></div>
      </section>
    </div>`);

  const iniciar = async (quartoId) => { const r = await post('/api/inspecoes', { quarto_id: quartoId }); location.hash = `#/inspecoes/${r.id}`; };
  $('#f-nova', el).addEventListener('submit', (e) => { e.preventDefault(); iniciar(e.target.quarto_id.value); });
  for (const b of $$('[data-iniciar]', el)) b.addEventListener('click', () => iniciar(b.dataset.iniciar));
  $('#filtros', el)?.addEventListener('change', (e) => { location.hash = `#/inspecoes${qs({ hotel_id: e.target.value })}`; });
  $('#programar', el)?.addEventListener('click', () => {
    const { el: m, fechar } = modal(html`<h2>Programar inspeções periódicas</h2><form class="form" id="f-prog">
      <label class="campo"><span>Unidade</span>${seletorHotel(query.hotel_id, { todos: false })}</label>
      <label class="campo"><span class="obrig">Periodicidade (dias)</span><input type="number" min="1" name="periodicidade_dias" value="30" required></label>
      <label class="campo"><span>Primeira inspeção em</span><input type="datetime-local" name="proxima_em"><small>Se vazio, calcula a partir da última inspeção de cada quarto.</small></label>
      <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Aplicar a todos os quartos</button></div></form>`.s);
    $('#f-prog', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await post('/api/quartos/programar-inspecao', dadosForm(e.target));
      fechar(); toast(`${r.atualizados} quarto(s) reprogramado(s).`); recarregar();
    });
  });
}
