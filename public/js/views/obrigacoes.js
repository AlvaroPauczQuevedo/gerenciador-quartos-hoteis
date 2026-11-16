import { estado, api, post, put, qs, ehRede, papel } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, $, $$, toast, opcoes, dadosForm, seletorHotel, modal, moeda } from '../ui.js';

const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const SITUACAO = {
  vencida: ['danger', 'Vencida'], vencendo: ['warn', 'Vence em breve'], sem_registro: ['warn', 'Sem data registrada'], em_dia: ['ok', 'Em dia'],
};

// dadosForm converte datas para ISO com horário; aqui as datas ficam como o usuário escolheu (AAAA-MM-DD).
const dadosObrigacao = (f) => ({ ...dadosForm(f), ...Object.fromEntries(['realizado_em', 'validade_ate', 'proxima_em'].filter((n) => f.elements[n]).map((n) => [n, f.elements[n].value])) });

const lerArquivo = (arquivo) => new Promise((resolve, reject) => {
  if (!arquivo) return resolve(null);
  if (arquivo.size > 10 * 1024 * 1024) return reject(new Error('O comprovante deve ter até 10 MB.'));
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
  r.readAsDataURL(arquivo);
});

export async function mostrar(el, _p, query) {
  const { itens, tipos } = await api(`/api/obrigacoes${qs({ hotel_id: query.hotel_id })}`);
  const gestor = papel('gerente', 'admin');
  const hotelForm = query.hotel_id || estado.usuario.hotel_id || estado.hoteis[0]?.id;
  const ativos = itens.filter((o) => o.ativo);
  const conta = (s) => ativos.filter((o) => o.situacao === s).length;
  const tiposNomes = Object.fromEntries(Object.entries(tipos).map(([k, v]) => [k, v.nome]));

  render(el, html`
    <div class="cabecalho"><div><h1>Obrigações legais e contratos</h1>
      <p class="sub">Vencimentos que não podem passar: PMOC, caixa d'água, extintores, Corpo de Bombeiros, elevadores e outros. Você é avisado 30 e 7 dias antes, e a diretoria é avisada se vencer.</p></div>
      ${gestor ? html`<div class="acoes-topo"><button class="btn" id="modelos">Criar lista padrão</button><button class="btn primario" id="nova">+ Nova obrigação</button></div>` : ''}</div>
    ${ehRede() ? html`<form class="filtros" id="filtros"><label>Unidade ${seletorHotel(query.hotel_id)}</label></form>` : ''}
    <div class="grade grade-3" style="margin-bottom:1rem">
      <section class="card"><span class="muted small">Vencidas</span><div class="kpi-valor" style="font-size:1.8rem;font-weight:700;${conta('vencida') ? 'color:var(--perigo,#b42318)' : ''}">${conta('vencida')}</div></section>
      <section class="card"><span class="muted small">Vencem em até 30 dias</span><div class="kpi-valor" style="font-size:1.8rem;font-weight:700">${conta('vencendo')}</div></section>
      <section class="card"><span class="muted small">Sem data registrada</span><div class="kpi-valor" style="font-size:1.8rem;font-weight:700">${conta('sem_registro')}</div></section>
    </div>
    <section class="card">${itens.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Obrigação</th>${ehRede() ? html`<th>Hotel</th>` : ''}<th>Periodicidade</th><th>Última realização</th><th>Vencimento</th><th>Situação</th><th></th></tr></thead><tbody>
      ${itens.map((o) => html`<tr style="${o.ativo ? '' : 'opacity:.55'}"><td><strong>${o.nome}</strong>${o.fornecedor ? html`<br><span class="muted small">${o.fornecedor}</span>` : ''}</td>
        ${ehRede() ? html`<td>${o.hotel_nome}</td>` : ''}
        <td>a cada ${o.periodicidade_dias} dias</td><td class="nowrap">${dataBr(o.ultima_em)}</td>
        <td class="nowrap">${dataBr(o.proxima_em)}${o.dias != null ? html`<br><span class="muted small">${o.dias < 0 ? `há ${-o.dias} dia(s)` : o.dias === 0 ? 'hoje' : `em ${o.dias} dia(s)`}</span>` : ''}</td>
        <td>${o.ativo ? html`<span class="badge ${SITUACAO[o.situacao][0]}">${SITUACAO[o.situacao][1]}</span>` : html`<span class="badge sem-ponto">Desativada</span>`}</td>
        <td class="nowrap">${gestor && o.ativo ? html`<button class="btn pequeno primario" data-registrar="${o.id}">Registrar realização</button> ` : ''}
          <button class="btn pequeno" data-historico="${o.id}" data-nome="${o.nome}">Histórico (${o.registros})</button>
          ${gestor ? html` <button class="btn pequeno" data-editar="${o.id}">Editar</button>` : ''}</td></tr>`)}
      </tbody></table></div>` : html`<p class="vazio">Nenhuma obrigação cadastrada${gestor ? '. Use "Criar lista padrão" para começar com as mais comuns e depois informe a data da última realização de cada uma.' : '.'}</p>`}
    </section>
    <p class="small muted">As periodicidades da lista padrão são sugestões. Confirme com o engenheiro responsável e a legislação do seu município e ajuste em "Editar".</p>`);

  $('#filtros', el)?.addEventListener('change', (e) => { location.hash = `#/obrigacoes${qs({ hotel_id: e.target.value })}`; });

  $('#modelos', el)?.addEventListener('click', async () => {
    try {
      const r = await post('/api/obrigacoes/modelos', { hotel_id: hotelForm });
      toast(r.criadas ? `${r.criadas} obrigações criadas. Agora informe a última realização de cada uma.` : 'A lista padrão já está completa.');
      recarregar();
    } catch (e) { toast(e.message, 'erro'); }
  });

  $('#nova', el)?.addEventListener('click', () => {
    const { el: m, fechar } = modal(html`<h2>Nova obrigação</h2>
      <form class="form" id="f-obr">
        ${ehRede() ? html`<label class="campo"><span class="obrig">Hotel</span>${seletorHotel(hotelForm, { todos: false })}</label>` : html`<input type="hidden" name="hotel_id" value="${hotelForm}">`}
        <div class="form-grade">
          <label class="campo"><span class="obrig">Tipo</span><select name="tipo" required>${opcoes(tiposNomes, 'outro')}</select></label>
          <label class="campo"><span>Nome (se vazio, usa o do tipo)</span><input name="nome" maxlength="120"></label>
          <label class="campo"><span class="obrig">Periodicidade (dias)</span><input type="number" name="periodicidade_dias" min="1" max="3650" value="365" required></label>
          <label class="campo"><span>Próximo vencimento (se já souber)</span><input type="date" name="proxima_em"></label>
          <label class="campo"><span>Empresa responsável</span><input name="fornecedor" maxlength="120"></label>
        </div>
        <label class="campo"><span>Observações</span><textarea name="observacoes" rows="2"></textarea></label>
        <div class="aviso danger" id="erro-obr" hidden></div>
        <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Cadastrar</button></div>
      </form>`.s);
    const f = $('#f-obr', m);
    f.elements.tipo.addEventListener('change', () => { f.elements.periodicidade_dias.value = tipos[f.elements.tipo.value].dias; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await post('/api/obrigacoes', dadosObrigacao(f)); fechar(); toast('Obrigação cadastrada.'); recarregar(); } catch (err) { const x = $('#erro-obr', m); x.textContent = err.message; x.hidden = false; }
    });
  });

  for (const b of $$('[data-registrar]', el)) {
    b.addEventListener('click', () => {
      const o = itens.find((x) => String(x.id) === b.dataset.registrar);
      const { el: m, fechar } = modal(html`<h2>Registrar realização</h2><p><strong>${o.nome}</strong></p>
        <form class="form" id="f-reg">
          <div class="form-grade">
            <label class="campo"><span class="obrig">Data em que foi feito</span><input type="date" name="realizado_em" value="${hoje()}" max="${hoje()}" required></label>
            <label class="campo"><span>Validade informada no comprovante</span><input type="date" name="validade_ate"><small>Se vazio, o próximo vencimento é a data acima + ${o.periodicidade_dias} dias.</small></label>
            <label class="campo"><span>Empresa</span><input name="fornecedor" value="${o.fornecedor || ''}" maxlength="120"></label>
            <label class="campo"><span>Custo (R$)</span><input type="number" name="custo" min="0" step="0.01"></label>
          </div>
          <label class="campo"><span>Observações</span><textarea name="observacao" rows="2"></textarea></label>
          <label class="campo"><span>Comprovante (foto ou PDF, até 10 MB)</span><input type="file" name="comprovante" accept="image/*,application/pdf"></label>
          <div class="aviso danger" id="erro-reg" hidden></div>
          <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Salvar registro</button></div>
        </form>`.s);
      const f = $('#f-reg', m);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const botao = f.querySelector('[type=submit]'); botao.disabled = true;
        try {
          const d = dadosObrigacao(f);
          d.comprovante = await lerArquivo(f.elements.comprovante.files[0]);
          const r = await post(`/api/obrigacoes/${o.id}/registrar`, d);
          fechar(); toast(`Registrado. Próximo vencimento: ${dataBr(r.proxima_em)}.`); recarregar();
        } catch (err) { const x = $('#erro-reg', m); x.textContent = err.message; x.hidden = false; botao.disabled = false; }
      });
    });
  }

  for (const b of $$('[data-historico]', el)) {
    b.addEventListener('click', async () => {
      const lista = await api(`/api/obrigacoes/${b.dataset.historico}/historico`);
      modal(html`<h2>Histórico</h2><p><strong>${b.dataset.nome}</strong></p>
        ${lista.length ? html`<div class="tabela-wrap"><table><thead><tr><th>Realizado em</th><th>Validade</th><th>Empresa</th><th class="num">Custo</th><th>Registrado por</th><th>Comprovante</th></tr></thead><tbody>
          ${lista.map((r) => html`<tr><td class="nowrap">${dataBr(r.realizado_em)}</td><td class="nowrap">${dataBr(r.validade_ate)}</td><td>${r.fornecedor || '—'}</td>
            <td class="num">${r.custo != null ? moeda(r.custo) : '—'}</td><td>${r.usuario_nome || '—'}</td>
            <td>${r.arquivo ? html`<a href="/uploads/${r.arquivo}" target="_blank" rel="noopener">${r.mime === 'application/pdf' ? 'Abrir PDF' : 'Ver foto'}</a>` : '—'}</td></tr>
            ${r.observacao ? html`<tr><td></td><td colspan="5" class="small muted">${r.observacao}</td></tr>` : ''}`)}</tbody></table></div>` : html`<p class="vazio">Nenhuma realização registrada ainda.</p>`}
        <div class="rodape-modal"><button class="btn" data-fechar>Fechar</button></div>`.s, { grande: true });
    });
  }

  for (const b of $$('[data-editar]', el)) {
    b.addEventListener('click', () => {
      const o = itens.find((x) => String(x.id) === b.dataset.editar);
      const { el: m, fechar } = modal(html`<h2>Editar obrigação</h2>
        <form class="form" id="f-edit">
          <label class="campo"><span class="obrig">Nome</span><input name="nome" value="${o.nome}" required maxlength="120"></label>
          <div class="form-grade">
            <label class="campo"><span class="obrig">Periodicidade (dias)</span><input type="number" name="periodicidade_dias" min="1" max="3650" value="${o.periodicidade_dias}" required></label>
            <label class="campo"><span>Próximo vencimento</span><input type="date" name="proxima_em" value="${o.proxima_em || ''}"></label>
            <label class="campo"><span>Empresa responsável</span><input name="fornecedor" value="${o.fornecedor || ''}" maxlength="120"></label>
          </div>
          <label class="campo"><span>Observações</span><textarea name="observacoes" rows="2">${o.observacoes || ''}</textarea></label>
          <label class="check"><input type="checkbox" name="ativo" ${o.ativo ? 'checked' : ''}> Acompanhar esta obrigação (desmarque se o hotel não tem, ex.: elevador)</label>
          <div class="aviso danger" id="erro-edit" hidden></div>
          <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button>
            ${o.registros ? '' : html`<button type="button" class="btn perigo" id="excluir-obr">Excluir</button>`}<button class="btn primario" type="submit">Salvar</button></div>
        </form>`.s);
      const f = $('#f-edit', m);
      const erro = (err) => { const x = $('#erro-edit', m); x.textContent = err.message; x.hidden = false; };
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = dadosObrigacao(f);
        try { await put(`/api/obrigacoes/${o.id}`, { ...d, ativo: f.elements.ativo.checked }); fechar(); toast('Obrigação salva.'); recarregar(); } catch (err) { erro(err); }
      });
      $('#excluir-obr', m)?.addEventListener('click', async () => {
        try { await post(`/api/obrigacoes/${o.id}/excluir`); fechar(); toast('Obrigação excluída.'); recarregar(); } catch (err) { erro(err); }
      });
    });
  }
}
