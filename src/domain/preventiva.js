// Manutenção preventiva programada: planos recorrentes (ex.: limpeza do ar-condicionado a cada 90 dias)
// que geram OS automaticamente. As datas dos quartos são distribuídas ao longo do período, para a equipe
// não receber o hotel inteiro de uma vez. Uma nova OS só é gerada quando a anterior do mesmo plano/quarto
// já foi encerrada — nada se acumula.
import { todos, um, exec } from '../db.js';
import { CATEGORIAS, LOCAIS, PRIORIDADES, STATUS_FINAIS } from './constantes.js';
import { agoraIso, somarDias, exigir, exigirHotel, exigirPapel, filtroHotel, texto, normalizarData } from './comum.js';
import { notificar, equipeManutencao } from './notificacoes.js';
import * as os from './os.js';

const PAPEIS = ['admin', 'gerente', 'manutencao_chefe'];
const FINAIS_SQL = STATUS_FINAIS.map((s) => `'${s}'`).join(',');
const MAX_POR_RODADA = 60; // por plano, para não travar o sistema numa geração grande

function buscarPlano(db, usuario, id) {
  const p = um(db, 'SELECT * FROM planos_preventiva WHERE id = ?', Number(id));
  exigir(p, 'Plano de preventiva não encontrado.', 404);
  exigirHotel(usuario, p.hotel_id);
  return p;
}

function validar(dados) {
  const nome = texto(dados.nome);
  exigir(nome, 'Informe o nome do plano.');
  exigir(CATEGORIAS[dados.categoria], 'Categoria inválida.');
  exigir(LOCAIS[dados.local || 'quarto'], 'Local inválido.');
  const periodicidade = Number(dados.periodicidade_dias);
  exigir(Number.isInteger(periodicidade) && periodicidade >= 7 && periodicidade <= 730, 'A periodicidade deve ser de 7 a 730 dias.');
  exigir(PRIORIDADES[dados.prioridade || 'baixa'] && dados.prioridade !== 'emergencial', 'Prioridade inválida para preventiva.');
  exigir(['quartos', 'area'].includes(dados.escopo || 'quartos'), 'Escopo inválido.');
  return { nome, periodicidade };
}

// Garante uma linha de agenda para cada quarto (ou uma única, para áreas comuns).
export function sincronizarAgenda(db, plano, { inicio, agora } = {}) {
  const base = inicio || agoraIso(agora);
  if (plano.escopo === 'area') {
    if (!um(db, 'SELECT 1 AS x FROM preventiva_agenda WHERE plano_id = ? AND quarto_id IS NULL', plano.id)) {
      exec(db, 'INSERT INTO preventiva_agenda (plano_id, quarto_id, proxima_em) VALUES (?, NULL, ?)', plano.id, base);
    }
    return;
  }
  const quartos = todos(db, `SELECT q.id FROM quartos q WHERE q.hotel_id = ?
    AND NOT EXISTS (SELECT 1 FROM preventiva_agenda a WHERE a.plano_id = ? AND a.quarto_id = q.id)
    ORDER BY CAST(q.numero AS INTEGER), q.numero`, plano.hotel_id, plano.id);
  const st = db.prepare('INSERT INTO preventiva_agenda (plano_id, quarto_id, proxima_em) VALUES (?, ?, ?)');
  // Distribui as datas ao longo do período (ex.: 105 quartos a cada 90 dias ≈ 1,2 por dia).
  quartos.forEach((q, i) => st.run(plano.id, q.id, somarDias(base, Math.floor((i * plano.periodicidade_dias) / quartos.length))));
}

