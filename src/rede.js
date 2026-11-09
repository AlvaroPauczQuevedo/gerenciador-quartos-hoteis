// Hotéis da rede Tri Hotéis. Quantidade de quartos conforme planilha enviada pela administração.
// `quartos: null` = sem número na planilha (a gerência cadastra a numeração depois).
// A numeração real ainda não foi informada: os quartos são criados como 1..N e marcados como
// "numeração provisória" até a gerência cadastrar os números reais em Cadastros.
import { mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { transacao, um, todos, exec, lerConfig, gravarConfig } from './db.js';
import { hashSenha, gerarSenha } from './domain/usuarios.js';
import * as quartos from './domain/quartos.js';
import * as inspecoes from './domain/inspecoes.js';

export const HOTEIS_REDE = [
  { nome: 'Tri Hotel Premium Itapema', cidade: 'Itapema/SC', quartos: 155, logo: 'premium-itapema' },
  { nome: 'Tri Hotel Executive Brusque', cidade: 'Brusque/SC', quartos: 90, logo: 'executive-brusque' },
  { nome: 'Tri Hotel Premium Criciúma', cidade: 'Criciúma/SC', quartos: 124, logo: 'premium-criciuma' },
  { nome: 'Tri Hotel Executive Criciúma', cidade: 'Criciúma/SC', quartos: 78, logo: 'executive-criciuma' },
  { nome: 'Tri Hotel Chapecó', cidade: 'Chapecó/SC', quartos: 172, logo: 'chapeco' },
  { nome: 'Tri Hotel Smart Chapecó', cidade: 'Chapecó/SC', quartos: 69, logo: 'smart-chapeco' },
  { nome: 'Tri Hotel Centro Chapecó', cidade: 'Chapecó/SC', quartos: 48, logo: 'centro-chapeco' },
  { nome: 'Tri Hotel Xanxerê', cidade: 'Xanxerê/SC', quartos: 72, logo: 'xanxere' },
  { nome: 'Tri Hotel São João Batista', cidade: 'São João Batista/SC', quartos: 65, logo: 'sao-joao-batista' },
  { nome: 'Tri Hotel Florianópolis', cidade: 'Florianópolis/SC', quartos: 68, logo: 'florianopolis' },
  { nome: 'Tri Hotel Canela', cidade: 'Canela/RS', quartos: 174, logo: 'canela' },
  { nome: 'Tri Hotel Antônio Prado', cidade: 'Antônio Prado/RS', quartos: 125, logo: 'antonio-prado' },
  { nome: 'Tri Hotel Executive Lajeado', cidade: 'Lajeado/RS', quartos: 84, logo: 'executive-lajeado' },
  { nome: 'Tri Hotel Lajeado', cidade: 'Lajeado/RS', quartos: 118, logo: 'lajeado' },
  { nome: 'Tri Hotel Executive Caxias', cidade: 'Caxias do Sul/RS', quartos: 142, logo: 'executive-caxias' },
  { nome: 'Tri Hotel & Flat Caxias', cidade: 'Caxias do Sul/RS', quartos: 56, logo: 'flat-caxias' },
  { nome: 'Tri Hotel Smart Caxias', cidade: 'Caxias do Sul/RS', quartos: 54, logo: 'smart-caxias' },
  { nome: 'Tri Hotel Executive Osório', cidade: 'Osório/RS', quartos: 105, logo: 'executive-osorio', existente: true },
  { nome: 'Tri Hotel Vittoria Bento Gonçalves', cidade: 'Bento Gonçalves/RS', quartos: 109, logo: 'vittoria-bento' },
  { nome: 'Tri Hotel Bento Gonçalves', cidade: 'Bento Gonçalves/RS', quartos: 117, logo: 'bento-goncalves' },
  { nome: 'Tri Hotel Executive Santa Maria', cidade: 'Santa Maria/RS', quartos: 90, logo: 'executive-santa-maria' },
  { nome: 'Tri Hotel Smart Santa Maria', cidade: 'Santa Maria/RS', quartos: 98, logo: 'smart-santa-maria' },
  { nome: 'Tri Hotel Praia Grande', cidade: 'Praia Grande/SP', quartos: 120, logo: 'praia-grande' },
];

// Login padrão da gerência de cada unidade: gerencia.<logo> (ex.: gerencia.premium-itapema).
export const loginGerencia = (h) => `gerencia.${h.logo}`;

const normalizar = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^tri hotel\s*/, '').trim();

