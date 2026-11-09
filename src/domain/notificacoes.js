import { todos, um, exec } from '../db.js';
import { agoraIso } from './comum.js';

// Notificações criadas durante a operação atual, para envio por push DEPOIS do commit
// (o servidor esvazia a fila ao concluir a requisição e a descarta se houver erro/rollback).
export const filaPush = { ativa: false, itens: [] };

export function notificar(db, usuarioIds, { tipo, mensagem, os_id = null, quarto_id = null, excluir = null, agora }) {
  const ids = [...new Set(usuarioIds.filter((id) => id != null && id !== excluir))];
  const quando = agoraIso(agora);
  const st = db.prepare(
    'INSERT INTO notificacoes (usuario_id, tipo, mensagem, os_id, quarto_id, criado_em) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const id of ids) st.run(id, tipo, mensagem, os_id, quarto_id, quando);
  if (filaPush.ativa && ids.length) filaPush.itens.push({ usuarios: ids, tipo, mensagem, os_id, quarto_id });
  return ids.length;
}

// Usuários ativos de determinados papéis que atendem o hotel (vinculados a ele ou à rede).
export function usuariosDoHotel(db, hotelId, papeis) {
  const ph = papeis.map(() => '?').join(',');
  return todos(
    db,
    `SELECT id FROM usuarios WHERE ativo = 1 AND papel IN (${ph}) AND (hotel_id = ? OR hotel_id IS NULL)`,
    ...papeis, hotelId
  ).map((r) => r.id);
}

// Diretoria/admin só recebem alertas gerenciais (recorrência, aprovações), não o dia a dia.
export const equipeManutencao = (db, hotelId) => usuariosDoHotel(db, hotelId, ['manutencao_chefe']);
export const gerentesDoHotel = (db, hotelId) =>
  todos(db, "SELECT id FROM usuarios WHERE ativo = 1 AND papel = 'gerente' AND hotel_id = ?", hotelId).map((r) => r.id);
export const aprovadoresDoHotel = (db, hotelId) => usuariosDoHotel(db, hotelId, ['aprovador_financeiro', 'diretoria']);

export function listar(db, usuarioId, { somenteNaoLidas = false, limite = 50 } = {}) {
  return todos(
    db,
    `SELECT n.*, o.protocolo FROM notificacoes n LEFT JOIN ordens_servico o ON o.id = n.os_id
     WHERE n.usuario_id = ? ${somenteNaoLidas ? 'AND n.lida = 0' : ''}
     ORDER BY n.criado_em DESC, n.id DESC LIMIT ?`,
    usuarioId, limite
  );
}

export const contarNaoLidas = (db, usuarioId) =>
  um(db, 'SELECT COUNT(*) AS n FROM notificacoes WHERE usuario_id = ? AND lida = 0', usuarioId).n;

export function marcarLida(db, usuarioId, id) {
  if (id === 'todas') exec(db, 'UPDATE notificacoes SET lida = 1 WHERE usuario_id = ?', usuarioId);
  else exec(db, 'UPDATE notificacoes SET lida = 1 WHERE usuario_id = ? AND id = ?', usuarioId, Number(id));
}
