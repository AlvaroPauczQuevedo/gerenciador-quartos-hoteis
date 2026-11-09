// Avaliações e reclamações de hóspedes por quarto (registro manual: Booking, Google, recepção...).
// Cruzadas com o histórico de manutenção: nota baixa + manutenção recorrente = quarto prioritário.
import { todos, um, exec } from '../db.js';
import { CATEGORIAS } from './constantes.js';
import { agoraIso, somarDias, exigir, exigirHotel, exigirPapel, filtroHotel, texto, normalizarData, buscarQuarto } from './comum.js';
import { registrarHistorico } from './quartos.js';
import * as os from './os.js';

export const ORIGENS_AVALIACAO = {
  booking: 'Booking.com', google: 'Google', tripadvisor: 'TripAdvisor', expedia: 'Expedia',
  pesquisa: 'Pesquisa interna', recepcao: 'Reclamação na recepção', outro: 'Outro',
};

export function registrar(db, usuario, quartoId, dados, agora) {
  exigirPapel(usuario, 'admin', 'gerente', 'governanta');
  const q = buscarQuarto(db, Number(quartoId));
  exigirHotel(usuario, q.hotel_id);
  const nota = Number(dados.nota);
  exigir(Number.isInteger(nota) && nota >= 1 && nota <= 5, 'Informe uma nota de 1 a 5.');
  exigir(ORIGENS_AVALIACAO[dados.origem], 'Informe a origem da avaliação.');
  if (dados.categoria) exigir(CATEGORIAS[dados.categoria], 'Categoria inválida.');
  const comentario = texto(dados.comentario);
  const data = normalizarData(dados.data) || agoraIso(agora);
  const r = exec(db, `INSERT INTO avaliacoes_hospedes (hotel_id, quarto_id, data, nota, origem, categoria, comentario, registrado_por, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, q.hotel_id, q.id, data, nota, dados.origem, dados.categoria || null, comentario || null, usuario.id, agoraIso(agora));
  const id = Number(r.lastInsertRowid);
  registrarHistorico(db, { quarto_id: q.id, tipo: 'avaliacao', usuario_id: usuario.id, agora,
    descricao: `Avaliação de hóspede (${ORIGENS_AVALIACAO[dados.origem]}): nota ${nota}/5${comentario ? ` — "${comentario.slice(0, 120)}"` : ''}` });
  let osId = null;
  if (dados.gerar_os) {
    exigir(dados.categoria, 'Para gerar uma solicitação, informe a categoria do problema.');
    exigir(comentario.length >= 10, 'Descreva a reclamação (mínimo de 10 caracteres) para gerar a solicitação.');
    osId = os.criar(db, usuario, {
      hotel_id: q.hotel_id, quarto_id: q.id, local: dados.local || 'quarto', categoria: dados.categoria,
      prioridade: dados.prioridade || (nota <= 2 ? 'alta' : 'media'),
      titulo: `Reclamação de hóspede — ${CATEGORIAS[dados.categoria]} (quarto ${q.numero})`,
      descricao: `Hóspede (${ORIGENS_AVALIACAO[dados.origem]}, nota ${nota}/5): ${comentario}`,
      justificativa: 'Problema relatado por hóspede.', impacto: nota <= 2 ? 'medio' : 'baixo',
      identificado_em: data, origem: 'hospede',
    }, agora);
    exec(db, 'UPDATE avaliacoes_hospedes SET os_id = ? WHERE id = ?', osId, id);
  }
  return { id, os_id: osId };
}

export function doQuarto(db, quartoId) {
  const itens = todos(db, `SELECT a.*, u.nome AS registrado_por_nome, o.protocolo FROM avaliacoes_hospedes a
    LEFT JOIN usuarios u ON u.id = a.registrado_por LEFT JOIN ordens_servico o ON o.id = a.os_id
    WHERE a.quarto_id = ? ORDER BY a.data DESC, a.id DESC`, quartoId);
  const media = itens.length ? itens.reduce((s, a) => s + a.nota, 0) / itens.length : null;
  return { itens, media };
}

export function excluir(db, usuario, id) {
  exigirPapel(usuario, 'admin', 'gerente');
  const a = um(db, 'SELECT * FROM avaliacoes_hospedes WHERE id = ?', Number(id));
  exigir(a, 'Avaliação não encontrada.', 404);
  exigirHotel(usuario, a.hotel_id);
  exec(db, 'DELETE FROM avaliacoes_hospedes WHERE id = ?', a.id);
}

// Cruzamento para a gestão: quartos com nota média baixa e quantas manutenções tiveram no período.
export function quartosCriticos(db, usuario, { hotel_id, dias = 180 } = {}, agora) {
  const desde = somarDias(agoraIso(agora), -dias);
  const f = filtroHotel(usuario, 'a.hotel_id', hotel_id);
  return todos(db, `SELECT q.id, q.numero, h.nome AS hotel_nome, COUNT(a.id) AS avaliacoes, AVG(a.nota) AS media,
      (SELECT COUNT(*) FROM ordens_servico o WHERE o.quarto_id = q.id AND o.criado_em >= ? AND o.status NOT IN ('cancelada', 'recusada')) AS manutencoes
    FROM avaliacoes_hospedes a JOIN quartos q ON q.id = a.quarto_id JOIN hoteis h ON h.id = a.hotel_id
    WHERE a.data >= ? ${f.sql} GROUP BY q.id HAVING AVG(a.nota) <= 3 ORDER BY media, manutencoes DESC LIMIT 50`, desde, desde, ...f.params);
}

export function mediaPorHotel(db, hotelId, { dias = 180 } = {}, agora) {
  return um(db, 'SELECT AVG(nota) AS media, COUNT(*) AS n FROM avaliacoes_hospedes WHERE hotel_id = ? AND data >= ?',
    hotelId, somarDias(agoraIso(agora), -dias));
}
