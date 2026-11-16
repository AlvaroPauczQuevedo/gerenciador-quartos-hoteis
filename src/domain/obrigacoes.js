// Obrigações legais e contratos com vencimento (PMOC, caixa d'água, extintores, AVCB, elevadores…).
// Cada hotel tem a sua lista. Registrar a realização calcula o próximo vencimento, guarda o comprovante
// (imagem ou PDF) e o agendador avisa o gerente 30 e 7 dias antes — e a diretoria quando vence.
import { todos, um, exec } from '../db.js';
import { exigir, exigirPapel, exigirHotel, filtroHotel, texto, agoraIso, somarDias } from './comum.js';
import { notificar, gerentesDoHotel, usuariosDoHotel } from './notificacoes.js';
import { guardarComprovante } from './fotos.js';

const PAPEIS = ['admin', 'gerente'];

// Periodicidades-padrão sugeridas; confirme com o engenheiro/contador e a legislação local de cada cidade.
export const TIPOS_OBRIGACAO = {
  pmoc: { nome: 'PMOC — plano de manutenção do ar-condicionado', dias: 365 },
  caixa_dagua: { nome: "Limpeza e desinfecção da caixa d'água", dias: 180 },
  extintores: { nome: 'Extintores: vistoria e recarga', dias: 365 },
  avcb: { nome: 'AVCB / CLCB — Corpo de Bombeiros', dias: 365 },
  dedetizacao: { nome: 'Dedetização e desratização', dias: 180 },
  elevadores: { nome: 'Manutenção dos elevadores', dias: 30 },
  gerador: { nome: 'Teste do gerador', dias: 30 },
  caixa_gordura: { nome: 'Limpeza da caixa de gordura', dias: 90 },
  spda: { nome: 'SPDA (para-raios): laudo', dias: 365 },
  outro: { nome: 'Outra obrigação', dias: 365 },
};

export const DIAS_AVISO = 30;
export const DIAS_AVISO_FINAL = 7;

export const hojeBrasilia = (agora) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora ? new Date(agora) : new Date());
const somarDiasData = (iso, d) => somarDias(`${iso}T12:00:00Z`, d).slice(0, 10);
const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400e3);
const dataBr = (iso) => iso.split('-').reverse().join('/');
const soData = (v) => (v ? String(v).slice(0, 10) : v);
const ehData = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

function situacao(o, hoje) {
  if (!o.proxima_em) return { situacao: 'sem_registro', dias: null };
  const dias = diasEntre(hoje, o.proxima_em);
  return { situacao: dias < 0 ? 'vencida' : dias <= DIAS_AVISO ? 'vencendo' : 'em_dia', dias };
}
const ORDEM = { vencida: 0, sem_registro: 1, vencendo: 2, em_dia: 3 };

export function listar(db, usuario, { hotel_id } = {}, agora) {
  exigirPapel(usuario, 'admin', 'gerente', 'diretoria');
  const f = filtroHotel(usuario, 'o.hotel_id', hotel_id);
  const hoje = hojeBrasilia(agora);
  return todos(db, `SELECT o.*, h.nome AS hotel_nome,
      (SELECT COUNT(*) FROM obrigacoes_registros r WHERE r.obrigacao_id = o.id) AS registros
    FROM obrigacoes o JOIN hoteis h ON h.id = o.hotel_id WHERE 1 = 1 ${f.sql}`, ...f.params)
    .map((o) => ({ ...o, ...situacao(o, hoje), tipo_nome: TIPOS_OBRIGACAO[o.tipo]?.nome }))
    .sort((a, b) => (!a.ativo - !b.ativo) || ORDEM[a.situacao] - ORDEM[b.situacao] || (a.proxima_em || '').localeCompare(b.proxima_em || '') || a.nome.localeCompare(b.nome));
}

export function resumo(db, usuario, filtros = {}, agora) {
  const lista = listar(db, usuario, filtros, agora).filter((o) => o.ativo);
  const conta = (s) => lista.filter((o) => o.situacao === s).length;
  return { vencidas: conta('vencida'), vencendo: conta('vencendo'), sem_registro: conta('sem_registro'), total: lista.length };
}

