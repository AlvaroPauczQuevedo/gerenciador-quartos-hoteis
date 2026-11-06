// CLI de implantação:
//   node src/empacotar.js app    → deploy/manutencao-app.zip  (código para enviar à hospedagem)
//   node src/empacotar.js dados  → deploy/manutencao-dados.zip (banco consistente + fotos, para migrar o piloto)
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'deploy');
const modo = process.argv[2];

// Gerador de .zip em Node puro (deflate + CRC32 do zlib), sem depender de ferramentas do sistema.
function listarArquivos(base, itens) {
  const saida = [];
  const visitar = (rel) => {
    const abs = join(base, rel);
    if (statSync(abs).isDirectory()) for (const f of readdirSync(abs)) visitar(`${rel}/${f}`);
    else saida.push(rel);
  };
  for (const i of itens) visitar(i);
  return saida;
}

function zipar(pastaOrigem, itens, arquivoZip) {
  const partes = [];
  const central = [];
  let offset = 0;
  const agora = new Date();
  const dosTime = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const dosDate = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  for (const rel of listarArquivos(pastaOrigem, itens)) {
    const dados = readFileSync(join(pastaOrigem, rel));
    const comprimido = deflateRawSync(dados, { level: 9 });
    const nome = Buffer.from(rel, 'utf8'); // caminhos já montados com "/"
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(nome.length, 26);
    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0); cab.writeUInt16LE(20, 4); cab.writeUInt16LE(20, 6); cab.writeUInt16LE(0x0800, 8); cab.writeUInt16LE(8, 10);
    cab.writeUInt16LE(dosTime, 12); cab.writeUInt16LE(dosDate, 14); cab.writeUInt32LE(crc, 16);
    cab.writeUInt32LE(comprimido.length, 20); cab.writeUInt32LE(dados.length, 24); cab.writeUInt16LE(nome.length, 28); cab.writeUInt32LE(offset, 42);
    partes.push(local, nome, comprimido);
    central.push(cab, nome);
    offset += local.length + nome.length + comprimido.length;
  }
  const tamCentral = central.reduce((n, b) => n + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(central.length / 2, 8); fim.writeUInt16LE(central.length / 2, 10);
  fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(offset, 16);
  writeFileSync(arquivoZip, Buffer.concat([...partes, ...central, fim]));
  return central.length / 2;
}

const tamanho = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);

if (modo === 'app') {
  mkdirSync(destino, { recursive: true });
  const itens = ['server.js', 'package.json', 'src', 'public', 'README.md', '.env.example'].filter((i) => existsSync(join(raiz, i)));
  const zip = join(destino, 'manutencao-app.zip');
  zipar(raiz, itens, zip);
  console.log(`Pacote do aplicativo: ${zip} (${tamanho(zip)} MB)\nConteúdo: ${itens.join(', ')} — sem dados, testes ou node_modules.`);
} else if (modo === 'dados') {
  const dataDir = process.env.DATA_DIR || join(raiz, 'data');
  const banco = join(dataDir, 'hotelaria.db');
  if (!existsSync(banco)) { console.error(`Banco não encontrado: ${banco}`); process.exit(1); }
  const temp = join(destino, 'manutencao-dados');
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  // Cópia consistente mesmo com o servidor rodando (API de backup do SQLite; inclui o conteúdo do WAL).
  const origem = new DatabaseSync(banco, { readOnly: true });
  await backup(origem, join(temp, 'hotelaria.db'));
  origem.close();
  const uploads = join(dataDir, 'uploads');
  mkdirSync(join(temp, 'uploads'), { recursive: true });
  if (existsSync(uploads)) cpSync(uploads, join(temp, 'uploads'), { recursive: true });
  const zip = join(destino, 'manutencao-dados.zip');
  zipar(temp, ['hotelaria.db', 'uploads'], zip);
  rmSync(temp, { recursive: true, force: true });
  const fotos = existsSync(uploads) ? readdirSync(uploads).length : 0;
  console.log(`Dados exportados: ${zip} (${tamanho(zip)} MB) — banco + ${fotos} arquivo(s) de foto/vídeo.`);
  console.log('As credenciais (credenciais-*.txt) NÃO são incluídas. Guarde-as em local seguro.');
} else {
  console.log('Uso: node src/empacotar.js app | dados');
  process.exit(1);
}
