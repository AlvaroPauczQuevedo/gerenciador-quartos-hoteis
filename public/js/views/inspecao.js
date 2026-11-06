import { estado, api, post, put } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, $, modal, toast, opcoes, dadosForm, prepararArquivo, galeria, estrelas, dataHora, numero, badgeStatus } from '../ui.js';

const CLASSE = { conforme: 'conforme', atencao: 'atencao', manutencao: 'manutencao', na: 'na' };

export async function mostrar(el, [id]) {
  const ins = await api(`/api/inspecoes/${id}`);
  const M = estado.meta;
  const aberta = ins.status === 'em_andamento';
  const ambientes = [...new Set(ins.itens.map((i) => i.ambiente))];

  const itemHtml = (it) => html`<div class="item-insp ${it.resposta ? `r-${CLASSE[it.resposta]}` : ''}" data-item="${it.id}">
    <div class="linha"><div><strong>${it.item}</strong>${it.equipamento_tipo && it.equipamento_tipo !== it.item ? html` <span class="muted small">· ${it.equipamento_tipo}</span>` : ''}
      <br>${it.critico ? html`<span class="badge danger sem-ponto" title="Necessário para o funcionamento e a venda do quarto">Básico p/ venda</span> ` : ''}<span class="muted small">${M.CATEGORIAS[it.categoria]}</span></div>
      ${aberta ? html`<div class="respostas" role="group" aria-label="Resposta">${Object.entries(M.RESPOSTAS_INSPECAO).map(([k, v]) => html`<button type="button" data-resp="${k}" class="${it.resposta === k ? `sel-${k}` : ''}" aria-pressed="${it.resposta === k}">${v}</button>`)}</div>`
        : html`<span class="badge ${{ conforme: 'ok', atencao: 'warn', manutencao: 'danger' }[it.resposta] || ''}">${M.RESPOSTAS_INSPECAO[it.resposta] || 'Sem resposta'}</span>`}
    </div>
    ${(it.resposta && it.resposta !== 'conforme') || it.observacao || it.fotos.length || it.os_id ? html`<div class="extra">
      ${aberta ? html`<textarea data-obs rows="2" placeholder="Observações sobre o item">${it.observacao || ''}</textarea>` : it.observacao ? html`<p class="small pre" style="margin:0">${it.observacao}</p>` : ''}
      ${it.fotos.length ? galeria(it.fotos, { mostrarFase: false }) : ''}
      <div class="acoes-topo">
        ${aberta ? html`<label class="btn pequeno">📷 Foto<input type="file" accept="image/*,video/*" capture="environment" data-foto hidden multiple></label>` : ''}
        ${it.os_id ? html`<a class="btn pequeno" href="#/os/${it.os_id}">OS ${it.os_protocolo}</a> ${badgeStatus(it.os_status)}`
          : ['atencao', 'manutencao'].includes(it.resposta) ? html`<button type="button" class="btn pequeno primario" data-gerar>Gerar solicitação de manutenção</button>` : ''}
        ${['atencao', 'manutencao'].includes(it.resposta) && !it.cronico_id ? html`<button type="button" class="btn pequeno" data-cronico>Registrar problema crônico</button>` : ''}
        ${it.cronico_id ? html`<span class="badge warn">Problema crônico registrado</span>` : ''}
      </div></div>` : ''}
  </div>`;

  const progresso = () => {
    const resp = ins.itens.filter((i) => i.resposta).length;
    return html`<strong>${resp}/${ins.itens.length}</strong> itens respondidos${ins.parcial.pontuacao != null ? html` · conformidade parcial ${numero(ins.parcial.pontuacao, 0)}% ${estrelas(ins.parcial.estrelas)}` : ''}`;
  };

  render(el, html`
    <div class="cabecalho">
      <div><p class="sub"><a href="#/inspecoes">← Inspeções</a></p>
        <h1>Inspeção · Quarto <a href="#/quartos/${ins.quarto_id}">${ins.quarto_numero}</a></h1>
        <p class="sub">${ins.hotel_nome} · ${ins.inspetor_nome} · iniciada ${dataHora(ins.iniciada_em)}${ins.concluida_em ? ` · concluída ${dataHora(ins.concluida_em)}` : ''}</p></div>
      ${!aberta ? html`<div class="kpi bom"><div class="rotulo">Resultado</div><div class="valor">${numero(ins.pontuacao, 0)}%</div><div>${estrelas(ins.estrelas)}</div></div>` : ''}
    </div>
    ${aberta ? html`<div class="aviso info" style="position:sticky;top:calc(env(safe-area-inset-top, 0px) + .5rem);z-index:5"><span class="icone">✓</span><div id="progresso">${progresso()}</div></div>` : ''}
    ${ins.observacoes ? html`<div class="card"><strong>Observações gerais:</strong> ${ins.observacoes}</div>` : ''}
    ${ins.fotos_padrao.length ? html`<details class="card" style="margin-top:1rem" ${aberta ? 'open' : ''}><summary style="cursor:pointer"><strong>Padrão do quarto</strong> <span class="muted small">(${ins.fotos_padrao.length} foto(s) de referência — compare com o estado atual)</span></summary>
      <div style="margin-top:.75rem">${galeria(ins.fotos_padrao, { mostrarFase: false })}</div></details>` : ''}
    <div id="itens">${ambientes.map((a) => html`<div class="ambiente"><h3>${a}</h3>${ins.itens.filter((i) => i.ambiente === a).map(itemHtml)}</div>`)}</div>
    ${aberta ? html`<section class="card" style="margin-top:1rem"><h2>Concluir inspeção</h2><form class="form" id="f-concluir">
      <label class="campo"><span>Observações gerais</span><textarea name="observacoes" rows="2"></textarea></label>
      <label class="check"><input type="checkbox" name="gerar_os_automaticas" checked> ${ins.itens.some((i) => i.critico)
        ? 'Automático: itens básicos com "Necessita de manutenção" viram OS e bloqueiam o quarto; itens crônicos com pendência viram problema crônico'
        : 'Gerar automaticamente solicitações para itens "Necessita de manutenção" ainda sem OS'}</label>
      <div class="aviso danger" id="erro" hidden></div>
      <div><button class="btn sucesso" type="submit">Concluir e calcular classificação</button></div></form></section>` : ''}`);

  const acharItem = (no) => ins.itens.find((i) => String(i.id) === no.closest('[data-item]').dataset.item);
  const redesenhar = (it) => {
    const no = $(`[data-item="${it.id}"]`, el);
    no.outerHTML = itemHtml(it).s;
    if ($('#progresso', el)) $('#progresso', el).innerHTML = progresso().s;
  };
  const recalcular = () => {
    const peso = { conforme: 1, atencao: 0.5, manutencao: 0 };
    const ap = ins.itens.filter((i) => i.resposta && i.resposta !== 'na');
    const p = ap.length ? (ap.reduce((s, i) => s + peso[i.resposta], 0) / ap.length) * 100 : null;
    ins.parcial = { pontuacao: p, estrelas: p == null ? null : p >= 95 ? 5 : p >= 85 ? 4 : p >= 70 ? 3 : p >= 50 ? 2 : 1 };
  };

  $('#itens', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-resp]');
    if (b) {
      const it = acharItem(b);
      it.resposta = b.dataset.resp;
      try { await put(`/api/inspecoes/itens/${it.id}`, { resposta: it.resposta, observacao: it.observacao }); } catch (err) { toast(err.message, 'erro'); return; }
      recalcular();
      redesenhar(it);
      if (it.resposta !== 'conforme' && it.resposta !== 'na') $(`[data-item="${it.id}"] [data-obs]`, el)?.focus();
      return;
    }
    if (e.target.closest('[data-gerar]')) {
      const it = acharItem(e.target);
      const { el: m, fechar } = modal(html`<h2>Gerar solicitação de manutenção</h2>
        <p class="small">${it.ambiente}: <strong>${it.item}</strong> — ${M.RESPOSTAS_INSPECAO[it.resposta]}. Quarto, local, categoria, descrição e fotos são aproveitados da inspeção. Se já houver OS aberta para o mesmo problema, o item será vinculado a ela.</p>
        <form class="form" id="f-g">
          ${it.critico ? html`<div class="aviso warn"><span class="icone">!</span><div>Item básico para funcionamento e venda: sem ele o quarto não deve ser comercializado.</div></div>`
            : html`<div class="aviso info"><span class="icone">i</span><div>Item crônico — depende de ocupação/budget. Se não for urgente, prefira "Registrar problema crônico".</div></div>`}
          <label class="campo"><span>Prioridade</span><select name="prioridade">${opcoes(M.PRIORIDADES, it.critico ? (it.resposta === 'manutencao' ? 'alta' : 'media') : (it.resposta === 'manutencao' ? 'media' : 'baixa'))}</select></label>
          <label class="campo"><span>Complemento da descrição</span><textarea name="descricao" rows="2"></textarea></label>
          <label class="check"><input type="checkbox" name="bloqueio_quarto" ${it.critico && it.resposta === 'manutencao' ? 'checked' : ''}> Bloquear o quarto para comercialização</label>
          <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Gerar</button></div></form>`.s);
      $('#f-g', m).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try {
          const r = await post(`/api/inspecoes/itens/${it.id}/gerar-os`, dadosForm(ev.target));
          fechar();
          toast(r.vinculada ? `Item vinculado à OS já aberta ${r.protocolo}.` : `Solicitação ${r.protocolo} gerada.`);
          recarregar();
        } catch (err) { toast(err.message, 'erro'); }
      });
      return;
    }
    if (e.target.closest('[data-cronico]')) {
      const it = acharItem(e.target);
      const { el: m, fechar } = modal(html`<h2>Registrar problema crônico</h2><p class="small">Use para desgaste persistente sem urgência imediata. O problema fica visível no quarto e nos relatórios.</p>
        <form class="form" id="f-c"><label class="campo"><span>Descrição</span><textarea name="descricao">${it.ambiente}: ${it.item} — ${it.observacao || 'desgaste identificado em inspeção.'}</textarea></label>
        <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Registrar</button></div></form>`.s);
      $('#f-c', m).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        await post(`/api/inspecoes/itens/${it.id}/cronico`, dadosForm(ev.target));
        fechar(); toast('Problema crônico registrado.'); recarregar();
      });
    }
  });
  $('#itens', el).addEventListener('focusout', async (e) => {
    if (!e.target.matches('[data-obs]')) return;
    const it = acharItem(e.target);
    if ((it.observacao || '') === e.target.value) return;
    it.observacao = e.target.value;
    if (it.resposta) await put(`/api/inspecoes/itens/${it.id}`, { resposta: it.resposta, observacao: it.observacao });
  });
  $('#itens', el).addEventListener('change', async (e) => {
    if (!e.target.matches('[data-foto]')) return;
    const it = acharItem(e.target);
    for (const f of e.target.files) {
      try {
        const p = await prepararArquivo(f);
        await post('/api/fotos', { arquivo: p.arquivo, inspecao_item_id: it.id, fase: 'inspecao' });
      } catch (err) { toast(err.message, 'erro'); }
    }
    const atual = await api(`/api/inspecoes/${ins.id}`);
    it.fotos = atual.itens.find((x) => x.id === it.id).fotos;
    redesenhar(it);
    toast('Foto anexada.');
  });
  $('#f-concluir', el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Garante que a observação em edição seja salva antes de concluir.
    document.activeElement?.blur?.();
    try {
      const r = await post(`/api/inspecoes/${ins.id}/concluir`, dadosForm(e.target));
      toast(`Inspeção concluída: ${numero(r.pontuacao, 0)}% (${r.estrelas} estrela(s)).${r.geradas.length ? ` ${r.geradas.length} solicitação(ões) gerada(s).` : ''}${r.cronicos ? ` ${r.cronicos} problema(s) crônico(s) registrado(s).` : ''}`);
      recarregar();
    } catch (err) { const x = $('#erro', el); x.textContent = err.message; x.hidden = false; }
  });
}
