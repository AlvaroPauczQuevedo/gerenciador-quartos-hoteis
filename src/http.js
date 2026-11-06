// Micro-roteador HTTP sem dependências externas.
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { ErroHttp } from './domain/comum.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export class Roteador {
  constructor() { this.rotas = []; }

  add(metodo, padrao, handler) {
    const nomes = [];
    const re = new RegExp(`^${padrao.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; })}$`);
    this.rotas.push({ metodo, re, nomes, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  encontrar(metodo, caminho) {
    for (const r of this.rotas) {
      if (r.metodo !== metodo) continue;
      const m = r.re.exec(caminho);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

export function lerCorpo(req, limite = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > limite) { reject(new ErroHttp(413, 'Requisição muito grande (máx. 25 MB).')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      if (!partes.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { reject(new ErroHttp(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

export function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

export function json(res, status, dados, headers = {}) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(corpo);
}

// Serve um arquivo de `raiz` sem permitir path traversal.
export async function servirArquivo(res, raiz, relativo, { cache = 'no-cache' } = {}) {
  const alvo = normalize(join(raiz, relativo));
  if (!alvo.startsWith(normalize(raiz + sep)) && alvo !== normalize(raiz)) return false;
  try {
    const s = await stat(alvo);
    if (!s.isFile()) return false;
    const conteudo = await readFile(alvo);
    res.writeHead(200, { 'Content-Type': MIME[extname(alvo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    res.end(conteudo);
    return true;
  } catch {
    return false;
  }
}