function dadosValidos(dados, atual = {}) {
  const tipo = dados.tipo ?? atual.tipo ?? 'outro';
  exigir(TIPOS_OBRIGACAO[tipo], 'Tipo de obrigação inválido.');
  const nome = texto(dados.nome ?? atual.nome) || TIPOS_OBRIGACAO[tipo].nome;
  const dias = Number(dados.periodicidade_dias ?? atual.periodicidade_dias ?? TIPOS_OBRIGACAO[tipo].dias);
  exigir(Number.isInteger(dias) && dias >= 1 && dias <= 3650, 'A periodicidade deve ser de 1 a 3650 dias.');
  let proxima = dados.proxima_em === undefined ? atual.proxima_em ?? null : soData(dados.proxima_em) || null;
  if (proxima) exigir(ehData(proxima), 'Data de vencimento inválida.');
  return { tipo, nome, dias, proxima, fornecedor: texto(dados.fornecedor ?? atual.fornecedor) || null, observacoes: texto(dados.observacoes ?? atual.observacoes) || null };
}

export function criar(db, usuario, dados, agora) {
  exigirPapel(usuario, ...PAPEIS);
  const hotelId = Number(dados.hotel_id || usuario.hotel_id);
  exigir(hotelId, 'Informe o hotel.');
  exigirHotel(usuario, hotelId);
  const v = dadosValidos(dados);
  const r = exec(db, `INSERT INTO obrigacoes (hotel_id, tipo, nome, periodicidade_dias, proxima_em, fornecedor, observacoes, ativo, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`, hotelId, v.tipo, v.nome, v.dias, v.proxima, v.fornecedor, v.observacoes, agoraIso(agora));
  return Number(r.lastInsertRowid);
}

function buscar(db, usuario, id) {
  const o = um(db, 'SELECT * FROM obrigacoes WHERE id = ?', Number(id));
  exigir(o, 'Obrigação não encontrada.', 404);
  exigirHotel(usuario, o.hotel_id);
  return o;
}

export function atualizar(db, usuario, id, dados) {
  exigirPapel(usuario, ...PAPEIS);
  const o = buscar(db, usuario, id);
  const v = dadosValidos(dados, o);
  const ativo = dados.ativo === undefined ? o.ativo : dados.ativo ? 1 : 0;
  const mudouData = v.proxima !== o.proxima_em;
  exec(db, `UPDATE obrigacoes SET nome = ?, periodicidade_dias = ?, proxima_em = ?, fornecedor = ?, observacoes = ?, ativo = ?,
    alerta_30_em = CASE WHEN ? THEN NULL ELSE alerta_30_em END, alerta_7_em = CASE WHEN ? THEN NULL ELSE alerta_7_em END,
    alerta_vencida_em = CASE WHEN ? THEN NULL ELSE alerta_vencida_em END WHERE id = ?`,
  v.nome, v.dias, v.proxima, v.fornecedor, v.observacoes, ativo, mudouData ? 1 : 0, mudouData ? 1 : 0, mudouData ? 1 : 0, o.id);
  return o;
}

// Cria as obrigações-padrão que o hotel ainda não tem (sem data: o gerente informa a última realização).
export function criarModelos(db, usuario, hotelId, agora) {
  exigirPapel(usuario, ...PAPEIS);
  hotelId = Number(hotelId || usuario.hotel_id);
  exigirHotel(usuario, hotelId);
  let criadas = 0;
  for (const [tipo, t] of Object.entries(TIPOS_OBRIGACAO)) {
    if (tipo === 'outro' || um(db, 'SELECT 1 AS x FROM obrigacoes WHERE hotel_id = ? AND tipo = ?', hotelId, tipo)) continue;
    exec(db, `INSERT INTO obrigacoes (hotel_id, tipo, nome, periodicidade_dias, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)`, hotelId, tipo, t.nome, t.dias, agoraIso(agora));
    criadas++;
  }
  return criadas;
}

