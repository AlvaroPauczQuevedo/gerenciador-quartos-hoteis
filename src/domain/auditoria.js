// Registro de ações administrativas: quem fez, o quê, em qual hotel e quando.
// Complementa o histórico das OS (que já registra cada passo do fluxo de manutenção).
import { todos, um, exec } from '../db.js';
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

// Acessos ao sistema: ficam separados das ações administrativas (são muitos) e são apagados após 180 dias.
export const ACOES_ACESSO = {
  login_ok: 'Entrada no sistema',
  login_falha: 'Tentativa de entrada recusada',
  login_bloqueado: 'Endereço bloqueado por excesso de tentativas',
  logout: 'Saída do sistema',
};
export const DIAS_GUARDAR_ACESSOS = 180;

// Resumo do aparelho a partir do user-agent (sem guardar a string inteira).
export function resumirAparelho(ua) {
  const s = String(ua || '');
  const so = /iPhone|iPad/.test(s) ? 'iPhone/iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'Outro';
  const nav = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Navegador';
  return `${nav} em ${so}`;
}

// Nunca grava a senha. O nome de usuário digitado só é guardado se tiver o formato de um login
// (evita registrar uma senha digitada por engano no campo de usuário).
export function registrarAcesso(db, tipo, { login = null, usuario = null, ip = null, aparelho = null, motivo = null, agora } = {}) {
  const digitado = String(login ?? '').trim().toLowerCase();
  const formatoOk = /^[a-z0-9._-]{3,30}$/.test(digitado);
  const conta = usuario || (formatoOk ? um(db, 'SELECT id, hotel_id, login FROM usuarios WHERE login = ?', digitado) : null);
  const detalhes = { ip: ip || '—', aparelho: aparelho || '—' };
  if (motivo) detalhes.motivo = motivo;
  exec(db, 'INSERT INTO auditoria (usuario_id, hotel_id, acao, alvo, detalhes, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
    conta?.id ?? null, conta?.hotel_id ?? null, tipo, conta?.login || (formatoOk ? digitado : '(formato inválido)'), JSON.stringify(detalhes), agoraIso(agora));
}

export function limparAcessosAntigos(db, agora) {
  const corte = new Date(new Date(agoraIso(agora)).getTime() - DIAS_GUARDAR_ACESSOS * 86400e3).toISOString();
  const marcas = Object.keys(ACOES_ACESSO).map(() => '?').join(',');
  return Number(exec(db, `DELETE FROM auditoria WHERE acao IN (${marcas}) AND criado_em < ?`, ...Object.keys(ACOES_ACESSO), corte).changes);
}

export function registrar(db, usuario, acao, { hotel_id = null, alvo = null, detalhes = null, agora } = {}) {
  exec(db, 'INSERT INTO auditoria (usuario_id, hotel_id, acao, alvo, detalhes, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
    usuario?.id ?? null, hotel_id ?? null, acao, alvo == null ? null : String(alvo).slice(0, 200),
    detalhes == null ? null : (typeof detalhes === 'string' ? detalhes : JSON.stringify(detalhes)).slice(0, 1000), agoraIso(agora));
}

// Administrador/diretoria veem a rede; gerente vê o próprio hotel (inclusive ações da rede sobre ele).
// grupo 'acessos' lista entradas/saídas/tentativas; o padrão ('acoes') lista só as ações administrativas.
export function listar(db, usuario, { hotel_id, acao, grupo, limite = 300 } = {}) {
  exigirPapel(usuario, 'admin', 'diretoria', 'gerente');
  const f = filtroHotel(usuario, 'a.hotel_id', hotel_id);
  const params = [...f.params];
  const marcas = Object.keys(ACOES_ACESSO).map(() => '?').join(',');
  let extra = grupo === 'acessos' ? ` AND a.acao IN (${marcas})` : ` AND a.acao NOT IN (${marcas})`;
  params.push(...Object.keys(ACOES_ACESSO));
  if (acao) { extra += ' AND a.acao = ?'; params.push(acao); }
  return todos(db, `SELECT a.*, u.nome AS usuario_nome, u.login AS usuario_login, h.nome AS hotel_nome
    FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id LEFT JOIN hoteis h ON h.id = a.hotel_id
    WHERE 1 = 1 ${f.sql}${extra} ORDER BY a.criado_em DESC, a.id DESC LIMIT ?`, ...params, Math.min(Number(limite) || 300, 2000));
}