export function criarPlano(db, usuario, dados, agora) {
  exigirPapel(usuario, ...PAPEIS);
  const hotelId = Number(dados.hotel_id || usuario.hotel_id);
  exigir(hotelId, 'Informe o hotel.');
  exigirHotel(usuario, hotelId);
  const { nome, periodicidade } = validar(dados);
  const r = exec(db, `INSERT INTO planos_preventiva (hotel_id, nome, descricao, categoria, local, equipamento, escopo, periodicidade_dias, prioridade, criado_por, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, hotelId, nome, texto(dados.descricao) || null, dados.categoria, dados.local || 'quarto',
  texto(dados.equipamento) || null, dados.escopo || 'quartos', periodicidade, dados.prioridade || 'baixa', usuario.id, agoraIso(agora));
  const plano = um(db, 'SELECT * FROM planos_preventiva WHERE id = ?', Number(r.lastInsertRowid));
  sincronizarAgenda(db, plano, { inicio: normalizarData(dados.inicio_em) || agoraIso(agora), agora });
  return plano.id;
}

export function alterarPlano(db, usuario, id, dados) {
  exigirPapel(usuario, ...PAPEIS);
  const p = buscarPlano(db, usuario, id);
  if (dados.ativo !== undefined) exec(db, 'UPDATE planos_preventiva SET ativo = ? WHERE id = ?', dados.ativo ? 1 : 0, p.id);
  if (dados.periodicidade_dias !== undefined || dados.nome !== undefined) {
    const { nome, periodicidade } = validar({ ...p, ...dados });
    exec(db, 'UPDATE planos_preventiva SET nome = ?, periodicidade_dias = ?, descricao = ? WHERE id = ?',
      nome, periodicidade, dados.descricao !== undefined ? texto(dados.descricao) || null : p.descricao, p.id);
  }
  return p;
}

export function excluirPlano(db, usuario, id) {
  exigirPapel(usuario, ...PAPEIS);
  const p = buscarPlano(db, usuario, id);
  exec(db, 'DELETE FROM preventiva_agenda WHERE plano_id = ?', p.id);
  exec(db, 'DELETE FROM planos_preventiva WHERE id = ?', p.id); // as OS já geradas permanecem no histórico
  return p;
}

export function listar(db, usuario, { hotel_id } = {}, agora) {
  const now = agoraIso(agora);
  const f = filtroHotel(usuario, 'p.hotel_id', hotel_id);
  const planos = todos(db, `SELECT p.*, h.nome AS hotel_nome, u.nome AS criado_por_nome,
      (SELECT COUNT(*) FROM preventiva_agenda a WHERE a.plano_id = p.id) AS alvos,
      (SELECT MIN(a.proxima_em) FROM preventiva_agenda a WHERE a.plano_id = p.id) AS proxima_em,
      (SELECT COUNT(*) FROM preventiva_agenda a WHERE a.plano_id = p.id AND a.proxima_em <= ?) AS vencidas,
      (SELECT COUNT(*) FROM ordens_servico o WHERE o.plano_preventiva_id = p.id AND o.status NOT IN (${FINAIS_SQL})) AS os_abertas,
      (SELECT COUNT(*) FROM ordens_servico o WHERE o.plano_preventiva_id = p.id AND o.status = 'encerrada') AS os_encerradas
    FROM planos_preventiva p JOIN hoteis h ON h.id = p.hotel_id LEFT JOIN usuarios u ON u.id = p.criado_por
    WHERE 1 = 1 ${f.sql} ORDER BY p.ativo DESC, h.nome, p.nome`, now, ...f.params);
  const fa = filtroHotel(usuario, 'p.hotel_id', hotel_id);
  const proximas = todos(db, `SELECT a.proxima_em, p.id AS plano_id, p.nome AS plano, q.id AS quarto_id, q.numero AS quarto_numero, h.nome AS hotel_nome
    FROM preventiva_agenda a JOIN planos_preventiva p ON p.id = a.plano_id JOIN hoteis h ON h.id = p.hotel_id
    LEFT JOIN quartos q ON q.id = a.quarto_id
    WHERE p.ativo = 1 AND a.proxima_em <= ? ${fa.sql} ORDER BY a.proxima_em LIMIT 200`, somarDias(now, 30), ...fa.params);
  return { planos, proximas };
}

function autorDoPlano(db, plano) {
  const criador = um(db, `SELECT id, nome, papel, hotel_id FROM usuarios WHERE id = ? AND ativo = 1 AND excluido_em IS NULL
    AND papel IN ('admin', 'gerente', 'manutencao_chefe')`, plano.criado_por);
  if (criador) return criador;
  return um(db, `SELECT id, nome, papel, hotel_id FROM usuarios WHERE ativo = 1 AND excluido_em IS NULL
    AND ((papel IN ('gerente', 'manutencao_chefe') AND hotel_id = ?) OR papel = 'admin') ORDER BY papel = 'admin', id LIMIT 1`, plano.hotel_id);
}

// Executado pelo agendador: gera as OS preventivas vencidas.
export function gerar(db, agora) {
  const now = agoraIso(agora);
  let total = 0;
  for (const plano of todos(db, 'SELECT * FROM planos_preventiva WHERE ativo = 1')) {
    sincronizarAgenda(db, plano, { agora });
    const autor = autorDoPlano(db, plano);
    if (!autor) continue;
    const devidas = todos(db, `SELECT a.*, q.numero FROM preventiva_agenda a LEFT JOIN quartos q ON q.id = a.quarto_id
      WHERE a.plano_id = ? AND a.proxima_em <= ? ORDER BY a.proxima_em LIMIT ?`, plano.id, now, MAX_POR_RODADA);
    let geradas = 0;
    for (const a of devidas) {
      // Ainda há OS em aberto deste plano para este quarto: não acumula outra.
      if (a.ultima_os_id && um(db, `SELECT 1 AS x FROM ordens_servico WHERE id = ? AND status NOT IN (${FINAIS_SQL})`, a.ultima_os_id)) continue;
      const equipamento = plano.equipamento && a.quarto_id
        ? um(db, 'SELECT id FROM equipamentos WHERE quarto_id = ? AND tipo = ? AND ativo = 1', a.quarto_id, plano.equipamento)?.id : null;
      const osId = os.criar(db, autor, {
        hotel_id: plano.hotel_id, quarto_id: a.quarto_id, equipamento_id: equipamento, local: plano.local,
        categoria: plano.categoria, prioridade: plano.prioridade,
        titulo: `Preventiva: ${plano.nome}${a.numero ? ` — quarto ${a.numero}` : ''}`,
        descricao: plano.descricao && plano.descricao.length >= 10 ? plano.descricao : `Manutenção preventiva programada: ${plano.nome}.`,
        justificativa: `Plano de manutenção preventiva (a cada ${plano.periodicidade_dias} dias).`,
        prazo_desejado: somarDias(now, Math.max(2, Math.min(7, Math.floor(plano.periodicidade_dias / 2)))),
        origem: 'preventiva', plano_preventiva_id: plano.id,
      }, agora);
      // Próxima data: mantém o ritmo; se ficou muito para trás, recomeça a partir de hoje.
      let proxima = somarDias(a.proxima_em, plano.periodicidade_dias);
      if (proxima <= now) proxima = somarDias(now, plano.periodicidade_dias);
      exec(db, 'UPDATE preventiva_agenda SET ultima_os_id = ?, proxima_em = ? WHERE id = ?', osId, proxima, a.id);
      geradas++;
    }
    if (geradas) {
      notificar(db, equipeManutencao(db, plano.hotel_id), {
        tipo: 'nova_demanda', agora,
        mensagem: `Preventiva "${plano.nome}": ${geradas} ordem(ns) de serviço gerada(s) automaticamente.`,
      });
      total += geradas;
    }
  }
  return total;
}
