import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { todos, um, exec } from '../db.js';
import { PAPEIS } from './constantes.js';
import { exigir, exigirPapel, texto, somarHoras, agoraIso, visaoRede } from './comum.js';

export function hashSenha(senha) {
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${scryptSync(senha, sal, 32).toString('hex')}`;
}

function conferirSenha(senha, hash) {
  const [sal, h] = hash.split(':');
  const calc = scryptSync(senha, sal, 32);
  return timingSafeEqual(calc, Buffer.from(h, 'hex'));
}

const PUBLICO = 'u.id, u.nome, u.login, u.papel, u.hotel_id, u.ativo, u.trocar_senha, h.nome AS hotel_nome';

// Nome de usuário: minúsculas, números, ponto, hífen e sublinhado.
export const normalizarLogin = (v) => texto(v).toLowerCase();
const LOGIN_VALIDO = /^[a-z0-9][a-z0-9._-]{2,29}$/;

export function login(db, nomeUsuario, senha) {
  const u = um(db, 'SELECT * FROM usuarios WHERE login = ? AND ativo = 1 AND excluido_em IS NULL', normalizarLogin(nomeUsuario));
  exigir(u && conferirSenha(String(senha || ''), u.senha_hash), 'Usuário ou senha inválidos.', 401);
  const token = randomBytes(32).toString('hex');
  exec(db, 'INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)', token, u.id, somarHoras(agoraIso(), 12));
  return token;
}

export function logout(db, token) {
  exec(db, 'DELETE FROM sessoes WHERE token = ?', token);
}

export function porToken(db, token) {
  if (!token) return null;
  return um(db, `SELECT ${PUBLICO} FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN hoteis h ON h.id = u.hotel_id
    WHERE s.token = ? AND s.expira_em > ? AND u.ativo = 1`, token, agoraIso());
}

const SELECT_HOTEL = `SELECT h.*,
  (SELECT COUNT(*) FROM quartos q WHERE q.hotel_id = h.id) AS total_quartos,
  (SELECT COUNT(*) FROM quartos q WHERE q.hotel_id = h.id AND q.numeracao_provisoria = 1) AS quartos_provisorios
  FROM hoteis h`;

export function listarHoteis(db, usuario) {
  if (visaoRede(usuario)) return todos(db, `${SELECT_HOTEL} ORDER BY h.nome`);
  return todos(db, `${SELECT_HOTEL} WHERE h.id = ?`, usuario.hotel_id);
}

export function criarHotel(db, usuario, dados) {
  exigirPapel(usuario, 'admin');
  exigir(texto(dados.nome), 'Informe o nome do hotel.');
  const r = exec(db, 'INSERT INTO hoteis (nome, cidade, exige_validacao) VALUES (?, ?, ?)',
    texto(dados.nome), texto(dados.cidade) || null, dados.exige_validacao === false ? 0 : 1);
  return Number(r.lastInsertRowid);
}

export function atualizarHotel(db, usuario, id, dados) {
  exigirPapel(usuario, 'admin');
  const h = um(db, 'SELECT * FROM hoteis WHERE id = ?', Number(id));
  exigir(h, 'Hotel não encontrado.', 404);
  const numero = (v, atual) => (v === undefined ? atual : v === '' || v === null ? null : Number(v));
  const limite = numero(dados.limite_aprovacao_gerente, h.limite_aprovacao_gerente) ?? 0;
  const orcamento = numero(dados.orcamento_mensal, h.orcamento_mensal);
  exigir(limite >= 0 && (orcamento === null || orcamento >= 0), 'Valores inválidos.');
  exec(db, `UPDATE hoteis SET nome = ?, cidade = ?, exige_validacao = ?, limite_aprovacao_gerente = ?, orcamento_mensal = ? WHERE id = ?`,
    texto(dados.nome) || h.nome, texto(dados.cidade) || h.cidade, dados.exige_validacao == null ? h.exige_validacao : dados.exige_validacao ? 1 : 0,
    limite, orcamento, h.id);
}

// O gerente administra a equipe do próprio hotel. Acessos da rede (administrador geral e
// diretoria, que enxergam todos os hotéis) só podem ser geridos pelo administrador.
export const PAPEIS_DO_GERENTE = ['gerente', 'governanta', 'tecnico'];

export function podeGerenciar(usuario, alvo) {
  if (usuario.papel === 'admin') return true;
  return usuario.papel === 'gerente' && alvo.hotel_id != null && Number(alvo.hotel_id) === Number(usuario.hotel_id)
    && PAPEIS_DO_GERENTE.includes(alvo.papel);
}

function buscarAlvo(db, usuario, id) {
  exigirPapel(usuario, 'admin', 'gerente');
  const alvo = um(db, 'SELECT id, papel, hotel_id FROM usuarios WHERE id = ? AND excluido_em IS NULL', Number(id));
  exigir(alvo, 'Usuário não encontrado.', 404);
  exigir(podeGerenciar(usuario, alvo), 'Você não tem permissão para alterar este usuário.', 403);
  return alvo;
}

export function listarUsuarios(db, usuario, { hotel_id } = {}) {
  const rede = visaoRede(usuario);
  const where = [];
  const params = [];
  if (!rede) { where.push('(u.hotel_id = ? OR u.hotel_id IS NULL)'); params.push(usuario.hotel_id); }
  if (hotel_id) { where.push('(u.hotel_id = ? OR u.hotel_id IS NULL)'); params.push(Number(hotel_id)); }
  return todos(db, `SELECT ${PUBLICO} FROM usuarios u LEFT JOIN hoteis h ON h.id = u.hotel_id
    WHERE u.excluido_em IS NULL ${where.length ? `AND ${where.join(' AND ')}` : ''} ORDER BY h.nome, u.papel, u.nome`, ...params)
    .map((u) => ({ ...u, gerenciavel: u.id !== usuario.id && podeGerenciar(usuario, u) }));
}

export function criarUsuario(db, usuario, dados) {
  exigirPapel(usuario, 'admin', 'gerente');
  exigir(texto(dados.nome), 'Informe o nome.');
  exigir(PAPEIS[dados.papel], 'Perfil inválido.');
  let hotelId = dados.hotel_id ? Number(dados.hotel_id) : null;
  if (usuario.papel === 'gerente') {
    exigir(PAPEIS_DO_GERENTE.includes(dados.papel), 'O gerente não pode criar acessos de administração ou diretoria da rede.', 403);
    hotelId = usuario.hotel_id;
  }
  const login = normalizarLogin(dados.login);
  exigir(LOGIN_VALIDO.test(login), 'Nome de usuário inválido: use de 3 a 30 letras minúsculas, números, ponto, hífen ou sublinhado, sem espaços.');
  exigir(!um(db, 'SELECT id FROM usuarios WHERE login = ?', login), 'Este nome de usuário já está em uso.');
  exigir(String(dados.senha || '').length >= 8, 'A senha deve ter ao menos 8 caracteres.');
  if (dados.papel === 'gerente' || dados.papel === 'governanta') exigir(hotelId, 'Gerentes e governantas devem estar vinculados a um hotel.');
  const r = exec(db, 'INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id) VALUES (?, ?, ?, ?, ?)',
    texto(dados.nome), login, hashSenha(String(dados.senha)), dados.papel, hotelId);
  return Number(r.lastInsertRowid);
}

export function gerarSenha() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...randomBytes(10)].map((b) => alfabeto[b % alfabeto.length]).join('');
}

export function alterarSenha(db, usuario, { atual, nova }) {
  const u = um(db, 'SELECT * FROM usuarios WHERE id = ?', usuario.id);
  exigir(conferirSenha(String(atual || ''), u.senha_hash), 'Senha atual incorreta.', 400);
  exigir(String(nova || '').length >= 8, 'A nova senha deve ter ao menos 8 caracteres.');
  exigir(String(nova) !== String(atual), 'A nova senha deve ser diferente da atual.');
  exec(db, 'UPDATE usuarios SET senha_hash = ?, trocar_senha = 0 WHERE id = ?', hashSenha(String(nova)), u.id);
}

export function redefinirSenha(db, usuario, id, nova) {
  buscarAlvo(db, usuario, id);
  exigir(String(nova || '').length >= 8, 'A senha deve ter ao menos 8 caracteres.');
  // Senha definida por outra pessoa é provisória: o usuário precisa trocá-la no próximo acesso.
  exec(db, 'UPDATE usuarios SET senha_hash = ?, trocar_senha = 1 WHERE id = ?', hashSenha(String(nova)), Number(id));
  exec(db, 'DELETE FROM sessoes WHERE usuario_id = ?', Number(id));
}

export function alternarAtivo(db, usuario, id) {
  exigir(Number(id) !== usuario.id, 'Você não pode desativar o próprio usuário.');
  buscarAlvo(db, usuario, id);
  exec(db, 'UPDATE usuarios SET ativo = 1 - ativo WHERE id = ?', Number(id));
  exec(db, 'DELETE FROM sessoes WHERE usuario_id = ?', Number(id));
  exec(db, 'DELETE FROM push_inscricoes WHERE usuario_id = ?', Number(id)); // para de receber no celular
}

// Referências que mantêm a rastreabilidade (quem abriu, recebeu, executou, validou...).
const REFERENCIAS = [
  ['ordens_servico', ['aberto_por', 'recebido_por', 'responsavel_id', 'executado_por', 'validado_por']],
  ['os_eventos', ['usuario_id']], ['os_tarefas', ['tecnico_id', 'criado_por']], ['os_materiais', ['solicitado_por']],
  ['os_custos', ['registrado_por']], ['aprovacoes', ['solicitado_por', 'decidido_por']], ['fotos', ['enviado_por']],
  ['inspecoes', ['inspetor_id']], ['problemas_cronicos', ['criado_por']], ['bloqueios', ['bloqueado_por', 'liberado_por']],
  ['quarto_historico', ['usuario_id']],
];

// Exclui o usuário. Sem histórico, o registro é apagado; com histórico, o acesso é removido e o
// nome continua nos registros antigos (o nome de usuário fica livre para ser reutilizado).
export function excluirUsuario(db, usuario, id) {
  exigir(Number(id) !== usuario.id, 'Você não pode excluir o próprio usuário.');
  const alvo = buscarAlvo(db, usuario, id);
  const abertas = um(db, `SELECT COUNT(*) AS n FROM ordens_servico WHERE status NOT IN ('encerrada', 'recusada', 'cancelada')
    AND (responsavel_id = ? OR id IN (SELECT os_id FROM os_tarefas WHERE tecnico_id = ? AND concluida = 0))`, alvo.id, alvo.id).n;
  exigir(!abertas, `Este usuário é responsável por ${abertas} demanda(s) em aberto. Designe outro profissional antes de excluir.`);
  exec(db, 'DELETE FROM sessoes WHERE usuario_id = ?', alvo.id);
  exec(db, 'DELETE FROM push_inscricoes WHERE usuario_id = ?', alvo.id);
  const temHistorico = REFERENCIAS.some(([tabela, colunas]) =>
    um(db, `SELECT 1 AS x FROM ${tabela} WHERE ${colunas.map((c) => `${c} = ?`).join(' OR ')} LIMIT 1`, ...colunas.map(() => alvo.id)));
  if (!temHistorico) {
    exec(db, 'DELETE FROM notificacoes WHERE usuario_id = ?', alvo.id);
    exec(db, 'DELETE FROM usuarios WHERE id = ?', alvo.id);
    return { modo: 'apagado' };
  }
  const agora = new Date().toISOString();
  const marca = `excluido-${alvo.id}-${Date.now()}`;
  exec(db, 'UPDATE usuarios SET ativo = 0, excluido_em = ?, login = ? WHERE id = ?', agora, marca, alvo.id);
  exec(db, 'DELETE FROM notificacoes WHERE usuario_id = ?', alvo.id);
  return { modo: 'arquivado' };
}
