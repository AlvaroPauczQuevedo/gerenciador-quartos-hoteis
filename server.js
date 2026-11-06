import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, transacao, um, lerConfig } from './src/db.js';
import { criarRotas } from './src/rotas.js';
import { lerCorpo, cookies, json, servirArquivo } from './src/http.js';
import { ErroHttp } from './src/domain/comum.js';
import * as usuarios from './src/domain/usuarios.js';
import * as fotos from './src/domain/fotos.js';
import { verificar } from './src/domain/agendador.js';
import { popularPiloto, gravarCredenciais, HOTEL_PILOTO } from './src/seed.js';
import { importarRede, gravarCredenciaisRede } from './src/rede.js';

const raiz = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || join(raiz, 'data');
const ctx = { uploadsDir: join(dataDir, 'uploads') };
const publico = join(raiz, 'public');
const PORTA = Number(process.env.PORT) || 3000;

const db = abrirBanco(join(dataDir, 'hotelaria.db'));
if (!um(db, 'SELECT id FROM usuarios LIMIT 1')) {
  const caminho = gravarCredenciais(dataDir, popularPiloto(db));
  const rede = gravarCredenciaisRede(dataDir, importarRede(db));
  console.log(`Versão piloto criada (${HOTEL_PILOTO.nome} + rede). Credenciais: ${caminho}${rede ? ` e ${rede}` : ''}`);
}

const rotas = criarRotas();
const COOKIE = 'sid';
const tentativas = new Map(); // falhas de login por IP

async function tratar(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const caminho = url.pathname;
  const sid = cookies(req)[COOKIE];

  if (caminho === '/api/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress;
    const t = tentativas.get(ip);
    if (t && t.n >= 10 && Date.now() - t.desde < 15 * 60e3) throw new ErroHttp(429, 'Muitas tentativas de login. Aguarde 15 minutos.');
    const corpo = await lerCorpo(req);
    let token;
    try {
      token = usuarios.login(db, corpo.usuario, corpo.senha);
    } catch (e) {
      const atual = t && Date.now() - t.desde < 15 * 60e3 ? t : { n: 0, desde: Date.now() };
      tentativas.set(ip, { ...atual, n: atual.n + 1 });
      throw e;
    }
    tentativas.delete(ip);
    return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200` });
  }
  if (caminho === '/api/config' && req.method === 'GET') {
    return json(res, 200, { modo: lerConfig(db, 'modo', 'piloto') });
  }
  if (caminho === '/api/logout' && req.method === 'POST') {
    if (sid) usuarios.logout(db, sid);
    return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
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
  if (req.method !== 'GET') throw new ErroHttp(405, 'Método não permitido.');
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

// Agendador: prazos próximos, atrasos e inspeções vencidas.
const rodarAgendador = () => { try { transacao(db, () => verificar(db)); } catch (e) { console.error('Agendador:', e); } };
rodarAgendador();
setInterval(rodarAgendador, 5 * 60 * 1000).unref();

servidor.listen(PORTA, () => {
  console.log(`Gestão de Manutenção — Tri Hotéis rodando em http://localhost:${PORTA}`);
  if (existsSync(join(dataDir, 'hotelaria.db'))) console.log(`Banco de dados: ${join(dataDir, 'hotelaria.db')}`);
});
