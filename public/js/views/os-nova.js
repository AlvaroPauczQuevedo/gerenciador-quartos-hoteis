import { estado, api, post, qs } from '../estado.js';
import { html, render, raw, $, opcoes, seletorHotel, campoUpload, dadosForm, paraInputData, toast, data } from '../ui.js';

export async function mostrar(el, _p, query) {
  const M = estado.meta;
  const u = estado.usuario;
  const hotelInicial = query.hotel_id || u.hotel_id || estado.hoteis[0]?.id;

  render(el, html`
    <div class="cabecalho"><div><h1>Nova solicitação de manutenção</h1>
      <p class="sub">Registre o problema com o máximo de detalhes. Um número de protocolo será gerado e a equipe de manutenção será notificada.</p></div></div>
    <form class="form" id="f-os" novalidate>
      <section class="card">
        <h2>Onde é o problema?</h2>
        <div class="form-grade">
          <label class="campo"><span class="obrig">Hotel de origem</span>${seletorHotel(hotelInicial, { todos: false })}</label>
          <label class="campo"><span>Número do quarto</span><select name="quarto_id"><option value="">Não se aplica (área comum)</option></select></label>
          <label class="campo"><span class="obrig">Local do problema</span><select name="local" required>${opcoes(M.LOCAIS, query.quarto_id ? 'quarto' : '', { vazio: 'Selecione…' })}</select></label>
          <label class="campo"><span>Equipamento</span><select name="equipamento_id" disabled><option value="">—</option></select><small>Vincula o histórico de falhas do equipamento.</small></label>
        </div>
      </section>
      <section class="card">
        <h2>O que aconteceu?</h2>
        <div class="form-grade">
          <label class="campo"><span class="obrig">Categoria</span><select name="categoria" required>${opcoes(M.CATEGORIAS, '', { vazio: 'Selecione…' })}</select></label>
          <label class="campo"><span>Título resumido</span><input name="titulo" maxlength="120" placeholder="Gerado automaticamente se vazio"></label>
          <label class="campo"><span class="obrig">Data e horário da identificação</span><input type="datetime-local" name="identificado_em" value="${paraInputData(new Date().toISOString())}" required></label>
          <label class="campo largo"><span class="obrig">Descrição detalhada do problema</span><textarea name="descricao" required minlength="10" placeholder="O que foi observado, desde quando, em que condições…"></textarea></label>
        </div>
        <div id="alerta-recorrencia" style="margin-top:1rem"></div>
        <div class="campo" style="margin-top:1rem"><span>Fotografias ou vídeos</span><div id="upload"></div></div>
      </section>
      <section class="card">
        <h2>Prioridade e impacto</h2>
        <div class="opcoes-prioridade">${Object.entries(M.PRIORIDADES).map(([k, v]) => html`
          <label class="opcao-prioridade"><input type="radio" name="prioridade" value="${k}" ${k === 'media' ? raw('checked') : ''}>
            <span><span class="badge p-${k}">${v}</span><small>${M.PRIORIDADE_DESCRICAO[k]}</small><small>Prazo padrão: ${M.SLA_HORAS[k] < 48 ? `${M.SLA_HORAS[k]} h` : `${M.SLA_HORAS[k] / 24} dias`}</small></span></label>`)}
        </div>
        <div class="form-grade" style="margin-top:1rem">
          <label class="campo"><span>Impacto na operação</span><select name="impacto">${opcoes(M.IMPACTOS, '', { vazio: 'Selecione…' })}</select></label>
          <label class="campo"><span>Prazo desejado para atendimento</span><input type="datetime-local" name="prazo_desejado"><small>Se vazio, aplica o prazo padrão da prioridade.</small></label>
          <label class="campo largo"><span>Justificativa da solicitação</span><textarea name="justificativa" rows="2" placeholder="Por que este atendimento é necessário?"></textarea></label>
          <label class="check campo largo" id="campo-bloqueio" hidden><input type="checkbox" name="bloqueio_quarto"> Bloquear o quarto para comercialização até a liberação autorizada</label>
          <label class="campo largo"><span>Observações adicionais</span><textarea name="observacoes" rows="2"></textarea></label>
        </div>
      </section>
      <div class="aviso danger" id="erro" hidden></div>
      <div class="acoes-topo"><button class="btn primario" type="submit">Abrir solicitação</button><a class="btn" href="#/os">Cancelar</a></div>
    </form>`);

  const form = $('#f-os', el);
  const obterFotos = campoUpload($('#upload', el));
  const selHotel = form.elements.hotel_id;
  const selQuarto = form.elements.quarto_id;
  const selEquip = form.elements.equipamento_id;
  let equipamentos = [];

  async function carregarQuartos() {
    const quartos = await api(`/api/quartos${qs({ hotel_id: selHotel.value })}`);
    selQuarto.innerHTML = html`<option value="">Não se aplica (área comum)</option>${quartos.map((q) => html`<option value="${q.id}">${q.numero}${q.tipo ? ` — ${q.tipo}` : ''}${q.status_comercial === 'bloqueado' ? ' (bloqueado)' : ''}</option>`)}`.s;
    if (query.quarto_id) { selQuarto.value = query.quarto_id; query.quarto_id = null; }
    await aoMudarQuarto();
  }
  async function aoMudarQuarto() {
    $('#campo-bloqueio', el).hidden = !selQuarto.value;
    selEquip.disabled = !selQuarto.value;
    equipamentos = [];
    if (selQuarto.value) {
      equipamentos = (await api(`/api/quartos/${selQuarto.value}`)).equipamentos;
      if (!form.elements.local.value) form.elements.local.value = 'quarto';
    }
    selEquip.innerHTML = html`<option value="">${selQuarto.value ? 'Nenhum específico' : '—'}</option>${equipamentos.map((e) => html`<option value="${e.id}">${e.tipo}${e.descricao ? ` (${e.descricao})` : ''}</option>`)}`.s;
    verificarRecorrencia();
  }
  // Integração 5: avisa já na abertura se o problema está se repetindo no quarto.
  async function verificarRecorrencia() {
    const alvo = $('#alerta-recorrencia', el);
    alvo.innerHTML = '';
    if (!selQuarto.value || !form.elements.categoria.value) return;
    const anteriores = await api(`/api/quartos/${selQuarto.value}/recorrencia${qs({ categoria: form.elements.categoria.value, equipamento_id: selEquip.value })}`);
    if (!anteriores.length) return;
    alvo.innerHTML = html`<div class="aviso ${anteriores.length >= 2 ? 'danger' : 'warn'}"><span class="icone">↻</span><div>
      <strong>Este problema já ocorreu ${anteriores.length} vez(es) neste quarto nos últimos 12 meses.</strong> A solicitação será marcada como recorrente.
      <ul style="margin:.3rem 0 0;padding-left:1.1rem">${anteriores.map((o) => html`<li><a href="#/os/${o.id}" target="_blank">${o.protocolo}</a> — ${data(o.criado_em)} — ${o.titulo}</li>`)}</ul></div></div>`.s;
  }
  selHotel.addEventListener?.('change', carregarQuartos);
  selQuarto.addEventListener('change', aoMudarQuarto);
  form.elements.categoria.addEventListener('change', verificarRecorrencia);
  selEquip.addEventListener('change', () => {
    const e = equipamentos.find((x) => String(x.id) === selEquip.value);
    if (e && !form.elements.categoria.value) form.elements.categoria.value = e.tipo === 'Ar-condicionado' ? 'ar_condicionado' : e.tipo === 'Chuveiro' ? 'hidraulica' : 'equipamentos';
    verificarRecorrencia();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'prioridade' && e.target.value === 'emergencial' && selQuarto.value) form.elements.bloqueio_quarto.checked = true;
  });
  await carregarQuartos();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = $('#erro', el);
    erro.hidden = true;
    const botao = form.querySelector('[type=submit]');
    botao.disabled = true;
    try {
      const d = dadosForm(form);
      const r = await post('/api/os', { ...d, fotos: obterFotos() });
      toast(`Solicitação ${r.protocolo} aberta. A manutenção foi notificada.`);
      location.hash = `#/os/${r.id}`;
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
      erro.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      botao.disabled = false;
    }
  });
}
