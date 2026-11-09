import { estado, api, post, put, qs, ehRede } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, $, $$, toast, opcoes, dadosForm, seletorHotel, data, modal, paraInputData } from '../ui.js';

const SUGESTOES = [
  { nome: 'Limpeza dos filtros do ar-condicionado', categoria: 'ar_condicionado', equipamento: 'Ar-condicionado', periodicidade_dias: 90 },
  { nome: 'Revisão do frigobar (borracha da porta e temperatura)', categoria: 'equipamentos', equipamento: 'Frigobar', periodicidade_dias: 180 },
  { nome: 'Troca da pilha da fechadura eletrônica', categoria: 'fechaduras_portas', equipamento: 'Fechadura eletrônica', periodicidade_dias: 180 },
  { nome: 'Revisão de rejuntes e vedação do box', categoria: 'alvenaria', periodicidade_dias: 120 },
  { nome: 'Limpeza de ralos e sifões', categoria: 'hidraulica', periodicidade_dias: 60 },
];

export async function mostrar(el, _p, query) {
  const M = estado.meta;
  const { planos, proximas } = await api(`/api/preventiva${qs({ hotel_id: query.hotel_id })}`);
  const hotelForm = query.hotel_id || estado.usuario.hotel_id || estado.hoteis[0]?.id;

  render(el, html`
    <div class="cabecalho"><div><h1>Manutenção preventiva</h1>
      <p class="sub">Planos recorrentes que geram as ordens de serviço sozinhos. As datas dos quartos são distribuídas ao longo do período, e uma nova OS só é criada quando a anterior foi encerrada.</p></div>
      <div class="acoes-topo"><button class="btn primario" id="novo-plano">+ Novo plano</button></div></div>
    ${ehRede() ? html`<form class="filtros" id="filtros"><label>Unidade ${seletorHotel(query.hotel_id)}</label></form>` : ''}
    <section class="card"><h2>Planos</h2>
      ${planos.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Plano</th>${ehRede() ? html`<th>Hotel</th>` : ''}<th>Periodicidade</th><th>Alcance</th>
        <th>Próxima</th><th class="num">OS abertas</th><th class="num">Concluídas</th><th>Situação</th><th></th></tr></thead><tbody>
        ${planos.map((p) => html`<tr style="${p.ativo ? '' : 'opacity:.6'}"><td><strong>${p.nome}</strong><br><span class="muted small">${M.CATEGORIAS[p.categoria]}${p.equipamento ? ` · ${p.equipamento}` : ''} · prioridade ${M.PRIORIDADES[p.prioridade].toLowerCase()}</span></td>
          ${ehRede() ? html`<td>${p.hotel_nome}</td>` : ''}
          <td>a cada ${p.periodicidade_dias} dias</td>
          <td>${p.escopo === 'area' ? M.LOCAIS[p.local] : `${p.alvos} quartos`}</td>
          <td class="nowrap">${data(p.proxima_em)}${p.vencidas ? html`<br><span class="badge warn sem-ponto">${p.vencidas} vencendo</span>` : ''}</td>
          <td class="num"><a href="#/os?busca=${encodeURIComponent('Preventiva')}">${p.os_abertas}</a></td><td class="num">${p.os_encerradas}</td>
          <td>${p.ativo ? html`<span class="badge ok">Ativo</span>` : html`<span class="badge sem-ponto">Pausado</span>`}</td>
          <td class="nowrap"><button class="btn pequeno" data-alternar="${p.id}" data-ativo="${p.ativo}">${p.ativo ? 'Pausar' : 'Retomar'}</button>
            <button class="btn pequeno perigo" data-excluir="${p.id}" data-nome="${p.nome}">Excluir</button></td></tr>`)}</tbody></table></div>`
        : html`<p class="vazio">Nenhum plano cadastrado. Comece pelos sugeridos em "+ Novo plano".</p>`}
    </section>
    <section class="card"><h2>Próximos 30 dias</h2>
      ${proximas.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Plano</th><th>Quarto</th>${ehRede() ? html`<th>Hotel</th>` : ''}</tr></thead><tbody>
        ${proximas.map((a) => html`<tr><td class="nowrap">${data(a.proxima_em)}</td><td>${a.plano}</td><td>${a.quarto_id ? html`<a href="#/quartos/${a.quarto_id}">${a.quarto_numero}</a>` : 'Área comum'}</td>${ehRede() ? html`<td>${a.hotel_nome}</td>` : ''}</tr>`)}
        </tbody></table></div>${proximas.length === 200 ? html`<p class="small muted">Mostrando as 200 primeiras.</p>` : ''}`
        : html`<p class="vazio">Nada programado para os próximos 30 dias.</p>`}
    </section>`);

  $('#filtros', el)?.addEventListener('change', (e) => { location.hash = `#/preventiva${qs({ hotel_id: e.target.value })}`; });
  for (const b of $$('[data-alternar]', el)) {
    b.addEventListener('click', async () => { await put(`/api/preventiva/${b.dataset.alternar}`, { ativo: b.dataset.ativo !== '1' }); recarregar(); });
  }
  for (const b of $$('[data-excluir]', el)) {
    b.addEventListener('click', () => {
      const { el: m, fechar } = modal(html`<h2>Excluir plano</h2><p><strong>${b.dataset.nome}</strong></p>
        <p class="small">A programação deixa de existir. As ordens de serviço já geradas continuam no histórico. Para só interromper por um tempo, use "Pausar".</p>
        <div class="rodape-modal"><button class="btn" data-fechar>Cancelar</button><button class="btn perigo" id="confirmar">Excluir plano</button></div>`.s);
      $('#confirmar', m).addEventListener('click', async () => { await post(`/api/preventiva/${b.dataset.excluir}/excluir`); fechar(); toast('Plano excluído.'); recarregar(); });
    });
  }
  $('#novo-plano', el).addEventListener('click', () => {
    const { el: m, fechar } = modal(html`<h2>Novo plano de preventiva</h2>
      <p class="small muted">Sugestões: ${SUGESTOES.map((s, i) => html`<button type="button" class="btn pequeno" data-sugestao="${i}" style="margin:.15rem">${s.nome}</button>`)}</p>
      <form class="form" id="f-plano">
        ${ehRede() ? html`<label class="campo"><span class="obrig">Hotel</span>${seletorHotel(hotelForm, { todos: false })}</label>` : html`<input type="hidden" name="hotel_id" value="${hotelForm}">`}
        <label class="campo"><span class="obrig">Nome</span><input name="nome" required></label>
        <div class="form-grade">
          <label class="campo"><span class="obrig">Categoria</span><select name="categoria" required>${opcoes(M.CATEGORIAS, '', { vazio: 'Selecione…' })}</select></label>
          <label class="campo"><span>Equipamento</span><select name="equipamento"><option value="">—</option>${M.EQUIPAMENTOS_PADRAO.concat(['Telefone (ramal)', 'Campainha', 'Fechadura eletrônica', 'Economizador de energia']).filter((v, i, a) => a.indexOf(v) === i).map((e) => html`<option>${e}</option>`)}</select></label>
          <label class="campo"><span class="obrig">A cada (dias)</span><input type="number" name="periodicidade_dias" min="7" max="730" value="90" required></label>
          <label class="campo"><span>Prioridade</span><select name="prioridade">${opcoes({ baixa: 'Baixa', media: 'Média', alta: 'Alta' }, 'baixa')}</select></label>
          <label class="campo"><span>Alcance</span><select name="escopo"><option value="quartos">Todos os quartos do hotel</option><option value="area">Uma área comum</option></select></label>
          <label class="campo"><span>Local</span><select name="local">${opcoes(M.LOCAIS, 'quarto')}</select></label>
          <label class="campo"><span>Começar em</span><input type="datetime-local" name="inicio_em" value="${paraInputData(new Date().toISOString())}"></label>
        </div>
        <label class="campo"><span>O que fazer (vai na descrição das OS)</span><textarea name="descricao" rows="3" placeholder="Ex.: retirar e lavar os filtros, limpar a bandeja de condensado, testar a drenagem."></textarea></label>
        <div class="aviso danger" id="erro-plano" hidden></div>
        <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Criar plano</button></div>
      </form>`.s, { grande: true });
    const f = $('#f-plano', m);
    for (const b of $$('[data-sugestao]', m)) {
      b.addEventListener('click', () => {
        const s = SUGESTOES[Number(b.dataset.sugestao)];
        f.nome.value = s.nome; f.categoria.value = s.categoria; f.equipamento.value = s.equipamento || ''; f.periodicidade_dias.value = s.periodicidade_dias;
      });
    }
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await post('/api/preventiva', dadosForm(f)); fechar(); toast('Plano criado. As OS serão geradas conforme as datas.'); recarregar(); }
      catch (err) { const x = $('#erro-plano', m); x.textContent = err.message; x.hidden = false; }
    });
  });
}
