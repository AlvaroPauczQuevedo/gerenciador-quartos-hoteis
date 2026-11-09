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
    registro = await navigator.serviceWorker.register('/sw.js');
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
  if (registro.waiting) oferecerAtualizacao(registro.waiting);
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
  if (ehIOS) {
    modal(html`<h2>Instalar no iPhone / iPad</h2>
      <ol style="padding-left:1.2rem;line-height:1.8">
        <li>Abra este endereço no <strong>Safari</strong>.</li>
        <li>Toque em <strong>Compartilhar</strong> (quadrado com seta para cima).</li>
        <li>Escolha <strong>Adicionar à Tela de Início</strong> e confirme.</li>
        <li>Abra o app pelo ícone <strong>tri</strong> e ative as notificações em <strong>Notificações</strong>.</li>
      </ol>
      <p class="small muted">No iPhone, as notificações só funcionam com o app instalado (iOS 16.4 ou mais novo).</p>
      <div class="rodape-modal"><button class="btn primario" data-fechar>Entendi</button></div>`.s);
  }
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
