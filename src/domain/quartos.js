import { todos, um, exec, lerConfig } from '../db.js';
import { STATUS_FINAIS, STATUS_ENTREGUES, EQUIPAMENTOS_PADRAO } from './constantes.js';
import {
  agoraIso, somarDias, exigir, exigirHotel, exigirPapel, filtroHotel, buscarQuarto, texto, normalizarData,
} from './comum.js';
import { notificar, gerentesDoHotel, equipeManutencao } from './notificacoes.js';

const FINAIS_SQL = STATUS_FINAIS.map((s) => `'${s}'`).join(',');
const ENTREGUES_SQL = STATUS_ENTREGUES.map((s) => `'${s}'`).join(',');

export function registrarHistorico(db, { quarto_id, tipo, descricao, os_id = null, inspecao_id = null, usuario_id = null, agora }) {
  if (!quarto_id) return;
  exec(
    db,
    'INSERT INTO quarto_historico (quarto_id, tipo, descricao, os_id, inspecao_id, usuario_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
    quarto_id, tipo, descricao, os_id, inspecao_id, usuario_id, agoraIso(agora)
  );
}

function recalcularStatusComercial(db, quartoId) {
  const ativo = um(db, 'SELECT COUNT(*) AS n FROM bloqueios WHERE quarto_id = ? AND liberado_em IS NULL', quartoId).n;
  exec(db, 'UPDATE quartos SET status_comercial = ? WHERE id = ?', ativo ? 'bloqueado' : 'liberado', quartoId);
}

export function bloquear(db, usuario, quartoId, { motivo, os_id = null, agora } = {}) {
  const q = buscarQuarto(db, quartoId);
  exigirHotel(usuario, q.hotel_id);
  motivo = texto(motivo);
  exigir(motivo, 'Informe o motivo do bloqueio.');
  if (os_id) {
    const ja = um(db, 'SELECT id FROM bloqueios WHERE os_id = ? AND liberado_em IS NULL', os_id);
    if (ja) return ja.id;
  }
  const r = exec(
    db,
    'INSERT INTO bloqueios (quarto_id, os_id, motivo, bloqueado_por, bloqueado_em) VALUES (?, ?, ?, ?, ?)',
    quartoId, os_id, motivo, usuario.id, agoraIso(agora)
  );
  recalcularStatusComercial(db, quartoId);
  registrarHistorico(db, { quarto_id: quartoId, tipo: 'bloqueio', descricao: `Quarto bloqueado para comercialização: ${motivo}`, os_id, usuario_id: usuario.id, agora });
  notificar(db, [...gerentesDoHotel(db, q.hotel_id), ...equipeManutencao(db, q.hotel_id)], {
    tipo: 'quarto_bloqueado', mensagem: `Quarto ${q.numero} bloqueado para comercialização: ${motivo}`,
    quarto_id: quartoId, os_id, excluir: usuario.id, agora,
  });
  return Number(r.lastInsertRowid);
}

// Liberação autorizada (seção 20, item 6): apenas gerente da unidade, diretoria ou admin.
// Com `os_id`, libera só o bloqueio daquela OS; o quarto permanece bloqueado se houver outros.
export function liberar(db, usuario, quartoId, { os_id = null, observacao = '', agora } = {}) {
  const q = buscarQuarto(db, quartoId);
  exigirHotel(usuario, q.hotel_id);
  exigirPapel(usuario, 'gerente', 'admin', 'diretoria');
  const ativos = todos(
    db,
    `SELECT * FROM bloqueios WHERE quarto_id = ? AND liberado_em IS NULL ${os_id ? 'AND os_id = ?' : ''}`,
    ...(os_id ? [quartoId, os_id] : [quartoId])
  );
  if (!ativos.length) return 0;
  const quando = agoraIso(agora);
  for (const b of ativos) {
    exec(db, 'UPDATE bloqueios SET liberado_por = ?, liberado_em = ?, observacao_liberacao = ? WHERE id = ?',
      usuario.id, quando, texto(observacao) || null, b.id);
  }
  recalcularStatusComercial(db, quartoId);
  const atual = buscarQuarto(db, quartoId);
  registrarHistorico(db, {
    quarto_id: quartoId, tipo: 'liberacao',
    descricao: atual.status_comercial === 'liberado'
      ? `Quarto liberado para comercialização${observacao ? `: ${texto(observacao)}` : ''}`
      : 'Bloqueio vinculado à OS liberado (há outros bloqueios ativos).',
    os_id, usuario_id: usuario.id, agora,
  });
  if (atual.status_comercial === 'liberado') {
    notificar(db, [...gerentesDoHotel(db, q.hotel_id), ...equipeManutencao(db, q.hotel_id)], {
      tipo: 'quarto_liberado', mensagem: `Quarto ${q.numero} liberado para comercialização.`,
      quarto_id: quartoId, excluir: usuario.id, agora,
    });
  }
  return ativos.length;
}

