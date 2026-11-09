import { estado, api, qs, ehRede } from '../estado.js';
import { html, render, numero, moeda, relativo, dataHora } from '../ui.js';
import { tabelaOS, kpi } from './componentes.js';
import { estadoPush, podeInstalar, instalar } from '../pwa.js';

const CHAVE_CONVITE = 'convite-push-dispensado';
const conviteDispensado = () => { try { return localStorage.getItem(CHAVE_CONVITE) === '1'; } catch { return false; } };

export async function mostrar(el) {
  const u = estado.usuario;
  const p = u.papel;
  const [resumo, notifs, situacaoPush] = await Promise.all([api('/api/resumo'), api('/api/notificacoes'), estadoPush().catch(() => 'indisponivel')]);
  const convidarInstalar = podeInstalar();
  const convidarPush = !convidarInstalar && situacaoPush === 'inativo' && !conviteDispensado();

  const blocos = [];
  const carregar = (titulo, filtros, opts = {}) => api(`/api/os${qs({ limite: 8, ...filtros })}`).then((lista) => ({ titulo, lista, ...opts }));
  if (p === 'tecnico') {
    blocos.push(carregar('Meus serviços em andamento', { responsavel_id: 'eu', grupo: 'todas_abertas' }, { link: '#/os?responsavel_id=eu' }));
    blocos.push(carregar('Aprovadas sem responsável (disponíveis)', { grupo: 'aprovadas' }, { link: '#/os?grupo=aprovadas' }));
  }
  if (p === 'manutencao_chefe' || p === 'admin') {
    blocos.push(carregar('Novas solicitações recebidas', { grupo: 'novas' }, { link: '#/os?grupo=novas' }));
    blocos.push(carregar('Demandas atrasadas', { grupo: 'atrasadas' }, { link: '#/os?grupo=atrasadas' }));
  }
  if (p === 'gerente' || p === 'governanta' || p === 'admin') {
    blocos.push(carregar('Concluídas aguardando sua validação', { grupo: 'validacao' }, { link: '#/os?grupo=validacao' }));
    blocos.push(carregar('Devolvidas para complementação', { status: 'devolvida_complementacao' }, { link: '#/os?status=devolvida_complementacao' }));
  }
  if (p === 'gerente' || p === 'governanta') blocos.push(carregar('Minhas solicitações em aberto', { aberto_por: 'eu', grupo: 'todas_abertas' }, { link: '#/os?aberto_por=eu' }));
  if (p === 'aprovador_financeiro' || p === 'diretoria') blocos.push(carregar('Orçamentos aguardando autorização', { grupo: 'autorizacao' }, { link: '#/os?grupo=autorizacao' }));
  if (p === 'diretoria') blocos.push(carregar('Emergenciais em aberto na rede', { prioridade: 'emergencial', grupo: 'todas_abertas' }));
  const listas = await Promise.all(blocos);
  const recorrencia = p !== 'tecnico' && p !== 'governanta' ? await api('/api/recorrencia') : null;

  const r = resumo;
  render(el, html`
    <div class="cabecalho">
      <div><h1>Olá, ${u.nome.split(' ')[0]}</h1><p class="sub">${estado.meta.PAPEIS[p]} · ${u.hotel_nome || (estado.hoteis.length === 1 ? estado.hoteis[0].nome : 'Visão consolidada da rede')} · ${new Date().toLocaleDateString('pt-BR', { dateStyle: 'full' })}</p></div>
      <div class="acoes-topo">
        ${['gerente', 'governanta', 'admin', 'manutencao_chefe'].includes(p) ? html`<a class="btn primario" href="#/os/nova">+ Nova solicitação</a>` : ''}
        ${['gerente', 'governanta', 'admin'].includes(p) ? html`<a class="btn" href="#/inspecoes">Inspeções</a>` : ''}
        ${ehRede() && p !== 'tecnico' ? html`<a class="btn" href="#/rede">Visão da rede</a>` : ''}
      </div>
    </div>
    ${convidarInstalar ? html`<div class="aviso info" id="convite-instalar" style="margin-bottom:1rem"><span class="icone">📲</span>
      <div style="flex:1"><strong>Instale o app no celular</strong> para abrir com um toque e receber os avisos da manutenção.</div>
      <button class="btn pequeno primario" id="instalar-inicio">Como instalar</button></div>` : ''}
    ${convidarPush ? html`<div class="aviso info" id="convite-push" style="margin-bottom:1rem"><span class="icone">📲</span>
      <div style="flex:1">Receba os avisos da manutenção no celular, mesmo com o sistema fechado. <a href="#/notificacoes">Ativar notificações</a></div>
      <button class="btn pequeno" id="dispensar-push" aria-label="Dispensar">Agora não</button></div>` : ''}
    <div class="kpis">
      ${kpi('Quartos liberados', `${r.liberados}/${r.quartos}`, { detalhe: 'disponíveis para comercialização', classe: 'bom', href: '#/quartos?status_comercial=liberado' })}
      ${kpi('Quartos bloqueados', r.bloqueados, { classe: r.bloqueados ? 'atencao' : '', href: '#/quartos?status_comercial=bloqueado' })}
      ${kpi('Conservação média', r.estrelas_media ? `${numero(r.estrelas_media, 1)} ★` : '—', { detalhe: 'avaliação das inspeções' })}
      ${kpi('Demandas em aberto', r.os_abertas, { href: '#/os?grupo=todas_abertas' })}
      ${kpi('Emergenciais', r.emergenciais, { classe: r.emergenciais ? 'alerta' : '', href: '#/os?prioridade=emergencial&grupo=todas_abertas' })}
      ${kpi('Atrasadas', r.atrasadas, { classe: r.atrasadas ? 'alerta' : 'bom', href: '#/os?grupo=atrasadas' })}
      ${kpi('Aguardando validação', r.aguardando_validacao, { href: '#/os?grupo=validacao' })}
      ${kpi('Aguardando autorização', r.aguardando_autorizacao, { href: '#/os?grupo=autorizacao' })}
      ${kpi('Inspeções vencidas', r.inspecoes_vencidas, { classe: r.inspecoes_vencidas ? 'atencao' : 'bom', href: '#/inspecoes' })}
      ${kpi('Problemas crônicos', r.cronicos, { href: '#/quartos?com_problemas=1' })}
      ${kpi('Custo (30 dias)', moeda(r.custo_30d))}
      ${r.orcamento_mes?.previsto ? kpi('Orçamento do mês', `${Math.round((r.orcamento_mes.custo / r.orcamento_mes.previsto) * 100)}%`, {
        detalhe: `${moeda(r.orcamento_mes.custo)} de ${moeda(r.orcamento_mes.previsto)}`,
        classe: r.orcamento_mes.custo > r.orcamento_mes.previsto ? 'alerta' : r.orcamento_mes.custo > r.orcamento_mes.previsto * 0.8 ? 'atencao' : 'bom' }) : ''}
    </div>
    ${recorrencia?.alertas.filter((a) => a.nivel === 'critico').slice(0, 3).map((a) => html`
      <div class="aviso danger" style="margin-bottom:.75rem"><span class="icone">↻</span><div><strong>Recorrência crítica — ${a.hotel_nome}, quarto ${a.quarto_numero}</strong><br>${a.recomendacao} <a href="#/recorrencia">Ver análise</a></div></div>`)}
    <div class="col-principal">
      <div class="pilha">${listas.map((b) => html`<section class="card">
        <div class="card-titulo"><h2>${b.titulo} <span class="muted">(${b.lista.length}${b.lista.length === 8 ? '+' : ''})</span></h2>${b.link ? html`<a href="${b.link}">Ver todas →</a>` : ''}</div>
        ${tabelaOS(b.lista, { compacta: true, vazio: 'Nada pendente aqui.' })}
      </section>`)}</div>
      <section class="card">
        <div class="card-titulo"><h2>Atualizações recentes</h2><a href="#/notificacoes">Todas →</a></div>
        ${notifs.itens.length ? html`<ul class="lista-simples">${notifs.itens.slice(0, 12).map((n) => html`<li>
          <div class="small"><strong style="color:var(--primary-2)">${estado.meta.NOTIFICACAO_TIPOS[n.tipo] || n.tipo}</strong>${n.lida ? '' : html` <span class="badge info sem-ponto">nova</span>`}</div>
          ${n.os_id ? html`<a href="#/os/${n.os_id}">${n.mensagem}</a>` : n.quarto_id ? html`<a href="#/quartos/${n.quarto_id}">${n.mensagem}</a>` : n.mensagem}
          <div class="muted small" title="${dataHora(n.criado_em)}">${relativo(n.criado_em)}</div></li>`)}</ul>` : html`<p class="vazio">Sem notificações.</p>`}
      </section>
    </div>`);
  el.querySelector('#instalar-inicio')?.addEventListener('click', instalar);
  el.querySelector('#dispensar-push')?.addEventListener('click', () => {
    try { localStorage.setItem(CHAVE_CONVITE, '1'); } catch { /* sem armazenamento local */ }
    el.querySelector('#convite-push')?.remove();
  });
}
