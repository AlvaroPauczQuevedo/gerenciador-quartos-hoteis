import { estado, api, post, qs, ehRede, marcaDoUsuario } from './estado.js';
import { html, render, $, toast, esc, modal, dadosForm } from './ui.js';
import * as offline from './offline.js';
import { iniciarPWA, podeInstalar, instalar, aoMudar, aoSair, revincular } from './pwa.js';

const ROTAS = [
  [/^\/?$/, 'inicio'],
  [/^\/inicio$/, 'inicio'],
  [/^\/os$/, 'os-lista'],
  [/^\/os\/nova$/, 'os-nova'],
  [/^\/os\/(\d+)$/, 'os-detalhe'],
  [/^\/quartos$/, 'quartos'],
  [/^\/quartos\/(\d+)$/, 'quarto-detalhe'],
  [/^\/inspecoes$/, 'inspecoes'],
  [/^\/inspecoes\/(\d+)$/, 'inspecao'],
  [/^\/indicadores$/, 'indicadores'],
  [/^\/recorrencia$/, 'recorrencia'],
  [/^\/rede$/, 'rede'],
  [/^\/notificacoes$/, 'notificacoes'],
  [/^\/cadastros$/, 'cadastros'],
  [/^\/qrcodes$/, 'qrcodes'],
  [/^\/auditoria$/, 'auditoria'],
  [/^\/obrigacoes$/, 'obrigacoes'],
  [/^\/conta$/, 'conta'],
  [/^\/pendencias$/, 'pendencias'],
  [/^\/preventiva$/, 'preventiva'],
  [/^\/estoque$/, 'estoque'],
  [/^\/backups$/, 'backups'],
  [/^\/os\/(\d+)\/imprimir$/, 'os-imprimir'],
];

// Menu por perfil: cada papel vê primeiro o que mais usa.
function menu() {
  const p = estado.usuario.papel;
  const itens = [];
  const add = (rota, rotulo, grupo = 'Operação') => itens.push({ rota, rotulo, grupo });
  add('#/inicio', p === 'tecnico' ? 'Meus serviços' : 'Início');
  if (['gerente', 'governanta', 'admin'].includes(p)) add('#/os/nova', 'Nova solicitação');
  add('#/os', p === 'tecnico' ? 'Painel da manutenção' : 'Demandas (OS)');
  if (p === 'tecnico') add('#/pendencias', 'Envios pendentes');
  add('#/quartos', 'Quartos');
  if (['gerente', 'governanta', 'admin'].includes(p)) add('#/inspecoes', 'Inspeções');
  if (['gerente', 'admin'].includes(p)) add('#/preventiva', 'Preventiva');
  if (['gerente', 'admin'].includes(p)) add('#/estoque', 'Estoque');
  if (['gerente', 'admin', 'diretoria'].includes(p)) add('#/obrigacoes', 'Obrigações legais');
  if (p !== 'tecnico' && p !== 'governanta') {
    add('#/indicadores', 'Indicadores', 'Gestão');
    add('#/recorrencia', 'Recorrência', 'Gestão');
  }
  if (ehRede() && p !== 'tecnico') add('#/rede', 'Visão da rede', 'Gestão');
  if (p === 'admin' || p === 'gerente') add('#/cadastros', p === 'gerente' ? 'Equipe e cadastros' : 'Cadastros', 'Gestão');
  if (['admin', 'gerente', 'diretoria'].includes(p)) add('#/auditoria', 'Registro de ações', 'Gestão');
  if (p === 'admin') add('#/backups', 'Backups', 'Gestão');
  return itens;
}

let pararOuvirPWA = null;
function shell() {
  const u = estado.usuario;
  const marca = marcaDoUsuario();
  const grupos = {};
  for (const i of menu()) (grupos[i.grupo] ||= []).push(i);
  render($('#app'), html`
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="marca"><img src="${marca.src}" alt="${marca.alt}"><small>Manutenção & Conservação</small></div>
        ${Object.entries(grupos).map(([g, itens]) => html`<div class="grupo-nav">${g}</div>${itens.map((i) => html`<a class="nav" href="${i.rota}">${i.rotulo}</a>`)}`)}
        <a class="nav" href="#/notificacoes">Notificações <span class="contador" id="cont-notif"></span></a>
        <div class="rodape">
          <strong>${u.nome}</strong><br><span style="opacity:.75">${estado.meta.PAPEIS[u.papel]}${` · ${u.hotel_nome || (estado.hoteis.length === 1 ? estado.hoteis[0].nome : 'Rede')}`}</span>
          <button class="btn claro pequeno" id="instalar-app" hidden>📲 Instalar app</button>
          <a class="btn claro pequeno" href="#/conta">Minha conta</a>
          <button class="btn claro pequeno" id="senha">Alterar senha</button>
          <button class="btn claro pequeno" id="sair">Sair</button>
        </div>
      </aside>
      <div style="min-width:0">
        <header class="topo-movel">
          <button id="abrir-menu" aria-label="Abrir menu">☰</button>
          <img src="${marca.src}" alt="${marca.alt}">
          <span class="topo-acoes"><button id="instalar-app-m" class="instalar-topo" hidden aria-label="Instalar o app">📲 Instalar</button>
          <a href="#/notificacoes" aria-label="Notificações">🔔 <span class="contador" id="cont-notif-m"></span></a></span>
        </header>
        <div id="faixa-offline" class="faixa-offline" hidden role="status"></div>
        <main class="conteudo" id="conteudo"></main>
      </div>
    </div>`);
  $('#sair').addEventListener('click', sair);
  const botoesInstalar = [$('#instalar-app'), $('#instalar-app-m')];
  const atualizarInstalar = () => { for (const b of botoesInstalar) b.hidden = !podeInstalar(); };
  for (const b of botoesInstalar) b.addEventListener('click', instalar);
  atualizarInstalar();
  pararOuvirPWA?.();
  pararOuvirPWA = aoMudar(atualizarInstalar);
  $('#senha').addEventListener('click', alterarSenha);
  $('#abrir-menu').addEventListener('click', (e) => { e.stopPropagation(); $('.shell').classList.toggle('menu-aberto'); });
  document.addEventListener('click', (e) => {
    const s = $('.shell');
    if (s?.classList.contains('menu-aberto') && (!e.target.closest('#sidebar') || e.target.closest('a.nav'))) s.classList.remove('menu-aberto');
  });
  atualizarContador();
}