export function listar(db, usuario, filtros = {}, agora) {
  const f = filtroHotel(usuario, 'q.hotel_id', filtros.hotel_id);
  const now = agoraIso(agora);
  const desde = somarDias(now, -365);
  const linhas = todos(
    db,
    `SELECT q.*, h.nome AS hotel_nome,
      (SELECT COUNT(*) FROM ordens_servico o WHERE o.quarto_id = q.id AND o.status NOT IN (${FINAIS_SQL})) AS os_abertas,
      (SELECT COUNT(*) FROM ordens_servico o WHERE o.quarto_id = q.id AND o.status NOT IN (${ENTREGUES_SQL})
         AND o.prazo_previsto IS NOT NULL AND o.prazo_previsto < ?) AS os_atrasadas,
      (SELECT COUNT(*) FROM ordens_servico o WHERE o.quarto_id = q.id AND o.prioridade = 'emergencial' AND o.status NOT IN (${ENTREGUES_SQL})) AS os_emergenciais,
      (SELECT COUNT(*) FROM problemas_cronicos c WHERE c.quarto_id = q.id AND c.status = 'ativo') AS cronicos,
      (SELECT COALESCE(SUM(c.valor), 0) FROM os_custos c JOIN ordens_servico o ON o.id = c.os_id
         WHERE o.quarto_id = q.id AND c.criado_em >= ?) AS custo_12m
     FROM quartos q JOIN hoteis h ON h.id = q.hotel_id
     WHERE 1 = 1 ${f.sql}
     ORDER BY h.nome, CAST(q.numero AS INTEGER), q.numero`,
    now, desde, ...f.params
  );
  for (const q of linhas) q.inspecao_vencida = !!(q.proxima_inspecao_em && q.proxima_inspecao_em < now);
  let r = linhas;
  if (filtros.status_comercial) r = r.filter((q) => q.status_comercial === filtros.status_comercial);
  if (filtros.inspecao_vencida) r = r.filter((q) => q.inspecao_vencida);
  if (filtros.com_problemas) r = r.filter((q) => q.os_abertas > 0 || q.cronicos > 0);
  return r;
}

export function detalhe(db, usuario, id, agora) {
  const q = buscarQuarto(db, id);
  exigirHotel(usuario, q.hotel_id);
  const now = agoraIso(agora);
  q.hotel = um(db, 'SELECT id, nome, cidade FROM hoteis WHERE id = ?', q.hotel_id);
  q.inspecao_vencida = !!(q.proxima_inspecao_em && q.proxima_inspecao_em < now);
  q.equipamentos = todos(db, 'SELECT * FROM equipamentos WHERE quarto_id = ? AND ativo = 1 ORDER BY tipo', id);
  q.os = todos(
    db,
    `SELECT o.id, o.protocolo, o.titulo, o.categoria, o.equipamento_id, o.prioridade, o.status, o.criado_em, o.concluido_em,
       o.prazo_previsto, o.recorrente, u.nome AS responsavel_nome,
       (SELECT COALESCE(SUM(valor), 0) FROM os_custos WHERE os_id = o.id) AS custo
     FROM ordens_servico o LEFT JOIN usuarios u ON u.id = o.responsavel_id
     WHERE o.quarto_id = ? ORDER BY o.criado_em DESC`,
    id
  );
  for (const o of q.os) o.atrasada = !STATUS_ENTREGUES.includes(o.status) && !!o.prazo_previsto && o.prazo_previsto < now;
  q.custo_total = q.os.reduce((s, o) => s + o.custo, 0);
  q.cronicos = todos(
    db,
    `SELECT c.*, e.tipo AS equipamento_tipo, u.nome AS criado_por_nome FROM problemas_cronicos c
     LEFT JOIN equipamentos e ON e.id = c.equipamento_id LEFT JOIN usuarios u ON u.id = c.criado_por
     WHERE c.quarto_id = ? ORDER BY c.status, c.criado_em DESC`,
    id
  );
  q.bloqueios = todos(
    db,
    `SELECT b.*, o.protocolo, u1.nome AS bloqueado_por_nome, u2.nome AS liberado_por_nome FROM bloqueios b
     LEFT JOIN ordens_servico o ON o.id = b.os_id
     LEFT JOIN usuarios u1 ON u1.id = b.bloqueado_por LEFT JOIN usuarios u2 ON u2.id = b.liberado_por
     WHERE b.quarto_id = ? ORDER BY b.bloqueado_em DESC`,
    id
  );
  q.historico = todos(
    db,
    `SELECT h.*, u.nome AS usuario_nome, o.protocolo FROM quarto_historico h
     LEFT JOIN usuarios u ON u.id = h.usuario_id LEFT JOIN ordens_servico o ON o.id = h.os_id
     WHERE h.quarto_id = ? ORDER BY h.criado_em DESC, h.id DESC`,
    id
  );
  q.inspecoes = todos(
    db,
    `SELECT i.id, i.status, i.pontuacao, i.estrelas, i.iniciada_em, i.concluida_em, u.nome AS inspetor_nome
     FROM inspecoes i JOIN usuarios u ON u.id = i.inspetor_id WHERE i.quarto_id = ? ORDER BY i.iniciada_em DESC`,
    id
  );
  return q;
}

