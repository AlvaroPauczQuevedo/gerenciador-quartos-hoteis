import { estado, api, post } from '../estado.js';
import { recarregar } from '../app.js';
import {
  html, render, raw, $, $$, modal, toast, opcoes, campoUpload, dadosForm, galeria, paraInputData,
  badgePrioridade, badgeStatus, badgeAtraso, dataHora, data, moeda, relativo,
} from '../ui.js';

const M = () => estado.meta;

// Campos específicos de cada ação do fluxo.
const campoTexto = (rotulo, obrig = true, valor = '') => html`<label class="campo"><span class="${obrig ? 'obrig' : ''}">${rotulo}</span><textarea name="texto" ${obrig ? raw('required') : ''}>${valor}</textarea></label>`;
const seletorTecnico = (os, nome = 'responsavel_id', obrig = true) => html`<label class="campo"><span class="${obrig ? 'obrig' : ''}">Profissional</span>
  <select name="${nome}" ${obrig ? raw('required') : ''}><option value="">${obrig ? 'Selecione…' : 'Definir depois'}</option>${os.tecnicos.map((t) => html`<option value="${t.id}" ${t.id === os.responsavel_id ? raw('selected') : ''}>${t.nome} — ${M().PAPEIS[t.papel]}</option>`)}</select></label>`;
const linhasMateriais = () => html`<div class="campo"><span class="obrig">Materiais</span><div id="materiais">${linhaMaterial()}</div>
  <button type="button" class="btn pequeno" id="add-material" style="justify-self:start">+ material</button></div>`;
const linhaMaterial = () => html`<div class="form-grade" style="grid-template-columns:2fr 1fr 1fr;margin-bottom:.4rem" data-material>
  <input placeholder="Descrição" data-m="descricao"><input type="number" min="0" step="any" value="1" data-m="quantidade" aria-label="Quantidade"><input placeholder="un, m, kg…" data-m="unidade" aria-label="Unidade"></div>`;