function alterarSenha() {
  const { el, fechar } = modal(html`<h2>Alterar senha</h2><form class="form" id="f-senha">
    <label class="campo"><span class="obrig">Senha atual</span><input type="password" name="atual" autocomplete="current-password" required></label>
    <label class="campo"><span class="obrig">Nova senha</span><input type="password" name="nova" minlength="8" autocomplete="new-password" required><small>Mínimo de 8 caracteres.</small></label>
    <label class="campo"><span class="obrig">Confirme a nova senha</span><input type="password" name="confirmacao" minlength="8" autocomplete="new-password" required></label>
    <div class="aviso danger" id="erro-senha" hidden></div>
    <div class="rodape-modal"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" type="submit">Salvar</button></div></form>`.s);
  $('#f-senha', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    const erro = $('#erro-senha', el);
    if (d.nova !== d.confirmacao) { erro.textContent = 'As senhas não conferem.'; erro.hidden = false; return; }
    try { await post('/api/eu/senha', d); fechar(); toast('Senha alterada.'); } catch (err) { erro.textContent = err.message; erro.hidden = false; }
  });
}

export function atualizarContador(n = estado.naoLidas) {
  estado.naoLidas = n;
  for (const id of ['#cont-notif', '#cont-notif-m']) {
    const el = $(id);
    if (!el) continue;
    el.textContent = n || '';
    el.hidden = !n;
    el.classList.toggle('alerta', n > 0);
  }
}

async function pollNotificacoes() {
  if (!estado.usuario || document.hidden) return;
  try {
    const r = await api('/api/notificacoes?nao_lidas=1');
    if (r.naoLidas > estado.naoLidas && r.itens[0]) toast(`🔔 ${r.itens[0].mensagem}`);
    atualizarContador(r.naoLidas);
  } catch { /* silencioso */ }
}

// Saída: avisa se há ações feitas sem internet que ainda não foram enviadas e apaga os dados guardados no aparelho.
async function sair() {
  const pendentes = await offline.contarPendentes();
  if (pendentes && !window.confirm(`Há ${pendentes} ação(ões) feita(s) sem internet que ainda não foram enviadas. Se sair agora, elas serão perdidas. Sair mesmo assim?`)) return;
  await aoSair();
  try { await post('/api/logout'); } catch { /* sem internet: encerra só neste aparelho */ }
  await offline.limparTudo();
  location.hash = '';
  iniciar();
}