export function criar(db, usuario, dados, agora) {
  exigirPapel(usuario, 'admin', 'gerente');
  const hotelId = Number(dados.hotel_id);
  exigirHotel(usuario, hotelId);
  const numero = texto(dados.numero);
  exigir(numero, 'Informe o número do quarto.');
  exigir(!um(db, 'SELECT id FROM quartos WHERE hotel_id = ? AND numero = ?', hotelId, numero), 'Já existe um quarto com este número neste hotel.');
  const per = Number(dados.periodicidade_inspecao_dias) || 30;
  const now = agoraIso(agora);
  const r = exec(
    db,
    'INSERT INTO quartos (hotel_id, numero, andar, tipo, estrelas, periodicidade_inspecao_dias, proxima_inspecao_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
    hotelId, numero, texto(dados.andar) || null, texto(dados.tipo) || null,
    dados.estrelas ? Number(dados.estrelas) : null, per, somarDias(now, Math.min(7, per)) // primeira inspeção: até 7 dias após o cadastro
  );
  const id = Number(r.lastInsertRowid);
  const doHotel = lerConfig(db, `equipamentos:${hotelId}`);
  const equipamentos = Array.isArray(dados.equipamentos) ? dados.equipamentos : doHotel ? JSON.parse(doHotel) : EQUIPAMENTOS_PADRAO;
  for (const tipo of equipamentos) adicionarEquipamento(db, usuario, id, { tipo }, agora);
  return id;
}

// Cadastro em lote: um andar inteiro de uma vez (ex.: 201 a 220). Números já existentes são ignorados.
export function criarLote(db, usuario, dados, agora) {
  const inicio = Number(dados.inicio);
  const fim = Number(dados.fim);
  exigir(Number.isInteger(inicio) && Number.isInteger(fim) && inicio > 0 && fim >= inicio, 'Informe a numeração inicial e final.');
  exigir(fim - inicio < 200, 'Cadastre no máximo 200 quartos por vez.');
  const criados = [];
  const ignorados = [];
  for (let n = inicio; n <= fim; n++) {
    const numero = String(n);
    if (um(db, 'SELECT id FROM quartos WHERE hotel_id = ? AND numero = ?', Number(dados.hotel_id), numero)) { ignorados.push(numero); continue; }
    criados.push(criar(db, usuario, { ...dados, numero }, agora));
  }
  return { criados: criados.length, ignorados };
}

export function adicionarEquipamento(db, usuario, quartoId, { tipo, descricao, instalado_em }, agora) {
  const q = buscarQuarto(db, quartoId);
  exigirHotel(usuario, q.hotel_id);
  exigir(texto(tipo), 'Informe o tipo do equipamento.');
  const r = exec(db, 'INSERT INTO equipamentos (quarto_id, tipo, descricao, instalado_em) VALUES (?, ?, ?, ?)',
    quartoId, texto(tipo), texto(descricao) || null, normalizarData(instalado_em) || agoraIso(agora));
  return Number(r.lastInsertRowid);
}

// Substituição de equipamento (recomendação da análise de recorrência): desativa o antigo e cria um novo,
// zerando a contagem de recorrência do novo equipamento sem perder o histórico do anterior.
export function substituirEquipamento(db, usuario, equipamentoId, { descricao }, agora) {
  exigirPapel(usuario, 'admin', 'gerente');
  const e = um(db, 'SELECT * FROM equipamentos WHERE id = ?', equipamentoId);
  exigir(e, 'Equipamento não encontrado.', 404);
  const q = buscarQuarto(db, e.quarto_id);
  exigirHotel(usuario, q.hotel_id);
  exec(db, 'UPDATE equipamentos SET ativo = 0 WHERE id = ?', e.id);
  const novo = adicionarEquipamento(db, usuario, e.quarto_id, { tipo: e.tipo, descricao: texto(descricao) || `${e.tipo} (substituído)` }, agora);
  registrarHistorico(db, { quarto_id: e.quarto_id, tipo: 'manutencao', descricao: `Equipamento substituído: ${e.tipo}`, usuario_id: usuario.id, agora });
  return novo;
}

