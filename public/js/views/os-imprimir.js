// Relatório da OS para imprimir ou salvar em PDF (pelo "Salvar como PDF" do navegador).
import { estado, api } from '../estado.js';
import { html, render, $, dataHora, moeda } from '../ui.js';

export async function mostrar(el, [id]) {
  const os = await api(`/api/os/${id}`);
  const M = estado.meta;
  const hotel = estado.hoteis.find((h) => h.id === os.hotel_id);
  const logo = hotel?.logo ? `/img/hoteis/${hotel.logo}/horizontal.svg` : '/img/rede/horizontal.svg';
  const fase = (f) => os.fotos.filter((x) => f.includes(x.fase) && !x.mime?.startsWith('video'));
  const antes = fase(['antes', 'inspecao']); const depois = fase(['depois', 'validacao']);
  const custo = os.custos.reduce((s, c) => s + c.valor, 0);
  const fotos = (lista) => (lista.length ? html`<div class="rel-fotos">${lista.slice(0, 4).map((f) => html`<figure><img src="/uploads/${f.arquivo}" alt=""><figcaption>${dataHora(f.criado_em)}${f.legenda ? ` · ${f.legenda}` : ''}</figcaption></figure>`)}</div>` : html`<p class="muted">Sem fotos.</p>`);

  render(el, html`
    <div class="acoes-topo nao-imprimir" style="margin-bottom:1rem"><a class="btn" href="#/os/${os.id}">← Voltar para a OS</a>
      <button class="btn primario" id="imprimir">🖨️ Imprimir / salvar em PDF</button></div>
    <article class="relatorio">
      <header class="rel-cab"><img src="${logo}" alt="${os.hotel_nome}"><div><h1>${os.protocolo}</h1><p>${os.titulo}</p></div></header>
      <table class="rel-dados"><tbody>
        <tr><th>Hotel</th><td>${os.hotel_nome}</td><th>Local</th><td>${M.LOCAIS[os.local]}${os.quarto_numero ? ` · Quarto ${os.quarto_numero}` : ''}${os.equipamento_tipo ? ` · ${os.equipamento_tipo}` : ''}</td></tr>
        <tr><th>Categoria</th><td>${M.CATEGORIAS[os.categoria]}</td><th>Prioridade</th><td>${M.PRIORIDADES[os.prioridade]}</td></tr>
        <tr><th>Situação</th><td>${M.STATUS[os.status]}</td><th>Prazo</th><td>${dataHora(os.prazo_previsto)}</td></tr>
        <tr><th>Aberta em</th><td>${dataHora(os.criado_em)} por ${os.aberto_por_nome}</td><th>Responsável</th><td>${os.responsavel_nome || '—'}</td></tr>
        <tr><th>Concluída em</th><td>${dataHora(os.concluido_em)}${os.executado_por_nome ? ` por ${os.executado_por_nome}` : ''}</td><th>Validada em</th><td>${dataHora(os.validado_em)}${os.validado_por_nome ? ` por ${os.validado_por_nome}` : ''}</td></tr>
      </tbody></table>
      <h2>Problema</h2><p class="pre">${os.descricao}</p>
      ${os.relatorio_conclusao ? html`<h2>Serviço realizado</h2><p class="pre">${os.relatorio_conclusao}</p>` : ''}
      <div class="rel-comparativo"><section><h2>Antes</h2>${fotos(antes)}</section><section><h2>Depois</h2>${fotos(depois)}</section></div>
      <h2>Custos — ${moeda(custo)}</h2>
      ${os.custos.length ? html`<table class="rel-tabela"><thead><tr><th>Descrição</th><th>Tipo</th><th class="num">Valor</th></tr></thead><tbody>
        ${os.custos.map((c) => html`<tr><td>${c.descricao}</td><td>${M.TIPOS_CUSTO[c.tipo]}</td><td class="num">${moeda(c.valor)}</td></tr>`)}</tbody></table>` : html`<p class="muted">Nenhum custo registrado.</p>`}
      <h2>Histórico</h2>
      <table class="rel-tabela"><tbody>${os.eventos.map((ev) => html`<tr><td class="nowrap">${dataHora(ev.criado_em)}</td><td>${ev.usuario_nome || 'Sistema'}</td>
        <td>${ev.status_para ? html`<strong>${M.STATUS[ev.status_para]}</strong>${ev.texto ? ' — ' : ''}` : ''}${ev.texto || ''}</td></tr>`)}</tbody></table>
      <div class="rel-assinaturas"><div>Responsável pela execução</div><div>Gerente / validação</div></div>
      <p class="rel-rodape">Emitido em ${dataHora(new Date().toISOString())} · Gestão de Manutenção Tri Hotéis</p>
    </article>`);
  $('#imprimir', el).addEventListener('click', () => window.print());
}
