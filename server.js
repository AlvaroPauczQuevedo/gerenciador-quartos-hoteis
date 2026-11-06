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
await import('./src/servidor.js');
