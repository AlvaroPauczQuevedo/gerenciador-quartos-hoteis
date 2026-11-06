import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Esquema único: todos os módulos compartilham identificadores (hotel_id, quarto_id,
// os_id, inspecao_id...) para que nenhuma informação precise ser cadastrada duas vezes.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS hoteis (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  cidade TEXT,
  logo TEXT,                              -- pasta em public/img/hoteis/
  exige_validacao INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL,
  hotel_id INTEGER REFERENCES hoteis(id),
  ativo INTEGER NOT NULL DEFAULT 1,
  excluido_em TEXT
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  expira_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quartos (
  id INTEGER PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hoteis(id),
  numero TEXT NOT NULL,
  andar TEXT,
  tipo TEXT,
  estrelas INTEGER,                       -- classificação de conservação (1 a 5)
  status_comercial TEXT NOT NULL DEFAULT 'liberado', -- liberado | bloqueado
  periodicidade_inspecao_dias INTEGER NOT NULL DEFAULT 30,
  ultima_inspecao_em TEXT,
  proxima_inspecao_em TEXT,
  alerta_inspecao_enviado_em TEXT,
  ultima_manutencao_em TEXT,
  numeracao_provisoria INTEGER NOT NULL DEFAULT 0, -- criado só pela quantidade, aguardando numeração real
  UNIQUE (hotel_id, numero)
);

CREATE TABLE IF NOT EXISTS equipamentos (
  id INTEGER PRIMARY KEY,
  quarto_id INTEGER NOT NULL REFERENCES quartos(id),
  tipo TEXT NOT NULL,
  descricao TEXT,
  instalado_em TEXT,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS protocolos (
  ano INTEGER PRIMARY KEY,
  ultimo INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ordens_servico (
  id INTEGER PRIMARY KEY,
  protocolo TEXT NOT NULL UNIQUE,
  hotel_id INTEGER NOT NULL REFERENCES hoteis(id),
  quarto_id INTEGER REFERENCES quartos(id),
  equipamento_id INTEGER REFERENCES equipamentos(id),
  local TEXT NOT NULL,
  categoria TEXT NOT NULL,
  titulo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  prioridade TEXT NOT NULL,
  prioridade_original TEXT NOT NULL,
  identificado_em TEXT,
  justificativa TEXT,
  impacto TEXT,
  bloqueio_quarto INTEGER NOT NULL DEFAULT 0,
  prazo_desejado TEXT,
  prazo_previsto TEXT,
  observacoes TEXT,
  status TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'manual',  -- manual | inspecao
  inspecao_item_id INTEGER,
  os_origem_id INTEGER REFERENCES ordens_servico(id),
  recorrente INTEGER NOT NULL DEFAULT 0,
  exige_validacao INTEGER NOT NULL DEFAULT 1,
  aberto_por INTEGER NOT NULL REFERENCES usuarios(id),
  recebido_por INTEGER REFERENCES usuarios(id),
  responsavel_id INTEGER REFERENCES usuarios(id),
  executado_por INTEGER REFERENCES usuarios(id),
  validado_por INTEGER REFERENCES usuarios(id),
  relatorio_conclusao TEXT,
  reaberturas INTEGER NOT NULL DEFAULT 0,
  correcoes INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  recebido_em TEXT,
  iniciado_em TEXT,
  concluido_em TEXT,
  validado_em TEXT,
  encerrado_em TEXT,
  alerta_prazo_em TEXT,
  alerta_atraso_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_os_hotel ON ordens_servico(hotel_id, status);
CREATE INDEX IF NOT EXISTS ix_os_quarto ON ordens_servico(quarto_id);

CREATE TABLE IF NOT EXISTS os_eventos (
  id INTEGER PRIMARY KEY,
  os_id INTEGER NOT NULL REFERENCES ordens_servico(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  tipo TEXT NOT NULL,
  status_de TEXT,
  status_para TEXT,
  texto TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_eventos_os ON os_eventos(os_id);

CREATE TABLE IF NOT EXISTS os_tarefas (
  id INTEGER PRIMARY KEY,
  os_id INTEGER NOT NULL REFERENCES ordens_servico(id),
  descricao TEXT NOT NULL,
  tecnico_id INTEGER REFERENCES usuarios(id),
  concluida INTEGER NOT NULL DEFAULT 0,
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  concluida_em TEXT
);

CREATE TABLE IF NOT EXISTS os_materiais (
  id INTEGER PRIMARY KEY,
  os_id INTEGER NOT NULL REFERENCES ordens_servico(id),
  descricao TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 1,
  unidade TEXT,
  status TEXT NOT NULL DEFAULT 'solicitado', -- solicitado | disponivel | aplicado
  solicitado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS os_custos (
  id INTEGER PRIMARY KEY,
  os_id INTEGER NOT NULL REFERENCES ordens_servico(id),
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor REAL NOT NULL,
  registrado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aprovacoes (
  id INTEGER PRIMARY KEY,
  os_id INTEGER NOT NULL REFERENCES ordens_servico(id),
  valor REAL NOT NULL,
  descricao TEXT NOT NULL,
  fornecedor TEXT,
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente | aprovado | recusado
  posterior INTEGER NOT NULL DEFAULT 0,      -- regularização posterior (emergencial)
  solicitado_por INTEGER REFERENCES usuarios(id),
  decidido_por INTEGER REFERENCES usuarios(id),
  justificativa_decisao TEXT,
  criado_em TEXT NOT NULL,
  decidido_em TEXT
);

CREATE TABLE IF NOT EXISTS fotos (
  id INTEGER PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hoteis(id),
  quarto_id INTEGER REFERENCES quartos(id),
  os_id INTEGER REFERENCES ordens_servico(id),
  inspecao_id INTEGER REFERENCES inspecoes(id),
  inspecao_item_id INTEGER REFERENCES inspecao_itens(id),
  fase TEXT NOT NULL,
  arquivo TEXT NOT NULL,
  mime TEXT NOT NULL,
  legenda TEXT,
  enviado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fotos_quarto ON fotos(quarto_id, criado_em);

CREATE TABLE IF NOT EXISTS notificacoes (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  os_id INTEGER REFERENCES ordens_servico(id),
  quarto_id INTEGER REFERENCES quartos(id),
  lida INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notif_usuario ON notificacoes(usuario_id, lida);

CREATE TABLE IF NOT EXISTS inspecoes (
  id INTEGER PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hoteis(id),
  quarto_id INTEGER NOT NULL REFERENCES quartos(id),
  inspetor_id INTEGER NOT NULL REFERENCES usuarios(id),
  status TEXT NOT NULL DEFAULT 'em_andamento', -- em_andamento | concluida
  pontuacao REAL,
  estrelas INTEGER,
  observacoes TEXT,
  iniciada_em TEXT NOT NULL,
  concluida_em TEXT
);

CREATE TABLE IF NOT EXISTS inspecao_itens (
  id INTEGER PRIMARY KEY,
  inspecao_id INTEGER NOT NULL REFERENCES inspecoes(id),
  ordem INTEGER NOT NULL,
  ambiente TEXT NOT NULL,
  item TEXT NOT NULL,
  categoria TEXT NOT NULL,
  local TEXT NOT NULL,
  equipamento_id INTEGER REFERENCES equipamentos(id),
  resposta TEXT,
  observacao TEXT,
  os_id INTEGER REFERENCES ordens_servico(id),
  cronico_id INTEGER REFERENCES problemas_cronicos(id)
);

-- Checklist de inspeção por hotel. Sem itens cadastrados, vale o checklist padrão.
-- "critico" = item básico para funcionamento e venda do quarto.
CREATE TABLE IF NOT EXISTS checklist_modelo (
  id INTEGER PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hoteis(id),
  ordem INTEGER NOT NULL,
  ambiente TEXT NOT NULL,
  item TEXT NOT NULL,
  categoria TEXT NOT NULL,
  local TEXT NOT NULL,
  equipamento TEXT,
  critico INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS problemas_cronicos (
  id INTEGER PRIMARY KEY,
  hotel_id INTEGER NOT NULL REFERENCES hoteis(id),
  quarto_id INTEGER REFERENCES quartos(id),
  equipamento_id INTEGER REFERENCES equipamentos(id),
  categoria TEXT NOT NULL,
  descricao TEXT NOT NULL,
  origem TEXT NOT NULL,                -- inspecao | recorrencia | manual
  inspecao_item_id INTEGER,
  status TEXT NOT NULL DEFAULT 'ativo', -- ativo | resolvido
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL,
  resolvido_em TEXT
);

CREATE TABLE IF NOT EXISTS bloqueios (
  id INTEGER PRIMARY KEY,
  quarto_id INTEGER NOT NULL REFERENCES quartos(id),
  os_id INTEGER REFERENCES ordens_servico(id),
  motivo TEXT NOT NULL,
  bloqueado_por INTEGER REFERENCES usuarios(id),
  bloqueado_em TEXT NOT NULL,
  liberado_por INTEGER REFERENCES usuarios(id),
  liberado_em TEXT,
  observacao_liberacao TEXT
);

CREATE TABLE IF NOT EXISTS quarto_historico (
  id INTEGER PRIMARY KEY,
  quarto_id INTEGER NOT NULL REFERENCES quartos(id),
  tipo TEXT NOT NULL,       -- manutencao | inspecao | bloqueio | liberacao | cronico
  descricao TEXT NOT NULL,
  os_id INTEGER REFERENCES ordens_servico(id),
  inspecao_id INTEGER REFERENCES inspecoes(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_hist_quarto ON quarto_historico(quarto_id, criado_em);
`;

export function abrirBanco(caminho = ':memory:') {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec('PRAGMA foreign_keys = ON;');
  if (caminho !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrar(db);
  return db;
}

// Colunas acrescentadas depois da primeira versão (bancos já existentes).
function migrar(db) {
  const colunas = db.prepare('PRAGMA table_info(inspecao_itens)').all().map((c) => c.name);
  if (!colunas.includes('critico')) db.exec('ALTER TABLE inspecao_itens ADD COLUMN critico INTEGER NOT NULL DEFAULT 0');
  const colUsuarios = db.prepare('PRAGMA table_info(usuarios)').all().map((c) => c.name);
  if (colUsuarios.includes('email')) removerEmail(db, colUsuarios);
  const colHoteis = db.prepare('PRAGMA table_info(hoteis)').all().map((c) => c.name);
  if (!colHoteis.includes('logo')) db.exec('ALTER TABLE hoteis ADD COLUMN logo TEXT');
  const colQuartos = db.prepare('PRAGMA table_info(quartos)').all().map((c) => c.name);
  if (!colQuartos.includes('numeracao_provisoria')) db.exec('ALTER TABLE quartos ADD COLUMN numeracao_provisoria INTEGER NOT NULL DEFAULT 0');
}

// Versões anteriores usavam e-mail (e depois e-mail + login). O login passa a ser a parte do
// e-mail antes do @ quando ainda não existir, e a tabela é recriada sem a coluna de e-mail
// (o SQLite não remove colunas UNIQUE com ALTER TABLE). IDs, senhas e histórico são preservados.
function removerEmail(db, colunas) {
  const linhas = db.prepare(`SELECT id, email, ${colunas.includes('login') ? 'login' : 'NULL AS login'} FROM usuarios ORDER BY id`).all();
  const usados = new Set(linhas.map((u) => u.login).filter(Boolean));
  const logins = new Map();
  for (const u of linhas) {
    if (u.login) { logins.set(u.id, u.login); continue; }
    const base = String(u.email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || `usuario${u.id}`;
    let login = base;
    for (let i = 2; usados.has(login); i++) login = `${base}${i}`;
    usados.add(login);
    logins.set(u.id, login);
  }
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`CREATE TABLE usuarios_novo (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL,
      papel TEXT NOT NULL, hotel_id INTEGER REFERENCES hoteis(id), ativo INTEGER NOT NULL DEFAULT 1, excluido_em TEXT)`);
    const ins = db.prepare('INSERT INTO usuarios_novo (id, nome, login, senha_hash, papel, hotel_id, ativo, excluido_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const temExcluido = colunas.includes('excluido_em');
    for (const u of db.prepare(`SELECT id, nome, senha_hash, papel, hotel_id, ativo, ${temExcluido ? 'excluido_em' : 'NULL AS excluido_em'} FROM usuarios`).all()) {
      ins.run(u.id, u.nome, logins.get(u.id), u.senha_hash, u.papel, u.hotel_id, u.ativo, u.excluido_em);
    }
    db.exec('DROP TABLE usuarios');
    db.exec('ALTER TABLE usuarios_novo RENAME TO usuarios');
    const problemas = db.prepare('PRAGMA foreign_key_check').all();
    if (problemas.length) throw new Error(`Migração de usuários inconsistente: ${JSON.stringify(problemas.slice(0, 3))}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// Executa `fn` dentro de uma transação (rollback em caso de erro).
export function transacao(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// node:sqlite devolve objetos com protótipo nulo; normalizamos para JSON.
export const um = (db, sql, ...p) => {
  const r = db.prepare(sql).get(...p);
  return r ? { ...r } : null;
};
export const todos = (db, sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
export const exec = (db, sql, ...p) => db.prepare(sql).run(...p);

export const lerConfig = (db, chave, padrao = null) => um(db, 'SELECT valor FROM configuracoes WHERE chave = ?', chave)?.valor ?? padrao;
export const gravarConfig = (db, chave, valor) =>
  exec(db, 'INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', chave, valor);