const FORMS = {
  receber: () => campoTexto('Observação', false),
  aceitar: (os) => html`${seletorTecnico(os, 'responsavel_id', false)}<label class="campo"><span>Prazo de atendimento</span><input type="datetime-local" name="prazo_previsto" value="${paraInputData(os.prazo_previsto)}"></label>${campoTexto('Observação', false)}`,
  devolver: () => campoTexto('O que precisa ser complementado?'),
  complementar: (os) => html`${campoTexto('Complementação solicitada')}<label class="campo"><span>Descrição atualizada (opcional)</span><textarea name="descricao">${os.descricao}</textarea></label>`,
  recusar: () => campoTexto('Motivo da recusa'),
  solicitar_orcamento: () => campoTexto('Por que é necessário orçamento?'),
  enviar_aprovacao: () => html`<div class="form-grade"><label class="campo"><span class="obrig">Valor (R$)</span><input type="number" name="valor" min="0" step="0.01" required></label>
    <label class="campo"><span>Fornecedor</span><input name="fornecedor"></label></div>
    <label class="campo"><span class="obrig">Descrição do orçamento</span><textarea name="descricao" required></textarea></label>`,
  autorizar: () => campoTexto('Observação', false),
  negar: () => campoTexto('Motivo da recusa do orçamento'),
  designar: (os) => seletorTecnico(os),
  definir_prazo: (os) => html`<label class="campo"><span class="obrig">Prazo</span><input type="datetime-local" name="prazo_previsto" value="${paraInputData(os.prazo_previsto)}" required></label>${campoTexto('Observação', false)}`,
  reavaliar_prioridade: (os) => html`<label class="campo"><span class="obrig">Nova prioridade</span><select name="prioridade">${opcoes(M().PRIORIDADES, os.prioridade)}</select></label>${campoTexto('Justificativa da alteração')}`,
  iniciar: (os) => (os.prioridade === 'emergencial' && !['aprovada', 'em_correcao'].includes(os.status)
    ? html`<div class="aviso warn"><span class="icone">!</span><div>Atendimento emergencial: a execução começa imediatamente. Orçamentos, aprovações e validação serão regularizados depois.</div></div>`
    : campoTexto('Observação', false)),
  aguardar_materiais: () => html`${linhasMateriais()}${campoTexto('Observação', false)}`,
  solicitar_material: () => linhasMateriais(),
  materiais_disponiveis: () => campoTexto('Observação', false),
  registrar_dificuldade: () => campoTexto('Dificuldade encontrada'),
  registrar_custo: () => html`<div class="form-grade"><label class="campo"><span class="obrig">Tipo</span><select name="tipo">${opcoes(M().TIPOS_CUSTO, 'material')}</select></label>
    <label class="campo"><span class="obrig">Valor (R$)</span><input type="number" name="valor" min="0" step="0.01" required></label></div>
    <label class="campo"><span class="obrig">Descrição</span><input name="descricao" required></label>`,
  adicionar_tarefa: (os) => html`<label class="campo"><span class="obrig">Atividade</span><input name="descricao" required></label>${seletorTecnico(os, 'tecnico_id')}`,
  concluir: (os) => html`${campoTexto('Relatório de conclusão (o que foi feito)')}
    <p class="small muted">${os.fotos.some((f) => f.fase === 'depois') ? 'Já existem fotos de conclusão; você pode anexar mais.' : 'Anexe ao menos uma fotografia do serviço concluído como evidência.'}</p>`,
  validar: (os) => html`${campoTexto('Observações da inspeção final', false)}
    ${os.bloqueio_ativo ? html`<label class="check"><input type="checkbox" name="liberar_quarto" checked> Liberar o quarto ${os.quarto_numero} para comercialização</label>` : ''}`,
  solicitar_correcao: () => campoTexto('O que precisa ser corrigido?'),
  reabrir: (os) => html`${campoTexto('Motivo da reabertura')}${os.quarto_id ? html`<label class="check"><input type="checkbox" name="bloquear_quarto"> Bloquear o quarto novamente</label>` : ''}`,
  cancelar: () => campoTexto('Motivo do cancelamento'),
  bloquear_quarto: (os) => campoTexto('Motivo do bloqueio', false, `${os.protocolo}: ${os.titulo}`),
  liberar_quarto: () => campoTexto('Observação da liberação', false),
};
const COM_FOTOS = { concluir: 'Fotos do serviço concluído', validar: 'Fotos da inspeção final', solicitar_correcao: 'Fotos do problema', reabrir: 'Fotos do problema', iniciar: 'Fotos do início', registrar_dificuldade: 'Fotos' };
const DESTAQUE = { validar: 'sucesso', concluir: 'sucesso', aceitar: 'primario', receber: 'primario', iniciar: 'primario', autorizar: 'sucesso', assumir: 'primario', complementar: 'primario' };
const PERIGO = ['recusar', 'cancelar', 'negar', 'solicitar_correcao', 'reabrir'];

function abrirAcao(os, acao) {
  const form = FORMS[acao.chave]?.(os) || '';
  const { el, fechar } = modal(html`<h2>${acao.rotulo}</h2><p class="muted small">${os.protocolo} — ${os.titulo}</p>
    <form class="form" id="f-acao">${form}${COM_FOTOS[acao.chave] ? html`<div class="campo"><span>${COM_FOTOS[acao.chave]}</span><div id="up-acao"></div></div>` : ''}
    <div class="aviso danger" id="erro-acao" hidden></div>
    <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn ${DESTAQUE[acao.chave] || 'primario'}" type="submit">Confirmar</button></div></form>`.s);
  const fotos = COM_FOTOS[acao.chave] ? campoUpload($('#up-acao', el)) : null;
  $('#add-material', el)?.addEventListener('click', () => $('#materiais', el).insertAdjacentHTML('beforeend', linhaMaterial().s));
  $('#f-acao', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    if ($('#materiais', el)) {
      d.materiais = $$('[data-material]', el).map((l) => Object.fromEntries($$('[data-m]', l).map((i) => [i.dataset.m, i.value]))).filter((m) => m.descricao.trim());
    }
    if (fotos) d.fotos = fotos();
    const b = e.target.querySelector('[type=submit]');
    b.disabled = true;
    try {
      await post(`/api/os/${os.id}/acoes/${acao.chave}`, d);
      fechar();
      toast(`${acao.rotulo}: registrado.`);
      recarregar();
    } catch (err) {
      const erro = $('#erro-acao', el);
      erro.textContent = err.message;
      erro.hidden = false;
      b.disabled = false;
    }
  });
}