export function programarInspecao(db, usuario, quartoIds, { periodicidade_dias, proxima_em }, agora) {
  exigirPapel(usuario, 'admin', 'gerente', 'governanta');
  for (const id of quartoIds) {
    const q = buscarQuarto(db, id);
    exigirHotel(usuario, q.hotel_id);
    const per = Number(periodicidade_dias) || q.periodicidade_inspecao_dias;
    const prox = normalizarData(proxima_em) || somarDias(q.ultima_inspecao_em || agoraIso(agora), per);
    exec(db, 'UPDATE quartos SET periodicidade_inspecao_dias = ?, proxima_inspecao_em = ?, alerta_inspecao_enviado_em = NULL WHERE id = ?', per, prox, id);
  }
  return quartoIds.length;
}

export function definirEstrelas(db, usuario, quartoId, estrelas) {
  exigirPapel(usuario, 'admin', 'gerente', 'diretoria');
  const q = buscarQuarto(db, quartoId);
  exigirHotel(usuario, q.hotel_id);
  const n = Number(estrelas);
  exigir(n >= 1 && n <= 5, 'A classificação deve estar entre 1 e 5 estrelas.');
  exec(db, 'UPDATE quartos SET estrelas = ? WHERE id = ?', n, quartoId);
}

// ---- Edição e numeração ----

const TABELAS_HISTORICO_QUARTO = ['ordens_servico', 'inspecoes', 'fotos', 'bloqueios', 'problemas_cronicos', 'avaliacoes_hospedes'];
export const temHistorico = (db, quartoId) =>
  TABELAS_HISTORICO_QUARTO.some((t) => um(db, `SELECT 1 AS x FROM ${t} WHERE quarto_id = ? LIMIT 1`, quartoId));

export function editar(db, usuario, id, dados) {
  exigirPapel(usuario, 'admin', 'gerente');
  const q = buscarQuarto(db, id);
  exigirHotel(usuario, q.hotel_id);
  const numero = texto(dados.numero) || q.numero;
  if (numero !== q.numero) {
    exigir(!um(db, 'SELECT id FROM quartos WHERE hotel_id = ? AND numero = ? AND id <> ?', q.hotel_id, numero, q.id), `Já existe o quarto ${numero} neste hotel.`);
  }
  exec(db, 'UPDATE quartos SET numero = ?, andar = ?, tipo = ?, numeracao_provisoria = 0 WHERE id = ?',
    numero, texto(dados.andar) || null, texto(dados.tipo) || null, q.id);
}

// Só exclui quartos sem nenhum registro (OS, inspeção, foto, bloqueio ou problema crônico).
export function apagar(db, quartoId) {
  exec(db, 'DELETE FROM notificacoes WHERE quarto_id = ?', quartoId);
  exec(db, 'DELETE FROM quarto_historico WHERE quarto_id = ?', quartoId);
  exec(db, 'DELETE FROM equipamentos WHERE quarto_id = ?', quartoId);
  exec(db, 'DELETE FROM preventiva_agenda WHERE quarto_id = ?', quartoId);
  exec(db, 'DELETE FROM quartos WHERE id = ?', quartoId);
}

export function excluir(db, usuario, id) {
  exigirPapel(usuario, 'admin', 'gerente');
  const q = buscarQuarto(db, id);
  exigirHotel(usuario, q.hotel_id);
  exigir(!temHistorico(db, q.id), `O quarto ${q.numero} já tem histórico (demandas, inspeções ou fotos) e não pode ser excluído.`);
  apagar(db, q.id);
}

// Substitui os quartos de numeração provisória (criados só pela quantidade) pela numeração real,
// informada em faixas por andar. Quartos provisórios que já têm histórico são mantidos.
export function definirNumeracao(db, usuario, { hotel_id, faixas }, agora) {
  exigirPapel(usuario, 'admin', 'gerente');
  const hotelId = Number(hotel_id || usuario.hotel_id);
  exigirHotel(usuario, hotelId);
  const lista = (Array.isArray(faixas) ? faixas : []).filter((f) => f && (f.inicio || f.fim));
  exigir(lista.length, 'Informe ao menos uma faixa de numeração.');
  const provisorios = todos(db, 'SELECT id, numero FROM quartos WHERE hotel_id = ? AND numeracao_provisoria = 1', hotelId);
  const mantidos = [];
  for (const q of provisorios) {
    if (temHistorico(db, q.id)) mantidos.push(q.numero);
    else apagar(db, q.id);
  }
  let criados = 0;
  const ignorados = [];
  for (const f of lista) {
    const r = criarLote(db, usuario, { hotel_id: hotelId, andar: texto(f.andar) || null, tipo: texto(f.tipo) || null, inicio: f.inicio, fim: f.fim }, agora);
    criados += r.criados;
    ignorados.push(...r.ignorados);
  }
  return { removidos: provisorios.length - mantidos.length, mantidos, criados, ignorados };
}
