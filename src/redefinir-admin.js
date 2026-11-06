import { createHash, randomBytes } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, exec, transacao, um } from './db.js';
import { gerarSenha, hashSenha } from './domain/usuarios.js';

export function redefinirAdmin(db, dataDir) {
  const admin = um(db, `SELECT id FROM usuarios
    WHERE login = 'admin' AND papel = 'admin' AND ativo = 1 AND excluido_em IS NULL`);
  if (!admin) throw new Error('Administrador ativo não encontrado; nenhum dado foi alterado.');

  const senha = gerarSenha();
  const arquivo = join(dataDir, `credenciais-admin-${Date.now()}-${randomBytes(3).toString('hex')}.txt`);

  try {
    transacao(db, () => {
      exec(db, 'UPDATE usuarios SET senha_hash = ? WHERE id = ?', hashSenha(senha), admin.id);
      exec(db, 'DELETE FROM sessoes WHERE usuario_id = ?', admin.id);
      writeFileSync(arquivo, `Login: admin\nSenha: ${senha}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    });
  } catch (erro) {
    rmSync(arquivo, { force: true });
    throw erro;
  }

  return arquivo;
}

export function redefinirAdminUmaVez(db, dataDir, token) {
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('ADMIN_RESET_TOKEN deve conter ao menos 32 caracteres.');
  }
  const identificador = createHash('sha256').update(token).digest('hex');
  const marcador = join(dataDir, `.admin-reset-${identificador}.done`);
  if (existsSync(marcador)) return null;

  const admin = um(db, `SELECT id FROM usuarios
    WHERE login = 'admin' AND papel = 'admin' AND ativo = 1 AND excluido_em IS NULL`);
  if (!admin) throw new Error('Administrador ativo não encontrado; nenhum dado foi alterado.');

  const senha = gerarSenha();
  const arquivo = join(dataDir, `credenciais-admin-${Date.now()}-${randomBytes(3).toString('hex')}.txt`);
  let marcadorCriado = false;
  try {
    transacao(db, () => {
      exec(db, 'UPDATE usuarios SET senha_hash = ? WHERE id = ?', hashSenha(senha), admin.id);
      exec(db, 'DELETE FROM sessoes WHERE usuario_id = ?', admin.id);
      writeFileSync(arquivo, `Login: admin\nSenha: ${senha}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      writeFileSync(marcador, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      marcadorCriado = true;
    });
  } catch (erro) {
    rmSync(arquivo, { force: true });
    if (marcadorCriado) rmSync(marcador, { force: true });
    throw erro;
  }
  return arquivo;
}

export function atualizarNomeAdminUmaVez(db, dataDir, token, nome) {
  if (typeof token !== 'string' || token.length < 32) {
    throw new Error('ADMIN_NAME_RESET_TOKEN deve conter ao menos 32 caracteres.');
  }
  const nomeAdmin = typeof nome === 'string' ? nome.trim() : '';
  if (!nomeAdmin) throw new Error('ADMIN_DISPLAY_NAME não pode ficar vazio.');

  const identificador = createHash('sha256').update(token).digest('hex');
  const marcador = join(dataDir, `.admin-name-${identificador}.done`);
  if (existsSync(marcador)) return false;

  const admin = um(db, `SELECT id FROM usuarios
    WHERE login = 'admin' AND papel = 'admin' AND ativo = 1 AND excluido_em IS NULL`);
  if (!admin) throw new Error('Administrador ativo não encontrado; nenhum dado foi alterado.');

  let marcadorCriado = false;
  try {
    transacao(db, () => {
      exec(db, 'UPDATE usuarios SET nome = ? WHERE id = ?', nomeAdmin, admin.id);
      writeFileSync(marcador, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      marcadorCriado = true;
    });
  } catch (erro) {
    if (marcadorCriado) rmSync(marcador, { force: true });
    throw erro;
  }
  return true;
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = resolve(process.env.DATA_DIR || join(raiz, 'data'));
  const caminhoBanco = join(dataDir, 'hotelaria.db');
  if (!existsSync(caminhoBanco)) throw new Error(`Banco não encontrado: ${caminhoBanco}. Nenhum dado foi alterado.`);

  const db = abrirBanco(caminhoBanco);
  try {
    const arquivo = redefinirAdmin(db, dataDir);
    console.log(`Senha do admin redefinida. Consulte o arquivo ${arquivo} no Gerenciador de arquivos e apague-o após entrar.`);
  } finally {
    db.close();
  }
}
