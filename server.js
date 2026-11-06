import { existsSync, readFileSync } from 'node:fs';

// Ponto de entrada (Entry file na Hostinger). Verifica o Node antes de carregar o sistema,
// pois o banco usa o SQLite embutido do Node (node:sqlite), disponível sem flag a partir do 22.13.
const [maior, menor] = process.versions.node.split('.').map(Number);
if (maior < 22 || (maior === 22 && menor < 13)) {
  console.error(`Node.js ${process.versions.node} não é suportado. Selecione Node.js 22 (22.13 ou mais novo) ou 24 nas configurações do app.`);
  process.exit(1);
}

// Oculta apenas o aviso "SQLite is an experimental feature" (os demais avisos continuam).
const emitirAviso = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const tipo = typeof resto[0] === 'string' ? resto[0] : resto[0]?.type;
  if (tipo === 'ExperimentalWarning' && String(aviso).includes('SQLite')) return;
  return emitirAviso.call(process, aviso, ...resto);
};

// Carrega ".env" da pasta do projeto, se existir. Variáveis já definidas no ambiente
// (ex.: configuradas no hPanel da Hostinger) têm prioridade e não são sobrescritas.
const arquivoEnv = new URL('./.env', import.meta.url);
if (existsSync(arquivoEnv)) {
  for (const linha of readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m || linha.trimStart().startsWith('#')) continue;
    const valor = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
}

// Use import assíncrono para que a Hostinger possa carregar este ESM com require().
import('./src/servidor.js').catch((erro) => {
  console.error('Falha ao iniciar o servidor:', erro);
  process.exitCode = 1;
});
