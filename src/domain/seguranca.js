// Segurança da conta: verificação em duas etapas (TOTP, RFC 6238 — Google Authenticator, Microsoft
// Authenticator, Authy…) com códigos de recuperação, e a lista de aparelhos/sessões abertas.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { todos, um, exec } from '../db.js';
import { exigir, exigirPapel, agoraIso } from './comum.js';
import { conferirSenha, podeGerenciar } from './usuarios.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASSO_S = 30;

export function base32(buf) {
  let bits = 0; let valor = 0; let saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte; bits += 8;
    while (bits >= 5) { saida += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) saida += B32[(valor << (5 - bits)) & 31];
  return saida;
}

function desfazerBase32(texto) {
  let bits = 0; let valor = 0; const saida = [];
  for (const c of String(texto).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = B32.indexOf(c);
    if (i < 0) return null;
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { saida.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(saida);
}

// Código de 6 dígitos para um "passo" de 30 s desde 1970.
export function codigoTotp(segredoB32, passo) {
  const chave = desfazerBase32(segredoB32);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', chave).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

const iguais = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hashCodigo = (c) => createHash('sha256').update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');

// Aceita o código do passo atual e dos vizinhos (relógios desencontrados) e nunca aceita o mesmo passo duas vezes.
function conferirTotp(db, u, codigo, agora) {
  const limpo = String(codigo || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpo) || !u.totp_segredo) return false;
  const atual = Math.floor((agora ? new Date(agora).getTime() : Date.now()) / 1000 / PASSO_S);
  for (const passo of [atual, atual - 1, atual + 1]) {
    if (passo > (u.totp_ultimo_passo || 0) && iguais(codigoTotp(u.totp_segredo, passo), limpo)) {
      exec(db, 'UPDATE usuarios SET totp_ultimo_passo = ? WHERE id = ?', passo, u.id);
      return true;
    }
  }
  return false;
}

// Segundo fator no login: código do aplicativo ou um código de recuperação (usado uma única vez).
export function verificarSegundoFator(db, u, codigo, agora) {
  if (conferirTotp(db, u, codigo, agora)) return true;
  const h = hashCodigo(codigo || '');
  const lista = JSON.parse(u.totp_recuperacao || '[]');
  if (String(codigo || '').replace(/[^a-z0-9]/gi, '').length >= 8 && lista.includes(h)) {
    exec(db, 'UPDATE usuarios SET totp_recuperacao = ? WHERE id = ?', JSON.stringify(lista.filter((x) => x !== h)), u.id);
    return true;
  }
  return false;
}

const completo = (db, id) => um(db, 'SELECT * FROM usuarios WHERE id = ?', id);

export function estado2FA(db, usuario) {
  const u = completo(db, usuario.id);
  return { ativo: !!u.totp_ativo, recuperacao_restantes: u.totp_ativo ? JSON.parse(u.totp_recuperacao || '[]').length : 0 };
}

// 1º passo: gera o segredo (ainda inativo) para o usuário cadastrar no aplicativo. Exige a senha atual.
export function iniciar2FA(db, usuario, { senha }) {
  const u = completo(db, usuario.id);
  exigir(!u.totp_ativo, 'A verificação em duas etapas já está ativa. Desative-a antes de configurar de novo.');
  exigir(conferirSenha(String(senha || ''), u.senha_hash), 'Senha incorreta.', 400);
  const segredo = base32(randomBytes(20));
  exec(db, 'UPDATE usuarios SET totp_segredo = ?, totp_ativo = 0, totp_ultimo_passo = 0, totp_recuperacao = NULL WHERE id = ?', segredo, u.id);
  const emissor = 'Tri Hotéis';
  return { segredo, uri: `otpauth://totp/${encodeURIComponent(`${emissor}:${u.login}`)}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=${PASSO_S}` };
}

// 2º passo: confirma com um código do aplicativo, ativa e entrega os códigos de recuperação (mostrados uma única vez).
export function ativar2FA(db, usuario, { codigo }, agora) {
  const u = completo(db, usuario.id);
  exigir(u.totp_segredo && !u.totp_ativo, 'Comece a configuração pelo passo 1.');
  exigir(conferirTotp(db, u, codigo, agora), 'Código incorreto. Confira o horário do celular e digite o código atual.', 400);
  const codigos = Array.from({ length: 8 }, () => { const x = randomBytes(5).toString('hex'); return `${x.slice(0, 5)}-${x.slice(5)}`; });
  exec(db, 'UPDATE usuarios SET totp_ativo = 1, totp_recuperacao = ? WHERE id = ?', JSON.stringify(codigos.map(hashCodigo)), u.id);
  return { codigos };
}

export function desativar2FA(db, usuario, { senha, codigo }, agora) {
  const u = completo(db, usuario.id);
  exigir(u.totp_ativo, 'A verificação em duas etapas não está ativa.');
  exigir(conferirSenha(String(senha || ''), u.senha_hash), 'Senha incorreta.', 400);
  exigir(verificarSegundoFator(db, u, codigo, agora), 'Código incorreto.', 400);
  exec(db, 'UPDATE usuarios SET totp_ativo = 0, totp_segredo = NULL, totp_ultimo_passo = 0, totp_recuperacao = NULL WHERE id = ?', u.id);
}

// Quem perdeu o celular e os códigos de recuperação: administrador (ou o gerente, para a equipe do hotel) desliga o segundo fator.
export function resetar2FA(db, usuario, id) {
  exigirPapel(usuario, 'admin', 'gerente');
  const alvo = um(db, 'SELECT id, login, papel, hotel_id FROM usuarios WHERE id = ? AND excluido_em IS NULL', Number(id));
  exigir(alvo, 'Usuário não encontrado.', 404);
  exigir(Number(id) !== usuario.id, 'Use "Desativar" na sua conta, com a senha e um código.');
  exigir(podeGerenciar(usuario, alvo), 'Você não tem permissão para alterar este usuário.', 403);
  exec(db, 'UPDATE usuarios SET totp_ativo = 0, totp_segredo = NULL, totp_ultimo_passo = 0, totp_recuperacao = NULL WHERE id = ?', alvo.id);
  exec(db, 'DELETE FROM sessoes WHERE usuario_id = ?', alvo.id);
  return alvo;
}

// ---- aparelhos e sessões ----
export const idSessao = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16);

export function listarSessoes(db, usuario, tokenAtual) {
  return todos(db, 'SELECT token, criado_em, ip, aparelho, expira_em FROM sessoes WHERE usuario_id = ? AND expira_em > ? ORDER BY criado_em DESC', usuario.id, agoraIso())
    .map((s) => ({ id: idSessao(s.token), criado_em: s.criado_em, ip: s.ip, aparelho: s.aparelho, expira_em: s.expira_em, atual: s.token === tokenAtual }));
}

export function encerrarSessao(db, usuario, id, tokenAtual) {
  const s = todos(db, 'SELECT token FROM sessoes WHERE usuario_id = ?', usuario.id).find((x) => idSessao(x.token) === id);
  exigir(s, 'Sessão não encontrada.', 404);
  exigir(s.token !== tokenAtual, 'Esta é a sessão em uso. Use "Sair" no menu.');
  exec(db, 'DELETE FROM sessoes WHERE token = ?', s.token);
}

export function encerrarOutrasSessoes(db, usuario, tokenAtual) {
  return Number(exec(db, 'DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?', usuario.id, tokenAtual).changes);
}
