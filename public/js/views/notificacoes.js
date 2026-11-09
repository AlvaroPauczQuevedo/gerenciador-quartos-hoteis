import { estado, api, post } from '../estado.js';
import { atualizarContador, recarregar } from '../app.js';
import { html, render, $, $$, dataHora, relativo, toast } from '../ui.js';
import { estadoPush, ativarPush, desativarPush, testarPush, instalar } from '../pwa.js';

// O que cada perfil recebe no celular (as notificações aqui dentro continuam completas).
const RESUMO_PUSH = {
  tecnico: 'serviços designados a você, correções pedidas, prazos próximos e atrasos',
  manutencao_chefe: 'novas demandas, atrasos, pedidos de material, reaberturas, correções e decisões de orçamento',
  gerente: 'serviços concluídos aguardando sua validação, quartos bloqueados, devoluções, recusas, recorrências e emergências',
  governanta: 'inspeções vencidas, devoluções, recusas e serviços concluídos das suas solicitações',
  aprovador_financeiro: 'orçamentos aguardando aprovação',
  diretoria: 'orçamentos aguardando aprovação e recorrências críticas',
  admin: 'recorrências críticas',
};

async function quadroPush() {
  const situacao = await estadoPush();
  const resumo = RESUMO_PUSH[estado.usuario.papel] || 'avisos importantes';
  const corpo = {
    ativo: html`<p><span class="badge ok">Ativas neste aparelho</span></p>
      <div class="acoes-topo"><button class="btn" id="push-teste">Enviar notificação de teste</button><button class="btn perigo" id="push-desativar">Desativar neste aparelho</button></div>`,
    inativo: html`<p>Receba no celular, mesmo com o app fechado: ${resumo}.</p>
      <div class="acoes-topo"><button class="btn primario" id="push-ativar">Ativar notificações neste aparelho</button></div>`,
    bloqueado: html`<div class="aviso warn"><span class="icone">!</span><div>As notificações estão <strong>bloqueadas</strong> para este site. Libere nas configurações do navegador
      (ícone de cadeado ao lado do endereço → Notificações → Permitir) e volte a esta tela.</div></div>`,
    'instalar-ios': html`<div class="aviso info"><span class="icone">i</span><div>No iPhone/iPad, as notificações só funcionam com o app instalado na tela de início (iOS 16.4 ou mais novo).</div></div>
      <div class="acoes-topo" style="margin-top:.75rem"><button class="btn primario" id="push-instalar">Como instalar</button></div>`,
    indisponivel: html`<p class="muted">Este navegador não oferece notificações push. Use o Chrome, Edge ou Firefox no Android/computador, ou o app instalado no iPhone.</p>`,
  }[situacao];
  return html`<section class="card" style="margin-bottom:1rem"><div class="card-titulo"><h2>📲 Notificações neste aparelho</h2></div>
    ${corpo}
    <p class="small muted" style="margin-top:.75rem">Entre 22h e 7h só chegam avisos de emergência. Ao sair da conta, este aparelho deixa de receber os seus avisos.</p></section>`;
}

export async function mostrar(el) {
  const [r, push] = await Promise.all([api('/api/notificacoes'), quadroPush()]);
  atualizarContador(r.naoLidas);
  render(el, html`
    <div class="cabecalho"><div><h1>Notificações</h1><p class="sub">${r.naoLidas} não lida(s)</p></div>
      ${r.naoLidas ? html`<button class="btn" id="todas">Marcar todas como lidas</button>` : ''}</div>
    ${push}
    <section class="card">${r.itens.length ? r.itens.map((n) => html`<div class="notif ${n.lida ? '' : 'nao-lida'}">
      <div style="flex:1;min-width:0"><div class="tipo">${estado.meta.NOTIFICACAO_TIPOS[n.tipo] || n.tipo}</div>
        <div>${n.mensagem}</div><div class="muted small" title="${dataHora(n.criado_em)}">${relativo(n.criado_em)} · ${dataHora(n.criado_em)}</div></div>
      <div class="acoes-topo">${n.os_id ? html`<a class="btn pequeno" href="#/os/${n.os_id}" data-ler="${n.id}">Abrir OS</a>` : n.quarto_id ? html`<a class="btn pequeno" href="#/quartos/${n.quarto_id}" data-ler="${n.id}">Ver quarto</a>` : ''}
        ${n.lida ? '' : html`<button class="btn pequeno" data-marcar="${n.id}">Lida</button>`}</div></div>`) : html`<p class="vazio">Nenhuma notificação.</p>`}</section>`);

  const acao = (sel, fn, ok) => $(sel, el)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const res = await fn(); if (ok) toast(ok(res)); recarregar(); } catch (err) { toast(err.message, 'erro'); e.target.disabled = false; }
  });
  acao('#push-ativar', ativarPush, () => 'Notificações ativadas neste aparelho.');
  acao('#push-desativar', desativarPush, () => 'Notificações desativadas neste aparelho.');
  acao('#push-teste', testarPush, (res) => (res.enviados ? 'Notificação de teste enviada — deve aparecer em instantes.' : 'Não foi possível entregar o teste. Tente desativar e ativar de novo.'));
  $('#push-instalar', el)?.addEventListener('click', instalar);
  $('#todas', el)?.addEventListener('click', async () => { await post('/api/notificacoes/todas/lida'); recarregar(); });
  for (const b of $$('[data-marcar]', el)) b.addEventListener('click', async () => { await post(`/api/notificacoes/${b.dataset.marcar}/lida`); recarregar(); });
  for (const a of $$('[data-ler]', el)) a.addEventListener('click', () => { post(`/api/notificacoes/${a.dataset.ler}/lida`).then(() => atualizarContador(Math.max(0, estado.naoLidas - 1))); });
}
