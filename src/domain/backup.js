// Backup automático do banco: uma cópia consistente por dia (horário de Brasília), mantendo as últimas 30.
// Fica em DATA_DIR/backups — fora da pasta do app, então sobrevive aos deploys.
// As fotos (DATA_DIR/uploads) são apenas acrescentadas, nunca alteradas: o backup diário cobre o banco,
// e as fotos entram no backup geral da hospedagem (ou via "Baixar fotos" quando necessário).
import { backup as backupSqlite } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, rmSync, existsSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { exigir, exigirPapel } from './comum.js';

export const RETENCAO = 30;
const PADRAO = /^hotelaria-(\d{4}-\d{2}-\d{2})(-manual-\d+)?\.db$/;

const hojeBrasilia = (agora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);

export const pastaBackups = (dataDir) => join(dataDir, 'backups');

export function listar(dataDir) {
  const pasta = pastaBackups(dataDir);
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).filter((f) => PADRAO.test(f)).map((nome) => {
    const st = statSync(join(pasta, nome));
    return { nome, tamanho: st.size, criado_em: st.mtime.toISOString(), manual: nome.includes('-manual-') };
  }).sort((a, b) => b.nome.localeCompare(a.nome));
}

function limpar(dataDir) {
  // Mantém os RETENCAO backups diários mais recentes e os 5 manuais mais recentes.
  const todos = listar(dataDir);
  const diarios = todos.filter((b) => !b.manual);
  const manuais = todos.filter((b) => b.manual);
  for (const b of [...diarios.slice(RETENCAO), ...manuais.slice(5)]) rmSync(join(pastaBackups(dataDir), b.nome), { force: true });
}

export async function gerar(db, dataDir, { manual = false, agora } = {}) {
  const pasta = pastaBackups(dataDir);
  mkdirSync(pasta, { recursive: true });
  const dia = hojeBrasilia(agora ? new Date(agora) : new Date());
  const nome = manual ? `hotelaria-${dia}-manual-${Date.now()}.db` : `hotelaria-${dia}.db`;
  const destino = join(pasta, nome);
  const temporario = `${destino}.parcial`;
  rmSync(temporario, { force: true });
  await backupSqlite(db, temporario); // cópia consistente com o sistema em uso
  rmSync(destino, { force: true });
  renameSync(temporario, destino);
  limpar(dataDir);
  return nome;
}

// Chamado pelo agendador: gera o backup do dia se ainda não existir.
let emAndamento = false;
export async function backupDiario(db, dataDir, agora) {
  if (emAndamento) return null;
  const nome = `hotelaria-${hojeBrasilia(agora ? new Date(agora) : new Date())}.db`;
  if (existsSync(join(pastaBackups(dataDir), nome))) return null;
  emAndamento = true;
  try { return await gerar(db, dataDir, { agora }); } finally { emAndamento = false; }
}

export function caminhoParaDownload(usuario, dataDir, nome) {
  exigirPapel(usuario, 'admin');
  exigir(PADRAO.test(nome) && basename(nome) === nome, 'Backup inválido.', 400);
  const caminho = join(pastaBackups(dataDir), nome);
  exigir(existsSync(caminho), 'Backup não encontrado.', 404);
  return caminho;
}
