// App instalável (PWA): service worker, atualização, instalação e notificações push.
import { api, post } from './estado.js';
import { html, modal, toast } from './ui.js';

const ua = navigator.userAgent;
export const ehIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const ehBrave = () => !!navigator.brave;
export const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const suportaSW = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

let registro = null;
let promptInstalacao = null;
const ouvintes = new Set();
const avisar = () => ouvintes.forEach((f) => f());
export const aoMudar = (f) => { ouvintes.add(f); return () => ouvintes.delete(f); };

// ---------- service worker e atualização ----------
export async function iniciarPWA() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalacao = e; avisar(); });
  window.addEventListener('appinstalled', () => { promptInstalacao = null; toast('App instalado! Ele está na tela inicial do aparelho.'); avisar(); });
  if (!suportaSW) return;
  try {
    registro = await navigator.serviceWorker.register('/service-worker.js');
    // Remove registros antigos de /sw.js (versão que a CDN da Hostinger entregava sem preencher).
    for (const r of await navigator.serviceWorker.getRegistrations()) if (r.active?.scriptURL.endsWith('/sw.js')) r.unregister();
  } catch (e) {
    console.warn('Service worker não registrado:', e.message);
    return;
  }
  const oferecerAtualizacao = (sw) => {
    if (!sw || !navigator.serviceWorker.controller) return; // primeira instalação: nada a atualizar
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html`Nova versão do sistema disponível. <button class="btn pequeno" style="margin-left:.5rem">Atualizar</button>`.s;
    el.querySelector('button').addEventListener('click', () => { el.remove(); sw.postMessage({ tipo: 'atualizar' }); });
    document.getElementById('toasts').append(el);
  };
  // Ao abrir o app não há nada em andamento: se já existe versão nova baixada, aplica direto.
  if (registro.waiting && navigator.serviceWorker.controller) registro.waiting.postMessage({ tipo: 'atualizar' });
  registro.addEventListener('updatefound', () => {
    const novo = registro.installing;
    novo?.addEventListener('statechange', () => { if (novo.state === 'installed') oferecerAtualizacao(novo); });
  });
  let recarregando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recarregando) { recarregando = true; location.reload(); } });
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.tipo === 'abrir') location.href = e.data.url; });
  // Procura versões novas ao voltar para o app (deploy automático pelo GitHub).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) registro.update().catch(() => {}); });
  avisar();
}

// ---------- instalação ----------
export const podeInstalar = () => !instalado() && (!!promptInstalacao || ehIOS);

export async function instalar() {
  if (promptInstalacao) {
    promptInstalacao.prompt();
    await promptInstalacao.userChoice.catch(() => null);
    promptInstalacao = null;
    avisar();
    return;
  }
  if (ehIOS) modal(instrucoesIOS().s);
}

