import { estado, api, post, put, papel } from '../estado.js';
import { recarregar } from '../app.js';
import {
  html, render, $, $$, modal, toast, opcoes, dadosForm, galeria, campoUpload, estrelas, badgeComercial, badgeStatus, badgePrioridade,
  data, dataHora, moeda, paraInputData, numero,
} from '../ui.js';
import { kpi } from './componentes.js';

const TIPO_HIST = { manutencao: 'Manutenção', inspecao: 'Inspeção', bloqueio: 'Bloqueio', liberacao: 'Liberação', cronico: 'Problema crônico', avaliacao: 'Avaliação de hóspede' };

function formModal(titulo, corpo, enviar) {
  const { el, fechar } = modal(html`<h2>${titulo}</h2><form class="form" id="f-m">${corpo}
    <div class="aviso danger" id="erro-m" hidden></div>
    <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Confirmar</button></div></form>`.s);
  $('#f-m', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await enviar(dadosForm(e.target)); fechar(); recarregar(); } catch (err) { const x = $('#erro-m', el); x.textContent = err.message; x.hidden = false; }
  });
}

export async function mostrar(el, [id]) {
  const [q, gal, aval] = await Promise.all([api(`/api/quartos/${id}`), api(`/api/quartos/${id}/galeria`), api(`/api/quartos/${id}/avaliacoes`)]);
  const M = estado.meta;
  const abertas = q.os.filter((o) => !M.STATUS_FINAIS.includes(o.status));
  const podeGerir = papel('gerente', 'admin', 'diretoria');
  const podeInspecionar = papel('governanta', 'gerente', 'admin');
  const podePadrao = papel('governanta', 'gerente', 'admin');

  render(el, html`
    <div class="cabecalho">
      <div><p class="sub"><a href="#/quartos">← Quartos</a></p>
        <h1>Quarto ${q.numero} <span class="muted" style="font-weight:400">· ${q.hotel.nome}</span></h1>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">${badgeComercial(q.status_comercial)} ${estrelas(q.estrelas)}
          <span class="muted">${q.tipo || ''}${q.andar ? ` · ${q.andar}º andar` : ''}</span>
          ${q.inspecao_vencida ? html`<span class="badge danger">Inspeção vencida</span>` : ''}</div></div>
      <div class="acoes-topo">
        ${papel('gerente', 'governanta', 'admin') ? html`<a class="btn primario" href="#/os/nova?quarto_id=${q.id}&hotel_id=${q.hotel_id}">+ Solicitar manutenção</a>` : ''}
        ${podeGerir && !papel('diretoria') ? html`<button class="btn" id="editar-quarto">Editar</button>` : ''}
        <a class="btn" href="#/qrcodes?hotel_id=${q.hotel_id}" title="Etiquetas de QR code para a porta">▦ QR code</a>
        ${podeInspecionar ? html`<button class="btn" id="inspecionar">Inspecionar agora</button>` : ''}
        ${q.status_comercial === 'bloqueado' && podeGerir ? html`<button class="btn sucesso" id="liberar">Liberar para comercialização</button>` : ''}
        ${q.status_comercial === 'liberado' && papel('gerente', 'admin', 'diretoria') ? html`<button class="btn perigo" id="bloquear">Bloquear</button>` : ''}
      </div>
    </div>
    <div class="kpis">
      ${kpi('Demandas em aberto', abertas.length, { classe: abertas.some((o) => o.atrasada) ? 'alerta' : '' })}
      ${kpi('Total de manutenções', q.os.length)}
      ${kpi('Custo acumulado', moeda(q.custo_total))}
      ${kpi('Problemas crônicos ativos', q.cronicos.filter((c) => c.status === 'ativo').length, { classe: q.cronicos.some((c) => c.status === 'ativo') ? 'atencao' : '' })}
      ${kpi('Última inspeção', data(q.ultima_inspecao_em), { detalhe: `a cada ${q.periodicidade_inspecao_dias} dias` })}
      ${kpi('Próxima inspeção', data(q.proxima_inspecao_em), { classe: q.inspecao_vencida ? 'alerta' : '' })}
    </div>
    <section class="card" style="margin-bottom:1rem">
      <div class="card-titulo"><h2>Fotos padrão do quarto</h2>${podePadrao ? html`<button class="btn pequeno primario" id="add-padrao">+ Adicionar fotos padrão</button>` : ''}</div>
      <p class="small muted" style="margin-top:-.4rem">Referência de como o quarto deve estar montado. Aparecem na inspeção e nas ordens de serviço deste quarto.</p>
      ${gal.padrao.length ? html`<div class="galeria">${gal.padrao.map((f) => html`<figure class="foto" style="margin:0">
        ${f.mime?.startsWith('video') ? html`<video src="/uploads/${f.arquivo}" preload="metadata" data-midia="/uploads/${f.arquivo}" data-mime="${f.mime}"></video>`
          : html`<img src="/uploads/${f.arquivo}" alt="${f.legenda || 'Foto padrão'}" loading="lazy" data-midia="/uploads/${f.arquivo}" data-mime="${f.mime}">`}
        <figcaption class="legenda">${f.legenda ? html`${f.legenda}<br>` : ''}<span class="muted">${data(f.criado_em)} · ${f.enviado_por_nome || ''}</span>
          ${podePadrao ? html`<br><button class="btn pequeno" data-remover-padrao="${f.id}" style="margin-top:.3rem">Remover</button>` : ''}</figcaption></figure>`)}</div>`
        : html`<p class="muted">Nenhuma foto padrão cadastrada${podePadrao ? ' — adicione fotos do quarto pronto para venda.' : '.'}</p>`}
    </section>
    <div class="col-principal">
      <div class="pilha">
        <section class="card">
          <h2>Demandas de manutenção</h2>
          ${q.os.length ? html`<div class="tabela-wrap"><table><thead><tr><th>OS</th><th>Problema</th><th>Prioridade</th><th>Situação</th><th>Responsável</th><th class="num">Custo</th></tr></thead><tbody>
            ${q.os.map((o) => html`<tr class="clicavel ${o.atrasada ? 'atrasada' : ''}" data-href="#/os/${o.id}"><td class="nowrap"><a href="#/os/${o.id}">${o.protocolo}</a><br><span class="muted small">${data(o.criado_em)}</span></td>
              <td>${o.titulo}${o.recorrente ? html` <span class="badge danger sem-ponto">↻</span>` : ''}</td><td>${badgePrioridade(o.prioridade)}</td><td>${badgeStatus(o.status)}</td>
              <td>${o.responsavel_nome || '—'}</td><td class="num">${moeda(o.custo)}</td></tr>`)}</tbody></table></div>` : html`<p class="vazio">Nenhuma manutenção registrada.</p>`}
        </section>
        <section class="card">
          <h2>Registro fotográfico</h2>
          ${gal.comparativos.length ? html`<h3>Comparativo antes × depois</h3>${gal.comparativos.map((c) => html`<div style="margin-bottom:1rem">
            <p class="small"><a href="#/os/${c.os_id}">${c.protocolo}</a> — ${c.titulo}</p>
            <div class="comparativo"><div><h4>Antes</h4>${galeria(c.antes.slice(0, 2))}</div><div><h4>Depois</h4>${galeria(c.depois.slice(-2))}</div></div></div>`)}` : ''}
          <h3>Histórico de imagens (cronológico)</h3>
          ${galeria([...gal.fotos].reverse())}
        </section>
        <section class="card">
          <h2>Histórico do quarto</h2>
          ${q.historico.length ? html`<ol class="timeline">${q.historico.map((h) => html`<li class="${h.tipo === 'bloqueio' || h.tipo === 'cronico' ? 'dificuldade' : 'status'}">
            <div><span class="badge sem-ponto">${TIPO_HIST[h.tipo] || h.tipo}</span> <span class="quando">${dataHora(h.criado_em)}</span> ${h.usuario_nome ? html`<span class="muted small">· ${h.usuario_nome}</span>` : ''}</div>
            <div class="corpo">${h.descricao} ${h.os_id ? html`<a href="#/os/${h.os_id}">ver OS</a>` : ''}${h.inspecao_id ? html`<a href="#/inspecoes/${h.inspecao_id}">ver inspeção</a>` : ''}</div></li>`)}</ol>` : html`<p class="vazio">Sem histórico.</p>`}
        </section>
      </div>
      <div class="pilha">
        <section class="card">
          <div class="card-titulo"><h2>Avaliações de hóspedes${aval.media ? html` <span class="muted">· média ${numero(aval.media, 1)}/5</span>` : ''}</h2>${papel('admin', 'gerente', 'governanta') ? html`<button class="btn pequeno" id="nova-avaliacao">+ Registrar</button>` : ''}</div>
          ${aval.itens.length ? html`<ul class="lista-simples">${aval.itens.slice(0, 6).map((a) => html`<li><strong>${'★'.repeat(a.nota)}${'☆'.repeat(5 - a.nota)}</strong> <span class="muted small">${M.ORIGENS_AVALIACAO[a.origem]} · ${data(a.data)}</span>${a.comentario ? html`<div class="small">${a.comentario}</div>` : ''}${a.protocolo ? html`<div class="small">→ <a href="#/os/${a.os_id}">${a.protocolo}</a></div>` : ''}</li>`)}</ul>` : html`<p class="muted small">Nenhuma avaliação registrada.</p>`}
        </section>
        <section class="card">
          <div class="card-titulo"><h2>Classificação</h2>${podeGerir ? html`<button class="btn pequeno" id="estrelas">Ajustar</button>` : ''}</div>
          <p style="font-size:1.5rem;margin:0">${estrelas(q.estrelas)}</p>
          <p class="muted small">Atualizada automaticamente a cada inspeção concluída (percentual de conformidade).</p>
        </section>
        <section class="card">
          <div class="card-titulo"><h2>Problemas crônicos</h2>${podeInspecionar || papel('diretoria') ? html`<button class="btn pequeno" id="cronico">+ Registrar</button>` : ''}</div>
          ${q.cronicos.length ? html`<ul class="lista-simples">${q.cronicos.map((c) => html`<li>
            <span class="badge ${c.status === 'ativo' ? 'warn' : 'ok'}">${c.status === 'ativo' ? 'Ativo' : 'Resolvido'}</span> <strong>${M.CATEGORIAS[c.categoria]}</strong>${c.equipamento_tipo ? ` · ${c.equipamento_tipo}` : ''}
            <div class="small">${c.descricao}</div><div class="muted small">Origem: ${c.origem} · ${c.criado_por_nome} · ${data(c.criado_em)}</div>
            ${c.status === 'ativo' && papel('gerente', 'admin', 'diretoria') ? html`<button class="btn pequeno" data-resolver="${c.id}" style="margin-top:.3rem">Marcar como resolvido</button>` : ''}</li>`)}</ul>` : html`<p class="muted small">Nenhum problema crônico.</p>`}
        </section>
        <section class="card">
          <div class="card-titulo"><h2>Equipamentos</h2>${papel('gerente', 'admin') ? html`<button class="btn pequeno" id="add-equip">+ Adicionar</button>` : ''}</div>
          <ul class="lista-simples">${q.equipamentos.map((e) => {
            const falhas = q.os.filter((o) => o.equipamento_id === e.id && !['cancelada', 'recusada'].includes(o.status)).length;
            return html`<li style="display:flex;justify-content:space-between;gap:.5rem;align-items:center"><span>${e.tipo}${e.descricao ? html` <span class="muted small">(${e.descricao})</span>` : ''}
              ${falhas ? html` <span class="badge ${falhas >= 3 ? 'danger' : falhas >= 2 ? 'warn' : ''}">${falhas} falha(s)</span>` : ''}<br><span class="muted small">Instalado em ${data(e.instalado_em)}</span></span>
              ${papel('gerente', 'admin') ? html`<button class="btn pequeno" data-substituir="${e.id}" data-tipo="${e.tipo}" title="Registrar substituição do equipamento">Substituir</button>` : ''}</li>`;
          })}</ul>
        </section>
        <section class="card">
          <div class="card-titulo"><h2>Inspeções</h2>${podeGerir || papel('governanta') ? html`<button class="btn pequeno" id="programar">Programar</button>` : ''}</div>
          ${q.inspecoes.length ? html`<ul class="lista-simples">${q.inspecoes.map((i) => html`<li><a href="#/inspecoes/${i.id}">${data(i.iniciada_em)}</a> — ${i.status === 'concluida' ? html`${numero(i.pontuacao, 0)}% ${estrelas(i.estrelas)}` : html`<span class="badge info">Em andamento</span>`}<br><span class="muted small">${i.inspetor_nome}</span></li>`)}</ul>` : html`<p class="muted small">Nenhuma inspeção.</p>`}
        </section>
        <section class="card">
          <h2>Bloqueios</h2>
          ${q.bloqueios.length ? html`<ul class="lista-simples">${q.bloqueios.map((b) => html`<li>${b.liberado_em ? html`<span class="badge ok">Liberado</span>` : html`<span class="badge danger">Ativo</span>`} ${b.motivo}
            <div class="muted small">Bloqueado por ${b.bloqueado_por_nome} em ${dataHora(b.bloqueado_em)}${b.liberado_em ? html`<br>Liberado por ${b.liberado_por_nome} em ${dataHora(b.liberado_em)}` : ''}</div></li>`)}</ul>` : html`<p class="muted small">Nenhum bloqueio registrado.</p>`}
        </section>
      </div>
    </div>`);

  $('#editar-quarto', el)?.addEventListener('click', () => {
    const semHistorico = !q.os.length && !q.inspecoes.length && !q.bloqueios.length && !q.cronicos.length && !gal.fotos.length && !gal.padrao.length;
    const { el: m, fechar } = modal(html`<h2>Editar quarto ${q.numero}</h2><form class="form" id="f-editar">
      <div class="form-grade">
        <label class="campo"><span class="obrig">Número</span><input name="numero" value="${q.numero}" required></label>
        <label class="campo"><span>Andar</span><input name="andar" value="${q.andar || ''}"></label>
        <label class="campo"><span>Tipo</span><input name="tipo" value="${q.tipo || ''}" placeholder="Standard, Luxo, Suíte…"></label></div>
      <div class="aviso danger" id="erro-editar" hidden></div>
      <div class="rodape-modal">${semHistorico ? html`<button type="button" class="btn perigo" id="excluir-quarto" style="margin-right:auto">Excluir quarto</button>` : ''}
        <button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Salvar</button></div></form>
      ${semHistorico ? '' : html`<p class="small muted">Quartos com histórico (demandas, inspeções ou fotos) não podem ser excluídos.</p>`}`.s);
    const erro = (err) => { const x = $('#erro-editar', m); x.textContent = err.message; x.hidden = false; };
    $('#f-editar', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await put(`/api/quartos/${q.id}`, dadosForm(e.target)); fechar(); toast('Quarto atualizado.'); recarregar(); } catch (err) { erro(err); }
    });
    $('#excluir-quarto', m)?.addEventListener('click', async (e) => {
      if (e.target.dataset.confirmar !== '1') { e.target.dataset.confirmar = '1'; e.target.textContent = 'Confirmar exclusão'; return; }
      try { await post(`/api/quartos/${q.id}/excluir`); fechar(); toast(`Quarto ${q.numero} excluído.`); location.hash = '#/quartos'; } catch (err) { erro(err); }
    });
  });
  $('#nova-avaliacao', el)?.addEventListener('click', () => {
    const { el: m, fechar } = modal(html`<h2>Avaliação / reclamação de hóspede — quarto ${q.numero}</h2><form class="form" id="f-aval">
      <div class="form-grade"><label class="campo"><span class="obrig">Nota</span><select name="nota" required>${opcoes({ 5: '★★★★★ (5)', 4: '★★★★ (4)', 3: '★★★ (3)', 2: '★★ (2)', 1: '★ (1)' }, '')}</select></label>
        <label class="campo"><span class="obrig">Origem</span><select name="origem" required>${opcoes(M.ORIGENS_AVALIACAO, '', { vazio: 'Selecione…' })}</select></label>
        <label class="campo"><span>Data</span><input type="datetime-local" name="data" value="${paraInputData(new Date().toISOString())}"></label>
        <label class="campo"><span>Categoria do problema</span><select name="categoria">${opcoes(M.CATEGORIAS, '', { vazio: 'Nenhum problema de manutenção' })}</select></label></div>
      <label class="campo"><span>Comentário do hóspede</span><textarea name="comentario" rows="3"></textarea></label>
      <label class="check"><input type="checkbox" name="gerar_os"> Gerar solicitação de manutenção a partir desta reclamação</label>
      <div class="aviso danger" id="erro-aval" hidden></div>
      <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Registrar</button></div></form>`.s);
    $('#f-aval', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await post(`/api/quartos/${q.id}/avaliacoes`, dadosForm(e.target));
        fechar(); toast(r.os_id ? 'Avaliação registrada e solicitação de manutenção aberta.' : 'Avaliação registrada.');
        if (r.os_id) location.hash = `#/os/${r.os_id}`; else recarregar();
      } catch (err) { const x = $('#erro-aval', m); x.textContent = err.message; x.hidden = false; }
    });
  });
  $('#add-padrao', el)?.addEventListener('click', () => {
    const { el: m, fechar } = modal(html`<h2>Fotos padrão — quarto ${q.numero}</h2><form class="form" id="f-padrao">
      <div id="up-padrao"></div>
      <label class="campo"><span>Legenda</span><input name="legenda" placeholder="Ex.: Cama montada, vista da porta, banheiro"></label>
      <fieldset class="campo" style="border:0;padding:0;margin:0"><span>Aplicar a</span>
        <label class="check"><input type="radio" name="aplicar" value="quarto" checked> Somente o quarto ${q.numero}</label>
        ${q.andar ? html`<label class="check"><input type="radio" name="aplicar" value="andar"> Todos os quartos do ${q.andar}º andar</label>` : ''}
        <label class="check"><input type="radio" name="aplicar" value="hotel"> Todos os quartos do hotel</label></fieldset>
      <div class="aviso danger" id="erro-padrao" hidden></div>
      <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Salvar</button></div></form>`.s);
    const obter = campoUpload($('#up-padrao', m), { rotulo: 'Selecionar fotos' });
    $('#f-padrao', m).addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = e.target.querySelector('[type=submit]');
      b.disabled = true;
      try {
        const r = await post(`/api/quartos/${q.id}/fotos-padrao`, { ...dadosForm(e.target), fotos: obter() });
        fechar();
        toast(`${r.fotos} foto(s) padrão aplicada(s) a ${r.quartos} quarto(s).`);
        recarregar();
      } catch (err) { const x = $('#erro-padrao', m); x.textContent = err.message; x.hidden = false; b.disabled = false; }
    });
  });
  for (const b of $$('[data-remover-padrao]', el)) {
    b.addEventListener('click', () => {
      const { el: m, fechar } = modal(html`<h2>Remover foto padrão</h2><p>Remover apenas deste quarto ou de todos os quartos que usam esta mesma foto?</p>
        <div class="rodape-modal"><button class="btn" data-fechar>Cancelar</button><button class="btn" data-escopo="quarto">Só deste quarto</button><button class="btn perigo" data-escopo="todos">De todos os quartos</button></div>`.s);
      for (const x of $$('[data-escopo]', m)) {
        x.addEventListener('click', async () => {
          const r = await post(`/api/fotos/${b.dataset.removerPadrao}/remover-padrao`, { todos: x.dataset.escopo === 'todos' });
          fechar(); toast(`Foto removida de ${r.removidas} quarto(s).`); recarregar();
        });
      }
    });
  }
  $('#inspecionar', el)?.addEventListener('click', async () => {
    const r = await post('/api/inspecoes', { quarto_id: q.id });
    location.hash = `#/inspecoes/${r.id}`;
  });
  $('#bloquear', el)?.addEventListener('click', () => formModal('Bloquear quarto para comercialização',
    html`<label class="campo"><span class="obrig">Motivo</span><textarea name="motivo" required></textarea></label>`,
    async (d) => { await post(`/api/quartos/${q.id}/bloquear`, d); toast('Quarto bloqueado.'); }));
  $('#liberar', el)?.addEventListener('click', () => formModal('Liberar quarto para comercialização',
    html`<p>Todos os bloqueios ativos deste quarto serão encerrados.</p><label class="campo"><span>Observação</span><textarea name="observacao"></textarea></label>`,
    async (d) => { await post(`/api/quartos/${q.id}/liberar`, d); toast('Quarto liberado.'); }));
  $('#estrelas', el)?.addEventListener('click', () => formModal('Classificação do quarto',
    html`<label class="campo"><span>Estrelas</span><select name="estrelas">${opcoes({ 1: '★', 2: '★★', 3: '★★★', 4: '★★★★', 5: '★★★★★' }, q.estrelas)}</select></label>`,
    async (d) => { await post(`/api/quartos/${q.id}/estrelas`, d); }));
  $('#cronico', el)?.addEventListener('click', () => formModal('Registrar problema crônico',
    html`<label class="campo"><span class="obrig">Categoria</span><select name="categoria" required>${opcoes(M.CATEGORIAS, '', { vazio: 'Selecione…' })}</select></label>
      <label class="campo"><span>Equipamento</span><select name="equipamento_id"><option value="">—</option>${q.equipamentos.map((e) => html`<option value="${e.id}">${e.tipo}</option>`)}</select></label>
      <label class="campo"><span class="obrig">Descrição</span><textarea name="descricao" required placeholder="Desgaste ou problema persistente, sem urgência imediata"></textarea></label>`,
    async (d) => { await post('/api/cronicos', { ...d, quarto_id: q.id }); toast('Problema crônico registrado.'); }));
  $('#add-equip', el)?.addEventListener('click', () => formModal('Adicionar equipamento',
    html`<label class="campo"><span class="obrig">Tipo</span><input name="tipo" list="tipos-eq" required><datalist id="tipos-eq">${M.EQUIPAMENTOS_PADRAO.map((t) => html`<option value="${t}">`)}</datalist></label>
      <label class="campo"><span>Descrição / modelo</span><input name="descricao"></label>
      <label class="campo"><span>Instalado em</span><input type="date" name="instalado_em"></label>`,
    async (d) => { await post(`/api/quartos/${q.id}/equipamentos`, d); toast('Equipamento adicionado.'); }));
  for (const b of $$('[data-substituir]', el)) {
    b.addEventListener('click', () => formModal(`Substituir ${b.dataset.tipo}`,
      html`<p class="small">O equipamento atual é desativado (seu histórico é mantido) e um novo é cadastrado — a contagem de recorrência recomeça para o novo equipamento.</p>
        <label class="campo"><span>Novo modelo / descrição</span><input name="descricao"></label>`,
      async (d) => { await post(`/api/equipamentos/${b.dataset.substituir}/substituir`, d); toast('Substituição registrada.'); }));
  }
  for (const b of $$('[data-resolver]', el)) {
    b.addEventListener('click', async () => { await post(`/api/cronicos/${b.dataset.resolver}/resolver`); toast('Problema marcado como resolvido.'); recarregar(); });
  }
  $('#programar', el)?.addEventListener('click', () => formModal('Programar inspeções periódicas',
    html`<label class="campo"><span>Periodicidade (dias)</span><input type="number" min="1" name="periodicidade_dias" value="${q.periodicidade_inspecao_dias}"></label>
      <label class="campo"><span>Próxima inspeção</span><input type="datetime-local" name="proxima_em" value="${paraInputData(q.proxima_inspecao_em)}"></label>`,
    async (d) => { await post('/api/quartos/programar-inspecao', { ...d, quarto_ids: [q.id] }); toast('Programação atualizada.'); }));
}
