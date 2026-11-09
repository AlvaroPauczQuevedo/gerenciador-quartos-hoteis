// Registro de ações administrativas: quem fez, o quê, em qual hotel e quando.
// Complementa o histórico das OS (que já registra cada passo do fluxo de manutenção).
import { todos, exec } from '../db.js';
import { agoraIso, filtroHotel, exigirPapel } from './comum.js';

export const ACOES_AUDITORIA = {
  usuario_criado: 'Usuário criado',
  usuario_ativado: 'Usuário reativado',
  usuario_desativado: 'Usuário desativado',
  usuario_excluido: 'Usuário excluído',
  senha_redefinida: 'Senha redefinida',
  senha_alterada: 'Senha alterada pelo próprio usuário',
  hotel_criado: 'Hotel cadastrado',
  hotel_alterado: 'Configuração do hotel alterada',
  quarto_criado: 'Quarto(s) cadastrado(s)',
  quarto_editado: 'Quarto editado',
  quarto_excluido: 'Quarto excluído',
  numeracao_definida: 'Numeração real dos quartos aplicada',
  quarto_bloqueado: 'Quarto bloqueado para venda',
  quarto_liberado: 'Quarto liberado para venda',
  checklist_incluido: 'Item incluído no checklist',
  checklist_alternado: 'Item do checklist ativado/desativado',
  checklist_excluido: 'Item excluído do checklist',
  preventiva_criada: 'Plano de preventiva criado',
  preventiva_alterada: 'Plano de preventiva alterado',
  preventiva_excluida: 'Plano de preventiva excluído',
  estoque_item: 'Item de estoque cadastrado/alterado',
  estoque_movimento: 'Movimentação de estoque',
  backup_baixado: 'Backup baixado',
  backup_gerado: 'Backup gerado manualmente',
};

export function registrar(db, usuario, acao, { hotel_id = null, alvo = null, detalhes = null, agora } = {}) {
  exec(db, 'INSERT INTO auditoria (usuario_id, hotel_id, acao, alvo, detalhes, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
    usuario?.id ?? null, hotel_id ?? null, acao, alvo == null ? null : String(alvo).slice(0, 200),
    detalhes == null ? null : (typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes)).slice(0, 1000), agoraIso(agora));
}

// Administrador/diretoria veem a rede; gerente vê o próprio hotel (inclusive ações da rede sobre ele).
export function listar(db, usuario, { hotel_id, acao, limite = 300 } = {}) {
  exigirPapel(usuario, 'admin', 'diretoria', 'gerente');
  const f = filtroHotel(usuario, 'a.hotel_id', hotel_id);
  const params = [...f.params];
  let extra = '';
  if (acao) { extra = ' AND a.acao = ?'; params.push(acao); }
  return todos(db, `SELECT a.*, u.nome AS usuario_nome, u.login AS usuario_login, h.nome AS hotel_nome
    FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN hoteis h ON h.id = a.hotel_id
    WHERE 1 = 1 ${f.sql}${extra} ORDER BY a.criado_em DESC, a.id DESC LIMIT ?`, ...params, Math.min(Number(limite) || 300, 2000));
}