export function registrar(db, usuario, id, dados, ctx, agora) {
  exigirPapel(usuario, ...PAPEIS);
  const o = buscar(db, usuario, id);
  const hoje = hojeBrasilia(agora);
  const realizado = soData(dados.realizado_em) || hoje;
  dados = { ...dados, validade_ate: soData(dados.validade_ate) };
  exigir(ehData(realizado), 'Informe a data em que foi realizado.');
  exigir(realizado <= hoje, 'A data de realização não pode ser no futuro.');
  if (dados.validade_ate) exigir(ehData(dados.validade_ate) && dados.validade_ate > realizado, 'A validade deve ser uma data depois da realização.');
  const custo = dados.custo === undefined || dados.custo === '' || dados.custo === null ? null : Number(dados.custo);
  exigir(custo === null || (Number.isFinite(custo) && custo >= 0), 'Custo inválido.');
  const anexo = dados.comprovante ? guardarComprovante(dados.comprovante, ctx.uploadsDir) : null;
  const proxima = dados.validade_ate || somarDiasData(realizado, o.periodicidade_dias);
  exec(db, `INSERT INTO obrigacoes_registros (obrigacao_id, hotel_id, realizado_em, validade_ate, fornecedor, custo, observacao, arquivo, mime, usuario_id, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, o.id, o.hotel_id, realizado, dados.validade_ate || null, texto(dados.fornecedor) || null, custo,
  texto(dados.observacao) || null, anexo?.nome ?? null, anexo?.mime ?? null, usuario.id, agoraIso(agora));
  // Só avança o vencimento se esta for a realização mais recente (permite lançar um comprovante antigo sem bagunçar a data).
  if (!o.ultima_em || realizado >= o.ultima_em) {
    exec(db, 'UPDATE obrigacoes SET ultima_em = ?, proxima_em = ?, alerta_30_em = NULL, alerta_7_em = NULL, alerta_vencida_em = NULL WHERE id = ?', realizado, proxima, o.id);
  }
  return { proxima_em: um(db, 'SELECT proxima_em FROM obrigacoes WHERE id = ?', o.id).proxima_em, obrigacao: o };
}

export function historico(db, usuario, id) {
  exigirPapel(usuario, 'admin', 'gerente', 'diretoria');
  const o = buscar(db, usuario, id);
  return todos(db, `SELECT r.*, u.nome AS usuario_nome FROM obrigacoes_registros r LEFT JOIN usuarios u ON u.id = r.usuario_id
    WHERE r.obrigacao_id = ? ORDER BY r.realizado_em DESC, r.id DESC`, o.id);
}

export function excluir(db, usuario, id) {
  exigirPapel(usuario, ...PAPEIS);
  const o = buscar(db, usuario, id);
  exigir(!um(db, 'SELECT 1 AS x FROM obrigacoes_registros WHERE obrigacao_id = ?', o.id), 'Esta obrigação já tem registros (comprovantes). Para deixar de acompanhá-la, desative-a.');
  exec(db, 'DELETE FROM obrigacoes WHERE id = ?', o.id);
  return o;
}

// Chamado pelo agendador.
export function verificar(db, agora) {
  const hoje = hojeBrasilia(agora);
  const now = agoraIso(agora);
  let enviados = 0;
  for (const o of todos(db, 'SELECT * FROM obrigacoes WHERE ativo = 1 AND proxima_em IS NOT NULL')) {
    const dias = diasEntre(hoje, o.proxima_em);
    const gerentes = gerentesDoHotel(db, o.hotel_id);
    const marcar = (col) => exec(db, `UPDATE obrigacoes SET ${col} = ? WHERE id = ?`, now, o.id);
    if (dias < 0) {
      if (o.alerta_vencida_em) continue;
      enviados += notificar(db, [...gerentes, ...usuariosDoHotel(db, o.hotel_id, ['diretoria', 'admin'])], {
        tipo: 'obrigacao', agora, mensagem: `VENCIDA: ${o.nome} venceu em ${dataBr(o.proxima_em)}. Regularize e registre a realização com o comprovante.` });
      marcar('alerta_vencida_em');
    } else if (dias <= DIAS_AVISO_FINAL) {
      if (o.alerta_7_em) continue;
      enviados += notificar(db, gerentes, { tipo: 'obrigacao', agora, mensagem: `${o.nome} vence ${dias === 0 ? 'hoje' : `em ${dias} dia(s)`} (${dataBr(o.proxima_em)}).` });
      marcar('alerta_7_em'); if (!o.alerta_30_em) marcar('alerta_30_em');
    } else if (dias <= DIAS_AVISO) {
      if (o.alerta_30_em) continue;
      enviados += notificar(db, gerentes, { tipo: 'obrigacao', agora, mensagem: `${o.nome} vence em ${dias} dias (${dataBr(o.proxima_em)}). Programe o serviço.` });
      marcar('alerta_30_em');
    }
  }
  return enviados;
}
