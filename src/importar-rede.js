// CLI: node src/importar-rede.js — adiciona ao banco os hotéis da rede que ainda não existem.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';
import { abrirBanco } from './db.js';
import { importarRede, gravarCredenciaisRede } from './rede.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || join(raiz, 'data');
const arquivo = join(dataDir, 'hotelaria.db');
if (!existsSync(arquivo)) {
  console.error(`Banco não encontrado em ${arquivo}. Rode "npm start" ou "npm run seed" primeiro.`);
  process.exit(1);
}
// Cópia de segurança antes de abrir (a abertura já aplica as migrações de esquema).
const backup = join(dataDir, `hotelaria-antes-da-rede-${Date.now()}.db`);
for (const sufixo of ['', '-wal', '-shm']) if (existsSync(arquivo + sufixo)) copyFileSync(arquivo + sufixo, backup + sufixo);
const db = abrirBanco(arquivo);
const criados = importarRede(db);
db.close();
const caminho = gravarCredenciaisRede(dataDir, criados);
console.log(criados.length
  ? `${criados.length} hotel(is) adicionado(s). Logins da gerência em: ${caminho}\nBackup do banco anterior: ${backup}`
  : 'Nenhum hotel novo: todos já estavam cadastrados.');