// Faixa de aviso (sem internet / ações aguardando envio) e envio automático da fila.
let faixaPronta = false;
async function atualizarFaixa() {
  const el = $('#faixa-offline');
  if (!el) return;
  const pendentes = estado.usuario ? await offline.contarPendentes() : 0;
  const semRede = offline.modoTecnico() && offline.estaSemRede();
  if (!semRede && !pendentes) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `faixa-offline ${semRede ? 'sem-rede' : 'enviando'}`;
  el.innerHTML = `${semRede ? 'Sem conexão: você vê os dados salvos e suas ações serão enviadas quando a internet voltar.' : 'Enviando suas ações…'}${pendentes ? ` <a href="#/pendencias"><strong>${pendentes} aguardando envio</strong></a>` : ''}`;
}
function iniciarOffline() {
  if (faixaPronta) return;
  faixaPronta = true;
  const tentar = () => { if (estado.usuario && offline.modoTecnico()) offline.sincronizar(estado.usuario.id).catch(() => {}); };
  window.addEventListener('fila-mudou', atualizarFaixa);
  window.addEventListener('online', () => { offline.marcarRede(true); tentar(); });
  window.addEventListener('offline', () => offline.marcarRede(false));
  window.addEventListener('fila-sincronizada', () => { if (!document.querySelector('#modal-raiz')?.firstElementChild) recarregar(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tentar(); });
  setInterval(tentar, 30000);
  tentar();
}

// Deixa guardadas no aparelho as OS do técnico (e os detalhes), para consultar e trabalhar sem internet.
async function prepararOffline() {
  if (!offline.modoTecnico()) return;
  try {
    const abertas = await api(`/api/os${qs({ limite: 8, responsavel_id: 'eu', grupo: 'todas_abertas' })}`);
    await api(`/api/os${qs({ limite: 8, grupo: 'aprovadas' })}`).catch(() => {});
    const minhas = await api(`/api/os${qs({ responsavel_id: 'eu', grupo: 'todas_abertas', limite: 40 })}`);
    for (const o of [...new Map([...abertas, ...minhas].map((x) => [x.id, x])).values()].slice(0, 40)) await api(`/api/os/${o.id}`).catch(() => {});
    await api('/api/resumo').catch(() => {});
  } catch { /* sem internet: segue com o que já está guardado */ }
}

let navegacaoAtual = 0;
async function navegar() {
  if (!estado.usuario) return;
  const caminho = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const qr = /^\/q\/(\d+)$/.exec(caminho);
  if (qr) { location.replace(`#/quartos/${qr[1]}`); return; } // etiqueta QR na porta do quarto
  const relato = /^\/relatar\/(\d+)$/.exec(caminho);
  if (relato) { location.replace(`#/quartos/${relato[1]}`); return; } // quem já tem login vê a ficha do quarto
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const rota = ROTAS.find(([re]) => re.test(caminho));
  const el = $('#conteudo');
  for (const a of document.querySelectorAll('a.nav')) {
    const alvo = a.getAttribute('href').slice(1);
    const ativo = caminho === alvo || (alvo === '/inicio' && caminho === '/') ||
      (caminho.startsWith(`${alvo}/`) && !(alvo === '/os' && caminho === '/os/nova'));
    a.classList.toggle('ativo', ativo);
  }
  const id = ++navegacaoAtual;
  if (!rota) { render(el, html`<div class="vazio">Página não encontrada.</div>`); return; }
  render(el, html`<div class="carregando">Carregando…</div>`);
  try {
    const mod = await import(`./views/${rota[1]}.js`);
    if (id !== navegacaoAtual) return;
    const params = rota[0].exec(caminho).slice(1);
    await mod.mostrar(el, params, query);
    window.scrollTo(0, 0);
  } catch (e) {
    if (id !== navegacaoAtual) return;
    console.error(e);
    render(el, html`<div class="card aviso danger"><span class="icone">!</span><div><strong>Não foi possível carregar a página.</strong><br>${e.message}</div></div>`);
  }
}

export function recarregar() { navegar(); }

async function iniciar() {
  try {
    const eu = await api('/api/eu');
    Object.assign(estado, eu);
    offline.definirModoTecnico(estado.usuario.papel === 'tecnico');
    if (estado.usuario.trocar_senha) {
      const { mostrar } = await import('./views/trocar-senha.js');
      mostrar($('#app'), () => iniciar(), sair);
      return;
    }
    shell();
    navegar();
    revincular();
    iniciarOffline();
    atualizarFaixa();
    prepararOffline();
  } catch (e) {
    if (e?.status === 0) { // sem internet e sem dados guardados: não é logout
      render($('#app'), html`<div class="login"><div class="card"><h1 style="font-size:1.15rem">Sem conexão</h1><p class="muted">Conecte-se à internet para abrir o sistema. Depois do primeiro acesso, o profissional de manutenção consegue consultar suas OS e registrar ações mesmo sem sinal.</p><button class="btn primario" id="tentar-de-novo">Tentar de novo</button></div></div>`);
      $('#tentar-de-novo')?.addEventListener('click', () => iniciar());
      return;
    }
    estado.usuario = null;
    const relato = /^#\/relatar\/(\d+)/.exec(location.hash);
    if (relato) { // QR da porta sem login: página pública de relato de problema
      const { mostrar } = await import('./views/relatar.js');
      return mostrar($('#app'), relato[1], () => iniciar());
    }
    const { mostrar } = await import('./views/login.js');
    mostrar($('#app'), async () => iniciar());
  }
}

window.addEventListener('hashchange', navegar);
window.addEventListener('sessao-expirada', () => { if (estado.usuario) { estado.usuario = null; toast('Sessão expirada.', 'erro'); iniciar(); } });
window.addEventListener('unhandledrejection', (e) => { if (e.reason?.message) toast(e.reason.message, 'erro'); });
setInterval(pollNotificacoes, 30000);
setInterval(prepararOffline, 5 * 60e3);
document.addEventListener('visibilitychange', pollNotificacoes);
window.addEventListener('offline', () => toast(offline.modoTecnico() ? 'Sem conexão: suas ações ficam guardadas no aparelho e serão enviadas quando a internet voltar.' : 'Sem conexão com a internet. As alterações não serão salvas até a conexão voltar.', 'erro'));
window.addEventListener('online', () => toast('Conexão restabelecida.'));
iniciarPWA();
iniciar();

export { esc };
