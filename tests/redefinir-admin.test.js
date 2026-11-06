import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, exec, um } from '../src/db.js';
import { redefinirAdmin, redefinirAdminUmaVez } from '../src/redefinir-admin.js';
import { hashSenha, login } from '../src/domain/usuarios.js';

test('redefine somente a senha do admin, invalida sessões e preserva os demais dados', () => {
  const db = abrirBanco(':memory:');
  const dataDir = mkdtempSync(join(tmpdir(), 'hotelaria-reset-admin-'));
  try {
    const hotelId = Number(exec(db, 'INSERT INTO hoteis (nome, cidade) VALUES (?, ?)', 'Hotel teste', 'Osório').lastInsertRowid);
    const adminId = Number(exec(db, `INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id)
      VALUES (?, 'admin', ?, 'admin', NULL)`, 'Administrador', hashSenha('senha-antiga')).lastInsertRowid);
    const outroId = Number(exec(db, `INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id)
      VALUES (?, 'gerencia', ?, 'gerente', ?)`, 'Gerente', hashSenha('senha-gerente'), hotelId).lastInsertRowid);
    const token = login(db, 'admin', 'senha-antiga');

    const arquivo = redefinirAdmin(db, dataDir);
    const senhaNova = readFileSync(arquivo, 'utf8').match(/^Senha: (.+)$/m)?.[1];

    assert.ok(senhaNova);
    assert.ok(login(db, 'admin', senhaNova));
    assert.equal(um(db, 'SELECT token FROM sessoes WHERE token = ?', token), null);
    assert.equal(um(db, 'SELECT id FROM usuarios WHERE id = ?', outroId).id, outroId);
    assert.equal(um(db, 'SELECT id FROM hoteis WHERE id = ?', hotelId).id, hotelId);
    assert.equal(um(db, 'SELECT id FROM usuarios WHERE id = ?', adminId).id, adminId);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('não altera nada quando não há administrador ativo e não excluído', () => {
  const db = abrirBanco(':memory:');
  const dataDir = mkdtempSync(join(tmpdir(), 'hotelaria-reset-admin-'));
  try {
    assert.throws(() => redefinirAdmin(db, dataDir), /Administrador ativo não encontrado/);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('o token temporário só redefine a senha uma vez, mesmo após reinicializações', () => {
  const db = abrirBanco(':memory:');
  const dataDir = mkdtempSync(join(tmpdir(), 'hotelaria-reset-admin-'));
  try {
    exec(db, `INSERT INTO usuarios (nome, login, senha_hash, papel)
      VALUES ('Administrador', 'admin', ?, 'admin')`, hashSenha('senha-antiga'));
    const token = 'token-temporario-de-recuperacao-com-mais-de-32-caracteres';

    const arquivo = redefinirAdminUmaVez(db, dataDir, token);
    const senhaNova = readFileSync(arquivo, 'utf8').match(/^Senha: (.+)$/m)?.[1];
    assert.ok(senhaNova);
    assert.equal(login(db, 'admin', senhaNova).length, 64);
    assert.equal(redefinirAdminUmaVez(db, dataDir, token), null);
    assert.throws(() => redefinirAdminUmaVez(db, dataDir, 'curto'), /ao menos 32 caracteres/);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
