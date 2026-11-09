import { estado, api, post, qs, ehRede } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, $, $$, toast, dadosForm, seletorHotel, dataHora, moeda, numero, modal } from '../ui.js';

export async function mostrar(el, _p, query) {
  const itens = await api(`/api/estoque${qs({ hotel_id: query.hotel_id })}`);
  const hotelForm = query.hotel_id || estado.usuario.hotel_id || estado.hoteis[0]?.id;
  const baixos = itens.filter((i) => i.abaixo_minimo);
  const valorTotal = itens.reduce((s, i) => s + i.quantidade * i.custo_unitario, 0);

  render(el, html`
    <div class="cabecalho"><div><h1>Estoque de materiais</h1>
      <p class="sub">${itens.length} material(is) · valor em estoque ${moeda(valorTotal)}. A saída é feita dentro da OS ("Usar material do estoque"), que já lança o custo.</p></div>
      <div class="acoes-topo"><button class="btn primario" id="novo-item">+ Novo material</button></div></div>
    ${ehRede() ? html`<form class="filtros" id="filtros"><label>Unidade ${seletorHotel(query.hotel_id)}</label></form>` : ''}
    ${baixos.length ? html`<div class="aviso warn" style="margin-bottom:1rem"><span class="icone">!</span><div><strong>${baixos.length} material(is) no mínimo ou abaixo:</strong> ${baixos.map((i) => i.nome).join(', ')}.</div></div>` : ''}
    <section class="card">${itens.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Material</th>${ehRede() ? html`<th>Hotel</th>` : ''}<th class="num">Saldo</th><th class="num">Mínimo</th>
      <th class="num">Custo médio</th><th>Fornecedor</th><th></th></tr></thead><tbody>
      ${itens.map((i) => html`<tr><td><strong>${i.nome}</strong>${i.abaixo_minimo ? html` <span class="badge warn">repor</span>` : ''}</td>${ehRede() ? html`<td>${i.hotel_nome}</td>` : ''}
        <td class="num"><strong>${numero(i.quantidade, 2)}</strong> ${i.unidade}</td><td class="num">${numero(i.minimo, 2)}</td><td class="num">${moeda(i.custo_unitario)}</td><td>${i.fornecedor || '—'}</td>
        <td class="nowrap"><button class="btn pequeno primario" data-mov="entrada" data-id="${i.id}" data-nome="${i.nome}" data-un="${i.unidade}">+ Entrada</button>
          <button class="btn pequeno" data-mov="ajuste" data-id="${i.id}" data-nome="${i.nome}" data-un="${i.unidade}">Inventário</button>
          <button class="btn pequeno" data-hist="${i.id}" data-nome="${i.nome}">Histórico</button></td></tr>`)}</tbody></table></div>`
      : html`<p class="vazio">Nenhum material cadastrado.</p>`}</section>`);

  $('#filtros', el)?.addEventListener('change', (e) => { location.hash = `#/estoque${qs({ hotel_id: e.target.value })}`; });
  const formModal = (titulo, corpo, url, msg) => {
    const { el: m, fechar } = modal(html`<h2>${titulo}</h2><form class="form" id="f-est">${corpo}
      <div class="aviso danger" id="erro-est" hidden></div>
      <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Salvar</button></div></form>`.s);
    $('#f-est', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await post(url, dadosForm(e.target)); fechar(); toast(msg); recarregar(); } catch (err) { const x = $('#erro-est', m); x.textContent = err.message; x.hidden = false; }
    });
  };
  $('#novo-item', el).addEventListener('click', () => formModal('Novo material', html`
    ${ehRede() ? html`<label class="campo"><span class="obrig">Hotel</span>${seletorHotel(hotelForm, { todos: false })}</label>` : html`<input type="hidden" name="hotel_id" value="${hotelForm}">`}
    <div class="form-grade"><label class="campo"><span class="obrig">Nome</span><input name="nome" required placeholder="Ex.: Lâmpada LED 9W"></label>
    <label class="campo"><span>Unidade</span><input name="unidade" value="un" placeholder="un, m, kg, L…"></label>
    <label class="campo"><span>Estoque mínimo</span><input type="number" step="any" min="0" name="minimo" value="0"></label>
    <label class="campo"><span>Fornecedor</span><input name="fornecedor"></label></div>
    <p class="small muted">Depois de cadastrar, registre a primeira entrada com a quantidade e o custo.</p>`, '/api/estoque', 'Material cadastrado.'));
  for (const b of $$('[data-mov]', el)) {
    b.addEventListener('click', () => {
      const entrada = b.dataset.mov === 'entrada';
      formModal(`${entrada ? 'Entrada' : 'Inventário'} — ${b.dataset.nome}`, html`<input type="hidden" name="tipo" value="${b.dataset.mov}">
        <div class="form-grade"><label class="campo"><span class="obrig">${entrada ? 'Quantidade recebida' : 'Quantidade contada'} (${b.dataset.un})</span><input type="number" step="any" min="0" name="quantidade" required></label>
        ${entrada ? html`<label class="campo"><span>Custo unitário (R$)</span><input type="number" step="0.01" min="0" name="custo_unitario"></label>
        <label class="campo"><span>Fornecedor</span><input name="fornecedor"></label>` : ''}</div>
        <label class="campo"><span class="${entrada ? '' : 'obrig'}">${entrada ? 'Observação (nota fiscal, pedido…)' : 'Motivo do ajuste'}</span><input name="observacao" ${entrada ? '' : 'required'}></label>`,
      `/api/estoque/${b.dataset.id}/movimentar`, entrada ? 'Entrada registrada.' : 'Inventário ajustado.');
    });
  }
  for (const b of $$('[data-hist]', el)) {
    b.addEventListener('click', async () => {
      const movs = await api(`/api/estoque/${b.dataset.hist}/movimentos`);
      modal(html`<h2>Histórico — ${b.dataset.nome}</h2>${movs.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th class="num">Qtd.</th><th>OS / observação</th><th>Por</th></tr></thead><tbody>
        ${movs.map((mv) => html`<tr><td class="nowrap">${dataHora(mv.criado_em)}</td><td>${{ entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste' }[mv.tipo]}</td>
          <td class="num">${mv.tipo === 'saida' ? '−' : mv.quantidade > 0 ? '+' : ''}${numero(Math.abs(mv.quantidade), 2)}</td>
          <td>${mv.protocolo ? html`<a href="#/os/${mv.os_id}">${mv.protocolo}</a>` : mv.observacao || '—'}${mv.fornecedor ? html`<br><span class="muted small">${mv.fornecedor}</span>` : ''}</td><td>${mv.usuario_nome || '—'}</td></tr>`)}
        </tbody></table></div>` : html`<p class="vazio">Sem movimentações.</p>`}<div class="rodape-modal"><button class="btn" data-fechar>Fechar</button></div>`.s, { grande: true });
    });
  }
}
