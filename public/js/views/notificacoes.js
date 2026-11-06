import { estado, api, post } from '../estado.js';
import { atualizarContador, recarregar } from '../app.js';
import { html, render, $, $$, dataHora, relativo } from '../ui.js';

export async function mostrar(el) {
  const r = await api('/api/notificacoes');
  atualizarContador(r.naoLidas);
  render(el, html`
    <div class="cabecalho"><div><h1>Notificações</h1><p class="sub">${r.naoLidas} não lida(s)</p></div>
      ${r.naoLidas ? html`<button class="btn" id="todas">Marcar todas como lidas</button>` : ''}</div>
    <section class="card">${r.itens.length ? r.itens.map((n) => html`<div class="notif ${n.lida ? '' : 'nao-lida'}">
      <div style="flex:1;min-width:0"><div class="tipo">${estado.meta.NOTIFICACAO_TIPOS[n.tipo] || n.tipo}</div>
        <div>${n.mensagem}</div><div class="muted small" title="${dataHora(n.criado_em)}">${relativo(n.criado_em)} · ${dataHora(n.criado_em)}</div></div>
      <div class="acoes-topo">${n.os_id ? html`<a class="btn pequeno" href="#/os/${n.os_id}" data-ler="${n.id}">Abrir OS</a>` : n.quarto_id ? html`<a class="btn pequeno" href="#/quartos/${n.quarto_id}" data-ler="${n.id}">Ver quarto</a>` : ''}
        ${n.lida ? '' : html`<button class="btn pequeno" data-marcar="${n.id}">Lida</button>`}</div></div>`) : html`<p class="vazio">Nenhuma notificação.</p>`}</section>`);

  $('#todas', el)?.addEventListener('click', async () => { await post('/api/notificacoes/todas/lida'); recarregar(); });
  for (const b of $$('[data-marcar]', el)) b.addEventListener('click', async () => { await post(`/api/notificacoes/${b.dataset.marcar}/lida`); recarregar(); });
  for (const a of $$('[data-ler]', el)) a.addEventListener('click', () => { post(`/api/notificacoes/${a.dataset.ler}/lida`).then(() => atualizarContador(Math.max(0, estado.naoLidas - 1))); });
}