const ROTULO_EVENTO = { abertura: 'Abertura', status: 'Situação', comentario: 'Comentário', prioridade: 'Prioridade', designacao: 'Designação', material: 'Materiais', custo: 'Custo', dificuldade: 'Dificuldade', anexo: 'Anexo', orcamento: 'Orçamento', prazo: 'Prazo', tarefa: 'Atividade', bloqueio: 'Comercialização', recorrencia: 'Recorrência' };

export async function mostrar(el, [id]) {
  const os = await api(`/api/os/${id}`);
  const m = M();
  const acoesVisiveis = os.acoes.filter((a) => !a.interna);
  const principais = acoesVisiveis.filter((a) => DESTAQUE[a.chave]);
  const secundarias = acoesVisiveis.filter((a) => !DESTAQUE[a.chave]).sort((x, y) => PERIGO.includes(x.chave) - PERIGO.includes(y.chave));
  const custoTotal = os.custos.reduce((s, c) => s + c.valor, 0);
  const pessoa = (papel, nome, quando) => html`<div><div class="papel">${papel}</div><div class="nome">${nome || html`<span class="muted">—</span>`}</div>${quando ? html`<div class="muted small">${dataHora(quando)}</div>` : ''}</div>`;
  const fotosPorFase = Object.keys(m.FASES_FOTO).map((f) => [f, os.fotos.filter((x) => x.fase === f)]).filter(([, l]) => l.length);
  const podeComentar = os.acoes.some((a) => a.chave === 'comentar');

  render(el, html`
    <div class="cabecalho">
      <div>
        <p class="sub"><a href="#/os">← Demandas</a></p>
        <h1>${os.protocolo} · ${os.titulo}</h1>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">${badgePrioridade(os.prioridade)} ${badgeStatus(os.status)} ${badgeAtraso(os)}
          ${os.recorrente ? html`<span class="badge danger sem-ponto">↻ Problema recorrente</span>` : ''}
          ${os.bloqueio_ativo ? html`<span class="badge danger">Quarto bloqueado</span>` : ''}
          ${os.origem === 'inspecao' ? html`<span class="badge info sem-ponto">Origem: inspeção</span>` : ''}
          ${os.prioridade !== os.prioridade_original ? html`<span class="badge sem-ponto">Prioridade original: ${m.PRIORIDADES[os.prioridade_original]}</span>` : ''}</div>
      </div>
    </div>
    ${acoesVisiveis.length ? html`<div class="card barra-acoes" style="margin-bottom:1rem">
      ${principais.length ? html`<div class="grupo-acoes"><span class="rotulo-acoes">Próximo passo</span><div class="acoes-topo">${principais.map((a) => html`<button class="btn ${DESTAQUE[a.chave]}" data-acao="${a.chave}">${a.rotulo}</button>`)}</div></div>` : ''}
      ${secundarias.length ? html`<div class="grupo-acoes"><span class="rotulo-acoes">Outras ações</span><div class="acoes-topo">${secundarias.map((a) => html`<button class="btn pequeno ${PERIGO.includes(a.chave) ? 'perigo' : ''}" data-acao="${a.chave}">${a.rotulo}</button>`)}</div></div>` : ''}
    </div>` : ''}
    ${os.status === 'concluida' && os.acoes.some((a) => a.chave === 'validar') ? html`<div class="aviso info" style="margin-bottom:1rem"><span class="icone">✓</span><div>O serviço foi concluído e aguarda sua validação. Confira as evidências abaixo e aprove, solicite correção ou registre observações.</div></div>` : ''}
    ${os.atrasada ? html`<div class="aviso danger" style="margin-bottom:1rem"><span class="icone">!</span><div>Demanda atrasada — o prazo venceu ${relativo(os.prazo_previsto)} (${dataHora(os.prazo_previsto)}).</div></div>` : ''}
    <div class="col-principal">
      <div class="pilha">
        <section class="card">
          <h2>Descrição</h2>
          <p class="pre">${os.descricao}</p>
          <dl class="defs">
            <dt>Hotel</dt><dd>${os.hotel_nome}</dd>
            <dt>Local</dt><dd>${m.LOCAIS[os.local]}${os.quarto_numero ? html` · <a href="#/quartos/${os.quarto_id}">Quarto ${os.quarto_numero}</a>` : ''}${os.equipamento_tipo ? html` · ${os.equipamento_tipo}` : ''}</dd>
            <dt>Categoria</dt><dd>${m.CATEGORIAS[os.categoria]}</dd>
            <dt>Identificado em</dt><dd>${dataHora(os.identificado_em)}</dd>
            <dt>Aberto em</dt><dd>${dataHora(os.criado_em)}</dd>
            <dt>Impacto</dt><dd>${m.IMPACTOS[os.impacto] || '—'}</dd>
            <dt>Justificativa</dt><dd>${os.justificativa || '—'}</dd>
            <dt>Prazo desejado</dt><dd>${dataHora(os.prazo_desejado)}</dd>
            <dt>Prazo previsto</dt><dd><strong>${dataHora(os.prazo_previsto)}</strong> ${os.prazo_previsto ? html`<span class="muted small">(${relativo(os.prazo_previsto)})</span>` : ''}</dd>
            <dt>Bloqueio do quarto</dt><dd>${os.bloqueio_quarto ? 'Solicitado' : 'Não'}${os.quarto_id ? html` · situação atual: <strong>${os.quarto_status_comercial === 'bloqueado' ? 'bloqueado' : 'liberado'}</strong>` : ''}</dd>
            <dt>Observações</dt><dd class="pre">${os.observacoes || '—'}</dd>
            ${os.relatorio_conclusao ? html`<dt>Relatório de conclusão</dt><dd class="pre">${os.relatorio_conclusao}</dd>` : ''}
            ${os.inspecao ? html`<dt>Inspeção de origem</dt><dd><a href="#/inspecoes/${os.inspecao.inspecao_id}">Inspeção #${os.inspecao.inspecao_id}</a> — ${os.inspecao.ambiente}: ${os.inspecao.item}</dd>` : ''}
          </dl>
        </section>

        <section class="card">
          <h2>Responsáveis</h2>
          <div class="rastreio">
            ${pessoa('Abriu', os.aberto_por_nome, os.criado_em)}
            ${pessoa('Recebeu', os.recebido_por_nome, os.recebido_em)}
            ${pessoa('Responsável', os.responsavel_nome, os.iniciado_em)}
            ${pessoa('Executou', os.executado_por_nome, os.concluido_em)}
            ${pessoa('Validou', os.validado_por_nome, os.validado_em)}
          </div>
          ${os.tarefas.length ? html`<h3 style="margin-top:1rem">Atividades distribuídas</h3><ul class="lista-simples">${os.tarefas.map((t) => html`<li style="display:flex;justify-content:space-between;gap:.5rem;align-items:center">
            <span>${t.concluida ? '✅' : '⬜'} ${t.descricao} <span class="muted small">— ${t.tecnico_nome}${t.concluida_em ? html`, concluída ${dataHora(t.concluida_em)}` : ''}</span></span>
            ${!t.concluida && os.acoes.some((a) => a.chave === 'concluir_tarefa') && (t.tecnico_id === estado.usuario.id || estado.usuario.papel !== 'tecnico') ? html`<button class="btn pequeno" data-tarefa="${t.id}">Concluir</button>` : ''}</li>`)}</ul>` : ''}
        </section>

        <section class="card">
          <div class="card-titulo"><h2>Fotografias e vídeos</h2><button class="btn pequeno" id="add-foto">+ Anexar</button></div>
          ${fotosPorFase.length ? fotosPorFase.map(([f, l]) => html`<h3 style="margin-top:.75rem">${m.FASES_FOTO[f]} <span class="muted">(${l.length})</span></h3>${galeria(l, { mostrarFase: false })}`) : html`<p class="muted">Nenhuma imagem anexada.</p>`}
          ${os.fotos.some((f) => f.fase === 'antes' || f.fase === 'inspecao') && os.fotos.some((f) => f.fase === 'depois') ? html`<h3 style="margin-top:1rem">Comparativo antes × depois</h3>
            <div class="comparativo"><div><h4>Antes</h4>${galeria(os.fotos.filter((f) => ['antes', 'inspecao'].includes(f.fase)).slice(0, 1), { mostrarFase: false })}</div>
            <div><h4>Depois</h4>${galeria(os.fotos.filter((f) => f.fase === 'depois').slice(-1), { mostrarFase: false })}</div></div>` : ''}
        </section>

        <section class="card">
          <h2>Histórico de atualizações e comentários</h2>
          <ol class="timeline">${os.eventos.map((ev) => html`<li class="${ev.tipo}">
            <div><span class="quem">${ev.usuario_nome || 'Sistema'}</span> <span class="muted small">${ev.usuario_papel ? m.PAPEIS[ev.usuario_papel] : ''}</span>
              · <span class="badge sem-ponto">${ROTULO_EVENTO[ev.tipo] || ev.tipo}</span> <span class="quando">${dataHora(ev.criado_em)}</span></div>
            ${ev.status_para ? html`<div class="small">${ev.status_de ? html`${m.STATUS[ev.status_de]} → ` : ''}<strong>${m.STATUS[ev.status_para]}</strong></div>` : ''}
            ${ev.texto ? html`<div class="corpo">${ev.texto}</div>` : ''}</li>`)}</ol>
          ${podeComentar ? html`<form id="f-comentario" class="form" style="margin-top:.5rem">
            <label class="campo"><span>Comentário para gerente e manutenção</span><textarea name="texto" required rows="3" placeholder="Escreva uma atualização ou pergunta…"></textarea></label>
            <div><button class="btn primario" type="submit">Enviar comentário</button></div></form>` : ''}
        </section>
      </div>

      <div class="pilha">
        <section class="card">
          <h2>Custos <span class="muted">${moeda(custoTotal)}</span></h2>
          ${os.custos.length ? html`<ul class="lista-simples">${os.custos.map((c) => html`<li style="display:flex;justify-content:space-between;gap:.5rem"><span>${c.descricao}<br><span class="muted small">${m.TIPOS_CUSTO[c.tipo]} · ${c.registrado_por_nome} · ${data(c.criado_em)}</span></span><strong class="nowrap">${moeda(c.valor)}</strong></li>`)}</ul>` : html`<p class="muted small">Nenhum custo registrado.</p>`}
        </section>
        ${os.aprovacoes.length ? html`<section class="card"><h2>Aprovação financeira</h2><ul class="lista-simples">${os.aprovacoes.map((a) => html`<li>
          <strong>${moeda(a.valor)}</strong> ${a.status === 'pendente' ? html`<span class="badge warn">Pendente</span>` : a.status === 'aprovado' ? html`<span class="badge ok">Aprovado</span>` : html`<span class="badge danger">Recusado</span>`}
          ${a.posterior ? html`<span class="badge sem-ponto">regularização posterior</span>` : ''}
          <div class="small">${a.descricao}${a.fornecedor ? html` — ${a.fornecedor}` : ''}</div>
          <div class="muted small">Solicitado por ${a.solicitado_por_nome} em ${dataHora(a.criado_em)}${a.decidido_por_nome ? html`<br>Decidido por ${a.decidido_por_nome} em ${dataHora(a.decidido_em)}${a.justificativa_decisao ? html`: ${a.justificativa_decisao}` : ''}` : ''}</div></li>`)}</ul></section>` : ''}
        <section class="card">
          <h2>Materiais</h2>
          ${os.materiais.length ? html`<ul class="lista-simples">${os.materiais.map((x) => html`<li>${x.quantidade} ${x.unidade || ''} ${x.descricao}
            <span class="badge ${x.status === 'solicitado' ? 'warn' : 'ok'}">${{ solicitado: 'Solicitado', disponivel: 'Disponível', aplicado: 'Aplicado' }[x.status]}</span><br><span class="muted small">${x.solicitado_por_nome} · ${data(x.criado_em)}</span></li>`)}</ul>` : html`<p class="muted small">Nenhum material solicitado.</p>`}
        </section>
        ${os.fotos_padrao.length ? html`<section class="card"><h2>Padrão do quarto ${os.quarto_numero}</h2>
          <p class="small muted">Como o quarto deve ficar após o serviço.</p>${galeria(os.fotos_padrao, { mostrarFase: false })}</section>` : ''}
        ${os.quarto_id ? html`<section class="card">
          <div class="card-titulo"><h2>Histórico do problema no quarto</h2><a href="#/quartos/${os.quarto_id}">Quarto ${os.quarto_numero} →</a></div>
          ${os.relacionadas.length ? html`<p class="small ${os.relacionadas.length >= 2 ? '' : 'muted'}">${os.relacionadas.length} ocorrência(s) anterior(es) de ${os.equipamento_tipo || m.CATEGORIAS[os.categoria]} nos últimos 24 meses:</p>
            <ul class="lista-simples">${os.relacionadas.map((o) => html`<li><a href="#/os/${o.id}">${o.protocolo}</a> · ${data(o.criado_em)} ${badgeStatus(o.status)}<br><span class="small">${o.titulo}</span>${o.custo ? html` <span class="muted small">· ${moeda(o.custo)}</span>` : ''}</li>`)}</ul>`
            : html`<p class="muted small">Nenhuma ocorrência anterior deste problema no quarto.</p>`}
        </section>` : ''}
      </div>
    </div>`);

  for (const b of $$('[data-acao]', el)) b.addEventListener('click', () => abrirAcao(os, os.acoes.find((a) => a.chave === b.dataset.acao)));
  for (const b of $$('[data-tarefa]', el)) {
    b.addEventListener('click', async () => {
      await post(`/api/os/${os.id}/acoes/concluir_tarefa`, { tarefa_id: b.dataset.tarefa });
      toast('Atividade concluída.');
      recarregar();
    });
  }
  $('#f-comentario', el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await post(`/api/os/${os.id}/acoes/comentar`, { texto: e.target.texto.value });
    toast('Comentário enviado.');
    recarregar();
  });
  $('#add-foto', el).addEventListener('click', () => {
    const faseSugerida = ['em_execucao', 'aguardando_materiais', 'em_correcao'].includes(os.status) ? 'durante' : os.status === 'concluida' ? 'validacao' : ['encerrada'].includes(os.status) ? 'depois' : 'antes';
    const { el: mel, fechar } = modal(html`<h2>Anexar fotografias ou vídeos</h2><form class="form" id="f-foto">
      <label class="campo"><span>Fase</span><select name="fase">${opcoes(m.FASES_FOTO, faseSugerida)}</select></label>
      <label class="campo"><span>Legenda</span><input name="legenda"></label><div id="up"></div>
      <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Enviar</button></div></form>`.s);
    const obter = campoUpload($('#up', mel));
    $('#f-foto', mel).addEventListener('submit', async (e) => {
      e.preventDefault();
      const lista = obter();
      if (!lista.length) { toast('Selecione ao menos um arquivo.', 'erro'); return; }
      for (const f of lista) await post('/api/fotos', { ...f, os_id: os.id, fase: e.target.fase.value, legenda: e.target.legenda.value });
      fechar();
      toast('Imagens anexadas.');
      recarregar();
    });
  });
}
