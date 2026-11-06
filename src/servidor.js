import { createServer } from 'node:http';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, transacao, um, lerConfig } from './db.js';
import { criarRotas } from './rotas.js';
import { lerCorpo, cookies, json, servirArquivo } from './http.js';
import { ErroHttp } from './domain/comum.js';
import * as usuarios from './domain/usuarios.js';
import * as fotos from './domain/fotos.js';
import { verificar } from './domain/agendador.js';
import { popularPiloto, gravarCredenciais, HOTEL_PILOTO } from './seed.js';
import { importarRede, gravarCredenciaisRede } from './rede.js';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.DATA_DIR || join(raiz, 'data'));
const ctx = { uploadsDir: join(dataDir, 'uploads') };
const publico = join(raiz, 'public');
const PORTA = Number(process.env.PORT) || 3000;
const PRODUCAO = process.env.NODE_ENV === 'production';
// Atrás de proxy (Hostinger, nginx), o IP real do usuário vem em X-Forwarded-For.
const CONFIAR_PROXY = process.env.TRUST_PROXY === '1' || PRODUCAO;

// Em hospedagens que recriam a pasta do app a cada deploy, o banco precisa ficar fora dela.
const dentroDoApp = !relative(raiz, dataDir).startsWith('..') && !isAbsolute(relative(raiz, dataDir));
if (PRODUCAO && dentroDoApp) {
  console.warn(`ATENÇÃO: DATA_DIR (${dataDir}) está dentro da pasta do aplicativo. Em hospedagens que recriam o app a cada deploy, `
    + 'o banco e as fotos SERÃO APAGADOS. Defina DATA_DIR com um caminho fora do app (ex.: /home/SEU_USUARIO/manutencao-dados).');
}

const db = abrirBanco(join(dataDir, 'hotelaria.db'));
if (!um(db, 'SELECT id FROM usuarios LIMIT 1')) {
  const caminho = gravarCredenciais(dataDir, popularPiloto(db));
  const rede = gravarCredenciaisRede(dataDir, importarRede(db));
  console.log(`Versão piloto criada (${HOTEL_PILOTO.nome} + rede). Credenciais: ${caminho}${rede ? ` e ${rede}` : ''}`);
}

const rotas = criarRotas();
const COOKIE = 'sid';
const JANELA_LOGIN = 15 * 60e3;
const tentativas = new Map(); // falhas de login por IP

const SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function ipCliente(req) {
  const encaminhado = req.headers['x-forwarded-for'];
  if (CONFIAR_PROXY && encaminhado) return String(encaminhado).split(',')[0].trim();
  return req.socket.remoteAddress;
}

function cookieSessao(req, valor, maxAge) {
  const https = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted || process.env.COOKIE_SECURE === '1';
  return `${COOKIE}=${valor}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}

// Verificações de prazo/inspeção: a cada 5 min pelo relógio e também sob demanda nas requisições,
// pois hospedagens gerenciadas podem pausar o processo quando não há acesso.
let ultimaVerificacao = 0;
function rodarAgendador() {
  ultimaVerificacao = Date.now();
  try { transacao(db, () => verificar(db)); } catch (e) { console.error('Agendador:', e); }
}

async function tratar(req, res) {
  for (const [k, v] of Object.entries(SEGURANCA)) res.setHeader(k, v);
  if (Date.now() - ultimaVerificacao > 5 * 60e3) rodarAgendador();
  const url = new URL(req.url, 'http://localhost');
  const caminho = url.pathname;
  const sid = cookies(req)[COOKIE];

  if (caminho === '/healthz') return json(res, 200, { ok: true });

  if (caminho === '/api/login' && req.method === 'POST') {
    const ip = ipCliente(req);
    const t = tentativas.get(ip);
    if (t && t.n >= 10 && Date.now() - t.desde < JANELA_LOGIN) throw new ErroHttp(429, 'Muitas tentativas de login. Aguarde 15 minutos.');
    const corpo = await lerCorpo(req);
    let token;
    try {
      token = usuarios.login(db, corpo.usuario, corpo.senha);
    } catch (e) {
      const atual = t && Date.now() - t.desde < JANELA_LOGIN ? t : { n: 0, desde: Date.now() };
      tentativas.set(ip, { ...atual, n: atual.n + 1 });
      if (tentativas.size > 10000) for (const [k, v] of tentativas) if (Date.now() - v.desde > JANELA_LOGIN) tentativas.delete(k);
      throw e;
    }
    tentativas.delete(ip);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, token, 43200) });
  }
  if (caminho === '/api/config' && req.method === 'GET') {
    return json(res, 200, { modo: lerConfig(db, 'modo', 'piloto') });
  }
  if (caminho === '/api/logout' && req.method === 'POST') {
    if (sid) usuarios.logout(db, sid);
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao(req, '', 0) });
  }

  if (caminho.startsWith('/api/') || caminho.startsWith('/uploads/')) {
    const usuario = usuarios.porToken(db, sid);
    if (!usuario) throw new ErroHttp(401, 'Sessão expirada. Faça login novamente.');

    if (caminho.startsWith('/uploads/')) {
      const nome = caminho.slice('/uploads/'.length);
      fotos.buscarArquivo(db, usuario, nome);
      if (!(await servirArquivo(res, ctx.uploadsDir, nome, { cache: 'private, max-age=86400' }))) throw new ErroHttp(404, 'Arquivo não encontrado.');
      return;
    }

    const rota = rotas.encontrar(req.method, caminho);
    if (!rota) throw new ErroHttp(404, 'Rota não encontrada.');
    const body = ['POST', 'PUT'].includes(req.method) ? await lerCorpo(req) : {};
    const args = { db, usuario, params: rota.params, query: Object.fromEntries(url.searchParams), body, ctx };
    const resultado = rota.handler.mutacao ? transacao(db, () => rota.handler(args)) : rota.handler(args);
    return json(res, 200, resultado ?? { ok: true });
  }

  // Frontend (SPA): arquivos estáticos, com fallback para index.html.
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErroHttp(405, 'Método não permitido.');
  if (await servirArquivo(res, publico, caminho === '/' ? 'index.html' : caminho.slice(1))) return;
  if (!(await servirArquivo(res, publico, 'index.html'))) throw new ErroHttp(404, 'Não encontrado.');
}

const servidor = createServer((req, res) => {
  tratar(req, res).catch((e) => {
    const status = e instanceof ErroHttp ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { erro: status === 500 ? 'Erro interno do servidor.' : e.message });
    else res.end();
  });
});

rodarAgendador();
setInterval(rodarAgendador, 5 * 60 * 1000).unref();

servidor.listen(PORTA, () => {
  console.log(`Gestão de Manutenção — Tri Hotéis rodando na porta ${PORTA}${PRODUCAO ? ' (produção)' : ''}`);
  console.log(`Dados (banco e fotos): ${dataDir}`);
});

// Encerramento limpo (deploy/reinício): fecha o banco para não deixar o WAL pendente.
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    servidor.close();
    try { db.close(); } catch { /* já fechado */ }
    process.exit(0);
  });
}
