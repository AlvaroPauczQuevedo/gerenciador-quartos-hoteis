import { estado, api, post, put } from '../estado.js';
import { recarregar } from '../app.js';
import { html, render, raw, $, $$, toast, opcoes, dadosForm, modal } from '../ui.js';

const linhaFaixa = () => html`<div class="form-grade" data-faixa style="grid-template-columns:repeat(auto-fit,minmax(min(100%,110px),1fr));margin-bottom:.4rem">
  <label class="campo"><span>Andar</span><input data-f="andar" placeholder="1"></label>
  <label class="campo"><span>Do nº</span><input type="number" min="1" data-f="inicio" placeholder="101"></label>
  <label class="campo"><span>Até o nº</span><input type="number" min="1" data-f="fim" placeholder="120"></label>
  <label class="campo"><span>Tipo</span><input data-f="tipo" placeholder="opcional"></label></div>`;

export async function mostrar(el) {
  const [hoteis, usuarios, checklist] = await Promise.all([api('/api/hoteis'), api('/api/usuarios'), api('/api/checklist')]);
  const M = estado.meta;
  const admin = estado.usuario.papel === 'admin';
  // Perfis que o gerente pode atribuir (a regra vale também no servidor).
  const papeisPermitidos = admin ? M.PAPEIS : Object.fromEntries(Object.entries(M.PAPEIS).filter(([k]) => ['gerente', 'governanta', 'manutencao_chefe', 'tecnico', 'aprovador_financeiro'].includes(k)));
  const optsHoteis = Object.fromEntries(hoteis.map((h) => [h.id, h.nome]));

  render(el, html`
    <div class="cabecalho"><div><h1>${admin ? 'Cadastros' : 'Equipe e cadastros'}</h1><p class="sub">${admin ? 'Unidades, quartos, checklist e usuários da plataforma.' : `Usuários, quartos e checklist do ${estado.usuario.hotel_nome}.`}</p></div></div>
      ${admin ? html`<section class="card" style="margin-bottom:1rem"><h2>Unidades hoteleiras</h2>
        <div class="tabela-wrap"><table><thead><tr><th>Hotel</th><th>Cidade</th><th class="num">Quartos</th><th>Validação do gerente</th></tr></thead><tbody>
          ${hoteis.map((h) => html`<tr><td>${h.logo ? html`<img src="/img/hoteis/${h.logo}/horizontal.svg" alt="" style="height:22px;width:auto;display:block;margin-bottom:.2rem;background:#fff;border-radius:3px;padding:2px">` : ''}${h.nome}</td><td>${h.cidade || '—'}</td>
            <td class="num">${h.total_quartos}${h.quartos_provisorios ? html`<br><span class="badge warn sem-ponto">${h.quartos_provisorios} provisórios</span>` : !h.total_quartos ? html`<br><span class="badge danger sem-ponto">cadastrar</span>` : ''}</td><td><label class="check"><input type="checkbox" data-validacao="${h.id}" ${h.exige_validacao ? raw('checked') : ''}> exigida</label></td></tr>`)}</tbody></table></div>
        <form class="form" id="f-hotel" style="margin-top:1rem"><h3>Nova unidade</h3><div class="form-grade" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))">
          <label class="campo"><span class="obrig">Nome</span><input name="nome" required></label>
          <label class="campo"><span>Cidade</span><input name="cidade"></label></div>
          <div><button class="btn primario">Cadastrar unidade</button></div></form>
      </section>` : ''}
    <div class="grade grade-3">

      <section class="card"><h2>Numeração real dos quartos</h2>
        <p class="small muted">Quartos criados só pela quantidade ficam com numeração provisória (1, 2, 3…). Informe aqui as faixas reais por andar:
          os provisórios sem histórico são substituídos pelos números informados.</p>
        <form class="form" id="f-numeracao">
          ${admin ? html`<label class="campo"><span class="obrig">Hotel</span><select name="hotel_id" required>${hoteis.map((h) => html`<option value="${h.id}" ${h.id === hoteis.find((x) => x.quartos_provisorios)?.id ? raw('selected') : ''}>${h.nome}${h.quartos_provisorios ? ` — ${h.quartos_provisorios} provisórios` : ''}</option>`)}</select></label>`
            : html`<p class="small"><strong>${hoteis[0]?.quartos_provisorios || 0}</strong> quarto(s) provisório(s) no seu hotel.</p>`}
          <div id="faixas">${linhaFaixa()}</div>
          <div class="acoes-topo"><button type="button" class="btn pequeno" id="add-faixa">+ andar</button></div>
          <div class="aviso danger" id="erro-numeracao" hidden></div>
          <div><button class="btn primario" type="submit">Aplicar numeração</button></div></form>
      </section>
      <section class="card"><h2>Cadastrar quartos em lote</h2>
        <p class="small muted">Cadastre um andar inteiro de uma vez (ex.: 201 a 218). Números já existentes são ignorados.</p>
        <form class="form" id="f-lote"><div class="form-grade">
          <label class="campo"><span class="obrig">Hotel</span><select name="hotel_id" required>${opcoes(optsHoteis, hoteis[0]?.id)}</select></label>
          <label class="campo"><span class="obrig">Do número</span><input type="number" min="1" name="inicio" required></label>
          <label class="campo"><span class="obrig">Até o número</span><input type="number" min="1" name="fim" required></label>
          <label class="campo"><span>Andar</span><input name="andar"></label>
          <label class="campo"><span>Tipo</span><input name="tipo" placeholder="Standard, Luxo, Suíte…"></label>
          <label class="campo"><span>Periodicidade de inspeção (dias)</span><input type="number" min="1" name="periodicidade_inspecao_dias" value="30"></label></div>
          <div><button class="btn primario">Cadastrar quartos</button></div></form>
      </section>
      <section class="card"><h2>Novo quarto</h2>
        <form class="form" id="f-quarto"><div class="form-grade">
          <label class="campo"><span class="obrig">Hotel</span><select name="hotel_id" required>${opcoes(optsHoteis, hoteis[0]?.id)}</select></label>
          <label class="campo"><span class="obrig">Número</span><input name="numero" required></label>
          <label class="campo"><span>Andar</span><input name="andar"></label>
          <label class="campo"><span>Tipo</span><input name="tipo" placeholder="Standard, Luxo, Suíte…"></label>
          <label class="campo"><span>Classificação (estrelas)</span><select name="estrelas">${opcoes({ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }, '', { vazio: '—' })}</select></label>
          <label class="campo"><span>Periodicidade de inspeção (dias)</span><input type="number" min="1" name="periodicidade_inspecao_dias" value="30"></label></div>
          <p class="small muted">Equipamentos padrão (${M.EQUIPAMENTOS_PADRAO.join(', ')}) são cadastrados automaticamente.</p>
          <div><button class="btn primario">Cadastrar quarto</button></div></form>
      </section>
    </div>
    <section class="card" style="margin-top:1rem"><h2>Checklist de inspeção</h2>
      ${checklist.personalizado ? html`<p class="small muted">Itens marcados como <strong>básicos</strong> são necessários para o funcionamento e a venda do quarto: uma falha gera OS com prioridade alta e bloqueia o quarto. Os demais são tratados como crônicos (dependem de ocupação/budget). As alterações valem para as próximas inspeções.</p>
        ${[...new Set(checklist.itens.map((i) => i.ambiente))].map((amb) => html`<h3 style="margin-top:1rem">${amb}</h3>
          <div class="tabela-wrap"><table><thead><tr><th>Item</th><th>Categoria</th><th>Equipamento</th><th>Tipo</th><th>Situação</th></tr></thead><tbody>
          ${checklist.itens.filter((i) => i.ambiente === amb).map((i) => html`<tr style="${i.ativo ? '' : 'opacity:.55'}"><td>${i.item}</td><td>${M.CATEGORIAS[i.categoria]}</td><td>${i.equipamento || '—'}</td>
            <td>${i.critico ? html`<span class="badge danger sem-ponto">Básico p/ venda</span>` : html`<span class="badge sem-ponto">Crônico</span>`}</td>
            <td><button class="btn pequeno" data-item-checklist="${i.id}">${i.ativo ? 'Desativar' : 'Reativar'}</button></td></tr>`)}</tbody></table></div>`)}`
        : html`<p class="small muted">Este hotel usa o checklist padrão do sistema. Adicione itens abaixo para criar um checklist próprio.</p>`}
      <form class="form" id="f-checklist" style="margin-top:1rem"><h3>Novo item</h3><div class="form-grade">
        <input type="hidden" name="hotel_id" value="${checklist.hotel_id}">
        <label class="campo"><span class="obrig">Item</span><input name="item" required></label>
        <label class="campo"><span class="obrig">Grupo</span><input name="ambiente" list="grupos-checklist" required value="${checklist.itens[0]?.ambiente || ''}">
          <datalist id="grupos-checklist">${[...new Set(checklist.itens.map((i) => i.ambiente))].map((a) => html`<option value="${a}">`)}</datalist></label>
        <label class="campo"><span class="obrig">Categoria</span><select name="categoria" required>${opcoes(M.CATEGORIAS, '', { vazio: 'Selecione…' })}</select></label>
        <label class="campo"><span>Local</span><select name="local">${opcoes(M.LOCAIS, 'quarto')}</select></label>
        <label class="campo"><span>Equipamento vinculado</span><input name="equipamento" placeholder="Ex.: Televisão"><small>Precisa ter o mesmo nome do equipamento cadastrado no quarto.</small></label>
        <label class="check campo"><input type="checkbox" name="critico"> Básico para funcionamento e venda</label></div>
        <div><button class="btn primario">Adicionar item</button></div></form>
    </section>
    <section class="card" style="margin-top:1rem"><h2>Usuários</h2>
      <div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Unidade</th><th>Situação</th></tr></thead><tbody>
        ${usuarios.map((u) => html`<tr><td>${u.nome}</td><td><strong>${u.login}</strong></td><td>${M.PAPEIS[u.papel]}</td><td>${u.hotel_nome || 'Rede (todas)'}</td>
          <td class="nowrap">${u.id === estado.usuario.id ? html`<span class="badge ok">Você</span>` : !u.gerenciavel ? html`<span class="badge sem-ponto" title="Acesso da rede: só o administrador geral pode alterar">Acesso da rede</span>` : html`<button class="btn pequeno ${u.ativo ? '' : 'primario'}" data-alternar="${u.id}">${u.ativo ? 'Desativar' : 'Reativar'}</button>
            <button class="btn pequeno" data-senha="${u.id}" data-nome="${u.nome}">Redefinir senha</button>
            <button class="btn pequeno perigo" data-excluir="${u.id}" data-nome="${u.nome}" data-login="${u.login}">Excluir</button>`}</td></tr>`)}</tbody></table></div>
      <form class="form" id="f-usuario" style="margin-top:1rem"><h3>Novo usuário</h3><div class="form-grade">
        <label class="campo"><span class="obrig">Nome</span><input name="nome" required></label>
        <label class="campo"><span class="obrig">Usuário (login)</span><input name="login" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,29}" autocapitalize="none" spellcheck="false" placeholder="ex.: joao.silva"><small>Sem espaços nem acentos: letras, números, ponto, hífen ou sublinhado.</small></label>
        <label class="campo"><span class="obrig">Perfil</span><select name="papel" required>${opcoes(papeisPermitidos, admin ? 'gerente' : 'tecnico')}</select></label>
        ${admin ? html`<label class="campo"><span>Unidade</span><select name="hotel_id">${opcoes(optsHoteis, hoteis.length === 1 ? hoteis[0].id : '', { vazio: 'Rede (todas as unidades)' })}</select><small>"Rede" enxerga todos os hotéis, inclusive os futuros.</small></label>` : ''}
        <label class="campo"><span class="obrig">Senha inicial</span><input name="senha" type="password" minlength="8" autocomplete="new-password" required><small>Mínimo de 8 caracteres. Peça ao usuário para trocá-la no primeiro acesso.</small></label></div>
        <div><button class="btn primario">Cadastrar usuário</button></div></form>
    </section>`);

  const enviar = (sel, url, msg) => $(sel, el)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post(url, dadosForm(e.target)); toast(msg); recarregar(); } catch (err) { toast(err.message, 'erro'); }
  });
  enviar('#f-hotel', '/api/hoteis', 'Unidade cadastrada. Recarregue a página para vê-la nos seletores.');
  enviar('#f-quarto', '/api/quartos', 'Quarto cadastrado.');
  enviar('#f-checklist', '/api/checklist', 'Item adicionado ao checklist.');
  for (const b of $$('[data-item-checklist]', el)) b.addEventListener('click', async () => { await post(`/api/checklist/${b.dataset.itemChecklist}/alternar`); recarregar(); });
  $('#add-faixa', el).addEventListener('click', () => $('#faixas', el).insertAdjacentHTML('beforeend', linhaFaixa().s));
  $('#f-numeracao', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const faixas = $$('[data-faixa]', el).map((l) => Object.fromEntries($$('[data-f]', l).map((i) => [i.dataset.f, i.value.trim()]))).filter((f) => f.inicio || f.fim);
    const total = faixas.reduce((n, f) => n + Math.max(0, Number(f.fim) - Number(f.inicio) + 1), 0);
    const erro = $('#erro-numeracao', el);
    erro.hidden = true;
    const b = e.target.querySelector('[type=submit]');
    if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = `Confirmar: criar ${total} quarto(s) e remover os provisórios`; return; }
    b.disabled = true;
    try {
      const r = await post('/api/quartos/numeracao', { hotel_id: e.target.hotel_id?.value, faixas });
      toast(`${r.criados} quarto(s) criados, ${r.removidos} provisório(s) removidos.${r.mantidos.length ? ` Mantidos por terem histórico: ${r.mantidos.join(', ')}.` : ''}${r.ignorados.length ? ` Já existiam: ${r.ignorados.join(', ')}.` : ''}`);
      recarregar();
    } catch (err) { erro.textContent = err.message; erro.hidden = false; b.disabled = false; b.dataset.confirmar = ''; b.textContent = 'Aplicar numeração'; }
  });
  $('#f-lote', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await post('/api/quartos/lote', dadosForm(e.target));
      toast(`${r.criados} quarto(s) cadastrado(s).${r.ignorados.length ? ` Já existiam: ${r.ignorados.join(', ')}.` : ''}`);
      recarregar();
    } catch (err) { toast(err.message, 'erro'); }
  });
  for (const b of $$('[data-excluir]', el)) {
    b.addEventListener('click', () => {
      const { el: m, fechar } = modal(html`<h2>Excluir usuário</h2>
        <p><strong>${b.dataset.nome}</strong><br><span class="muted">usuário: ${b.dataset.login}</span></p>
        <p class="small">O acesso é removido na hora. Se o usuário já participou de demandas ou inspeções, o nome dele continua no histórico desses registros. Esta ação não pode ser desfeita.</p>
        <div class="aviso danger" id="erro-excluir" hidden></div>
        <div class="rodape-modal"><button class="btn" data-fechar>Cancelar</button><button class="btn perigo" id="confirmar-exclusao">Excluir usuário</button></div>`.s);
      $('#confirmar-exclusao', m).addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const r = await post(`/api/usuarios/${b.dataset.excluir}/excluir`);
          fechar();
          toast(r.modo === 'apagado' ? 'Usuário excluído.' : 'Usuário excluído. O nome foi mantido no histórico das demandas.');
          recarregar();
        } catch (err) { const x = $('#erro-excluir', m); x.textContent = err.message; x.hidden = false; e.target.disabled = false; }
      });
    });
  }
  for (const b of $$('[data-senha]', el)) {
    b.addEventListener('click', () => {
      const { el: m, fechar } = modal(html`<h2>Redefinir senha</h2><p>${b.dataset.nome}</p><form class="form" id="f-rs">
        <label class="campo"><span class="obrig">Nova senha</span><input type="password" name="senha" minlength="8" autocomplete="new-password" required></label>
        <p class="small muted">As sessões abertas desse usuário serão encerradas.</p>
        <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Salvar</button></div></form>`.s);
      $('#f-rs', m).addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await post(`/api/usuarios/${b.dataset.senha}/senha`, dadosForm(e.target)); fechar(); toast('Senha redefinida.'); } catch (err) { toast(err.message, 'erro'); }
      });
    });
  }
  enviar('#f-usuario', '/api/usuarios', 'Usuário cadastrado.');
  for (const c of $$('[data-validacao]', el)) {
    c.addEventListener('change', async () => { await put(`/api/hoteis/${c.dataset.validacao}`, { exige_validacao: c.checked }); toast('Configuração salva.'); });
  }
  for (const b of $$('[data-alternar]', el)) b.addEventListener('click', async () => { await post(`/api/usuarios/${b.dataset.alternar}/alternar`); recarregar(); });
}