// Navegador em uso no iPhone/iPad: cada um tem o "Adicionar à Tela de Início" num lugar diferente.
function navegadorIOS() {
  if (/Instagram|FBAN|FBAV|LinkedInApp|Line\//.test(ua)) return 'app';
  if (/CriOS/.test(ua)) return 'chrome';
  if (/EdgiOS/.test(ua)) return 'edge';
  if (/FxiOS/.test(ua)) return 'firefox';
  return 'safari';
}
export const versaoIOS = () => { const m = /OS (\d+)_(\d+)/.exec(ua); return m ? { maior: Number(m[1]), menor: Number(m[2]), texto: `${m[1]}.${m[2]}` } : null; };
const iosSemPush = (v) => v && (v.maior < 16 || (v.maior === 16 && v.menor < 4));

function instrucoesIOS() {
  const nav = navegadorIOS();
  const versao = versaoIOS();
  const passos = {
    safari: html`<li>Toque no botão <strong>Compartilhar</strong> <span aria-hidden="true">(quadrado com seta para cima ⬆️)</span> na barra de baixo.</li>
      <li>Role a lista e toque em <strong>Adicionar à Tela de Início</strong>.</li>
      <li>Toque em <strong>Adicionar</strong> (canto superior direito).</li>`,
    chrome: html`<li>Toque no botão <strong>Compartilhar</strong> <span aria-hidden="true">⬆️</span> ao lado do endereço, no topo.</li>
      <li>Toque em <strong>Adicionar à Tela de Início</strong> e depois em <strong>Adicionar</strong>.</li>`,
    edge: html`<li>Toque no menu <strong>⋯</strong> e depois em <strong>Compartilhar</strong>.</li>
      <li>Toque em <strong>Adicionar à Tela de Início</strong> e depois em <strong>Adicionar</strong>.</li>`,
    firefox: html`<li>Toque no menu <strong>☰</strong> e depois em <strong>Compartilhar</strong>.</li>
      <li>Toque em <strong>Adicionar à Tela de Início</strong> e depois em <strong>Adicionar</strong>.</li>`,
    app: html`<li>Você abriu o link dentro de outro aplicativo, que não permite instalar.</li>
      <li>Toque no menu <strong>⋯</strong> e escolha <strong>Abrir no navegador</strong> (Safari).</li>
      <li>No Safari, toque em <strong>Compartilhar</strong> <span aria-hidden="true">⬆️</span> → <strong>Adicionar à Tela de Início</strong>.</li>`,
  }[nav];
  return html`<h2>Instalar no iPhone / iPad</h2>
    <ol style="padding-left:1.2rem;line-height:1.8;margin:.5rem 0">${passos}
      <li>Abra o app pelo ícone <strong>tri</strong> na tela inicial e ative os avisos em <strong>Notificações</strong>.</li></ol>
    <div class="aviso info" style="margin-top:.75rem"><span class="icone">i</span><div class="small">
      <strong>Não aparece "Adicionar à Tela de Início"?</strong> Feche a aba anônima/privada (se estiver usando), ou abra o link direto no Safari —
      links abertos pelo WhatsApp ou e-mail podem abrir numa janela que não permite instalar (toque no ícone do Safari/bússola para abrir no navegador).
      ${iosSemPush(versao) ? html`<br><br>Este aparelho está com iOS ${versao.texto}: o app pode ser instalado, mas as notificações exigem iOS 16.4 ou mais novo (Ajustes → Geral → Atualização de Software).` : ''}
    </div></div>
    <div class="rodape-modal"><button class="btn primario" data-fechar>Entendi</button></div>`;
}

// ---------- notificações push ----------
const suportaPush = () => suportaSW && 'PushManager' in window && 'Notification' in window;

async function inscricaoAtual() {
  if (!suportaPush()) return null;
  const reg = registro || await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// Estados: indisponivel | instalar-ios | bloqueado | ativo | inativo
export async function estadoPush() {
  if (ehIOS && !instalado()) return 'instalar-ios';
  if (!suportaPush()) return 'indisponivel';
  if (Notification.permission === 'denied') return 'bloqueado';
  return (await inscricaoAtual()) && Notification.permission === 'granted' ? 'ativo' : 'inativo';
}

export async function ativarPush() {
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') throw new Error('Permissão de notificação não concedida. Libere nas configurações do navegador/aparelho.');
  const reg = registro || await navigator.serviceWorker.ready;
  const { publica } = await api('/api/push/chave');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const chave = Uint8Array.from(atob(publica.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
    } catch (e) {
      // Ex.: Brave vem com o serviço de push desligado; alguns navegadores sem os serviços do Google também.
      throw new Error(ehBrave()
        ? 'O Brave está com as notificações push desligadas. Ative em brave://settings/privacy → "Usar serviços do Google para mensagens push", reinicie o navegador e tente de novo — ou use o Chrome.'
        : `O navegador não conseguiu se registrar no serviço de notificações (${e.message}). Tente no Chrome, ou verifique se uma rede/antivírus bloqueia o serviço.`);
    }
  }
  await post('/api/push/inscrever', { subscription: sub.toJSON() });
  avisar();
}

export async function desativarPush() {
  const sub = await inscricaoAtual();
  if (sub) {
    await post('/api/push/cancelar', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  avisar();
}

// Ao sair da conta, o aparelho deixa de receber os avisos deste usuário (celular compartilhado).
export async function aoSair() {
  try {
    const sub = await inscricaoAtual();
    if (sub) {
      await post('/api/push/cancelar', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch { /* segue com o logout */ }
}

// Mantém o vínculo aparelho↔usuário atualizado após cada login (ex.: outro usuário no mesmo celular).
export async function revincular() {
  try {
    const sub = await inscricaoAtual();
    if (sub && Notification.permission === 'granted') await post('/api/push/inscrever', { subscription: sub.toJSON() });
  } catch { /* silencioso */ }
}

export const testarPush = () => post('/api/push/teste');