// Cria os hotéis que ainda não existem (idempotente: pode rodar de novo sem duplicar).
// Checklist e equipamentos são copiados do hotel modelo (Executive Osório).
export function importarRede(db, { modelo = 'executive-osorio' } = {}) {
  return transacao(db, () => {
    const existentes = todos(db, 'SELECT * FROM hoteis');
    const achar = (h) => existentes.find((e) => e.logo === h.logo || normalizar(e.nome) === normalizar(h.nome));

    // O hotel do piloto recebe nome e logo padronizados.
    for (const h of HOTEIS_REDE.filter((x) => x.existente)) {
      const e = achar(h);
      if (e) exec(db, 'UPDATE hoteis SET nome = ?, cidade = COALESCE(cidade, ?), logo = ? WHERE id = ?', h.nome, h.cidade, h.logo, e.id);
    }
    const hotelModelo = um(db, 'SELECT * FROM hoteis WHERE logo = ?', modelo);
    const checklist = hotelModelo
      ? todos(db, 'SELECT ambiente, item, categoria, local, equipamento, critico FROM checklist_modelo WHERE hotel_id = ? AND ativo = 1 ORDER BY ordem', hotelModelo.id)
      : [];
    const equipamentos = hotelModelo ? lerConfig(db, `equipamentos:${hotelModelo.id}`) : null;
    const admin = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'admin' AND ativo = 1 ORDER BY id")
      || { id: 0, nome: 'Importação', papel: 'admin', hotel_id: null };

    const criados = [];
    for (const h of HOTEIS_REDE) {
      if (achar(h)) continue;
      const hotelId = Number(exec(db, 'INSERT INTO hoteis (nome, cidade, logo) VALUES (?, ?, ?)', h.nome, h.cidade, h.logo).lastInsertRowid);
      if (equipamentos) gravarConfig(db, `equipamentos:${hotelId}`, equipamentos);
      if (checklist.length) inspecoes.definirChecklist(db, hotelId, checklist);
      if (h.quartos) {
        quartos.criarLote(db, admin, { hotel_id: hotelId, inicio: 1, fim: h.quartos });
        exec(db, 'UPDATE quartos SET numeracao_provisoria = 1 WHERE hotel_id = ?', hotelId);
      }
      const login = loginGerencia(h);
      const senha = gerarSenha();
      exec(db, "INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id) VALUES (?, ?, ?, 'gerente', ?)",
        `Gerência ${h.nome.replace(/^Tri Hotel\s*/, '')}`, login, hashSenha(senha), hotelId);
      criados.push({ ...h, login, senha });
    }
    return criados;
  });
}

export function gravarCredenciaisRede(dataDir, criados) {
  if (!criados.length) return null;
  mkdirSync(dataDir, { recursive: true });
  const caminho = join(dataDir, 'credenciais-rede.txt');
  const cabecalho = existsSync(caminho) ? '' : [
    'Credenciais da gerência — hotéis da rede Tri Hotéis',
    'Entregue cada acesso ao gerente da unidade e peça para trocar a senha no primeiro login (menu "Alterar senha").',
    'Apague este arquivo depois de distribuir os acessos.',
    '',
  ].join('\n');
  const linhas = criados.map((c) => `${c.nome.padEnd(36)} ${c.login.padEnd(31)} ${c.senha}${c.quartos ? '' : '   (sem quartos: cadastrar)'}${c.conferir ? '   (conferir nº de quartos)' : ''}`);
  appendFileSync(caminho, `${cabecalho}\n# Gerado em ${new Date().toLocaleString('pt-BR')}\n${linhas.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  return caminho;
}
