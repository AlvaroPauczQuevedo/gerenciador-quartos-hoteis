import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco, todos, um, lerConfig } from '../src/db.js';
import { popularPiloto, CHECKLIST_PILOTO, EQUIPAMENTOS_PILOTO } from '../src/seed.js';
import * as inspecoes from '../src/domain/inspecoes.js';
import * as usuarios from '../src/domain/usuarios.js';
import * as quartos from '../src/domain/quartos.js';

test('piloto cria apenas o hotel Executive Osório, com senhas únicas e válidas', () => {
  const db = abrirBanco(':memory:');
  const cred = popularPiloto(db);
  const hoteis = todos(db, 'SELECT * FROM hoteis');
  assert.equal(hoteis.length, 1);
  assert.match(hoteis[0].nome, /Executive Osório/);
  assert.equal(lerConfig(db, 'modo'), 'piloto');
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM ordens_servico').n, 0);
  assert.equal(new Set(cred.map((c) => c.senha)).size, cred.length);
  for (const c of cred) assert.ok(usuarios.login(db, c.login, c.senha));
  assert.throws(() => usuarios.login(db, cred[0].login, 'demo123'), (e) => e.status === 401);
  assert.deepEqual(cred.map((c) => c.login), ['admin', 'gerencia', 'governanca', 'manutencao', 'tecnico', 'financeiro']);
});

test('troca de senha e cadastro de quartos em lote', () => {
  const db = abrirBanco(':memory:');
  const [admin] = popularPiloto(db);
  const u = um(db, 'SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = ?', admin.login);
  assert.throws(() => usuarios.alterarSenha(db, u, { atual: 'errada', nova: 'novaSenha123' }), /incorreta/);
  usuarios.alterarSenha(db, u, { atual: admin.senha, nova: 'novaSenha123' });
  assert.ok(usuarios.login(db, 'ADMIN ', 'novaSenha123'), 'login ignora maiúsculas e espaços');

  const hotelId = um(db, 'SELECT id FROM hoteis').id;
  assert.equal(quartos.criarLote(db, u, { hotel_id: hotelId, inicio: 101, fim: 110, andar: '1' }).criados, 10);
  const r = quartos.criarLote(db, u, { hotel_id: hotelId, inicio: 109, fim: 112 });
  assert.equal(r.criados, 2);
  assert.deepEqual(r.ignorados, ['109', '110']);
  assert.equal(um(db, "SELECT COUNT(*) AS n FROM equipamentos WHERE quarto_id IN (SELECT id FROM quartos WHERE andar IS NULL OR andar = '1')").n, 12 * EQUIPAMENTOS_PILOTO.length);
});

test('apartamentos 401–821 e checklist da gerência', () => {
  const db = abrirBanco(':memory:');
  popularPiloto(db);
  const numeros = todos(db, 'SELECT numero FROM quartos ORDER BY CAST(numero AS INTEGER)').map((q) => q.numero);
  assert.equal(numeros.length, 105);
  assert.equal(numeros[0], '401');
  assert.equal(numeros.at(-1), '821');
  assert.ok(!numeros.includes('422') && numeros.includes('521') && numeros.includes('701'));

  const gov = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'governanta'");
  const q = um(db, "SELECT id FROM quartos WHERE numero = '512'");
  const id = inspecoes.criar(db, gov, { quarto_id: q.id });
  const itens = todos(db, 'SELECT * FROM inspecao_itens WHERE inspecao_id = ?', id);
  assert.equal(itens.length, CHECKLIST_PILOTO.length);
  const tv = itens.find((i) => i.item === 'TV funcionando');
  const pintura = itens.find((i) => i.item === 'Pintura — teto');
  assert.equal(tv.critico, 1);
  assert.ok(tv.equipamento_id, 'TV vinculada ao equipamento do quarto');

  for (const it of itens) inspecoes.responder(db, gov, it.id, { resposta: 'conforme' });
  inspecoes.responder(db, gov, tv.id, { resposta: 'manutencao', observacao: 'Não liga' });
  inspecoes.responder(db, gov, pintura.id, { resposta: 'atencao', observacao: 'Mancha' });
  const r = inspecoes.concluir(db, gov, id, { gerar_os_automaticas: true });
  assert.equal(r.geradas.length, 1);
  assert.equal(r.cronicos, 1);
  const os = um(db, 'SELECT * FROM ordens_servico WHERE id = ?', r.geradas[0].os_id);
  assert.equal(os.prioridade, 'alta');
  assert.equal(um(db, 'SELECT status_comercial FROM quartos WHERE id = ?', q.id).status_comercial, 'bloqueado');
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM problemas_cronicos WHERE quarto_id = ?', q.id).n, 1);
});

test('fotos padrão: aplicar ao andar e remover de todos', async () => {
  const { mkdtempSync, existsSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const fotos = await import('../src/domain/fotos.js');
  const ctx = { uploadsDir: mkdtempSync(join(tmpdir(), 'hq-padrao-')) };
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  const db = abrirBanco(':memory:');
  popularPiloto(db);
  const ger = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'gerente'");
  const tec = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'tecnico'");
  const q = um(db, "SELECT id FROM quartos WHERE numero = '603'");
  assert.throws(() => fotos.salvarPadrao(db, tec, q.id, { fotos: [{ arquivo: PNG }] }, ctx), (e) => e.status === 403);
  const r = fotos.salvarPadrao(db, ger, q.id, { fotos: [{ arquivo: PNG }], legenda: 'Cama montada', aplicar: 'andar' }, ctx);
  assert.deepEqual(r, { fotos: 1, quartos: 21 });
  assert.equal(readdirSync(ctx.uploadsDir).length, 1, 'um único arquivo para os 21 quartos');
  const outro = um(db, "SELECT id FROM quartos WHERE numero = '621'");
  const [f] = fotos.listarPadrao(db, outro.id);
  assert.equal(f.legenda, 'Cama montada');
  assert.equal(fotos.galeriaQuarto(db, ger, outro.id).fotos.length, 0, 'padrão fica fora do histórico cronológico');
  assert.equal(fotos.removerPadrao(db, ger, f.id, {}, ctx), 1);
  assert.equal(fotos.removerPadrao(db, ger, fotos.listarPadrao(db, q.id)[0].id, { todos: true }, ctx), 20);
  assert.ok(!existsSync(join(ctx.uploadsDir, f.arquivo)), 'arquivo apagado quando ninguém mais usa');
});

test('gerente administra a equipe do hotel, mas não o acesso da rede', () => {
  const db = abrirBanco(':memory:');
  popularPiloto(db);
  const ger = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'gerente'");
  const admin = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'admin'");
  const tec = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'tecnico'");

  // Cria técnico: o hotel é sempre o do gerente, mesmo que outro seja enviado.
  const novo = usuarios.criarUsuario(db, ger, { nome: 'Novo Técnico', login: 'novo', papel: 'tecnico', senha: 'senhaBoa123', hotel_id: 999 });
  assert.equal(um(db, 'SELECT hotel_id FROM usuarios WHERE id = ?', novo).hotel_id, ger.hotel_id);
  assert.throws(() => usuarios.criarUsuario(db, ger, { nome: 'X', login: 'x', papel: 'admin', senha: 'senhaBoa123' }), (e) => e.status === 403);
  assert.throws(() => usuarios.criarUsuario(db, ger, { nome: 'Y', login: 'y', papel: 'diretoria', senha: 'senhaBoa123' }), (e) => e.status === 403);

  usuarios.redefinirSenha(db, ger, tec.id, 'outraSenha123');
  usuarios.alternarAtivo(db, ger, tec.id);
  assert.equal(um(db, 'SELECT ativo FROM usuarios WHERE id = ?', tec.id).ativo, 0);

  assert.throws(() => usuarios.redefinirSenha(db, ger, admin.id, 'tentativa123'), (e) => e.status === 403);
  assert.throws(() => usuarios.alternarAtivo(db, ger, admin.id), (e) => e.status === 403);
  const lista = usuarios.listarUsuarios(db, ger);
  assert.equal(lista.find((x) => x.id === admin.id).gerenciavel, false);
  assert.equal(lista.find((x) => x.id === tec.id).gerenciavel, true);
  assert.ok(usuarios.listarUsuarios(db, admin).find((x) => x.id === ger.id).gerenciavel);
});

test('excluir usuário: apaga sem histórico, arquiva com histórico, bloqueia com OS em aberto', async () => {
  const os = await import('../src/domain/os.js');
  const db = abrirBanco(':memory:');
  popularPiloto(db);
  const sel = (papel) => um(db, 'SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = ?', papel);
  const ger = sel('gerente'); const admin = sel('admin'); const chefe = sel('manutencao_chefe'); const tec = sel('tecnico');

  // Sem histórico: removido de vez.
  const novo = usuarios.criarUsuario(db, ger, { nome: 'Temporário', login: 'temp', papel: 'tecnico', senha: 'senhaBoa123' });
  assert.equal(usuarios.excluirUsuario(db, ger, novo).modo, 'apagado');
  assert.equal(um(db, 'SELECT id FROM usuarios WHERE id = ?', novo), null);

  // Responsável por OS em aberto: bloqueado.
  const q = um(db, "SELECT id FROM quartos WHERE numero = '401'");
  const id = os.criar(db, ger, { quarto_id: q.id, local: 'quarto', categoria: 'eletrica', prioridade: 'media', descricao: 'Tomada sem energia' });
  os.executarAcao(db, chefe, id, 'receber', {});
  os.executarAcao(db, chefe, id, 'designar', { responsavel_id: tec.id });
  assert.throws(() => usuarios.excluirUsuario(db, ger, tec.id), /responsável por 1 demanda/);
  os.executarAcao(db, tec, id, 'comentar', { texto: 'Vou verificar amanhã.' });

  // Com histórico e sem OS em aberto: arquivado, nome mantido, nome de usuário liberado, sem login.
  os.executarAcao(db, chefe, id, 'designar', { responsavel_id: chefe.id });
  const loginTec = um(db, 'SELECT login FROM usuarios WHERE id = ?', tec.id).login;
  assert.equal(usuarios.excluirUsuario(db, ger, tec.id).modo, 'arquivado');
  assert.equal(um(db, 'SELECT nome FROM usuarios WHERE id = ?', tec.id).nome, tec.nome);
  assert.ok(!usuarios.listarUsuarios(db, ger).some((u) => u.id === tec.id));
  assert.throws(() => usuarios.login(db, loginTec, 'qualquer'), (e) => e.status === 401);
  assert.throws(() => usuarios.alternarAtivo(db, ger, tec.id), (e) => e.status === 404);
  assert.ok(usuarios.criarUsuario(db, ger, { nome: 'Substituto', login: loginTec, papel: 'tecnico', senha: 'senhaBoa123' }), 'nome de usuário liberado');

  // Gerente não exclui o acesso da rede; ninguém exclui a si mesmo.
  assert.throws(() => usuarios.excluirUsuario(db, ger, admin.id), (e) => e.status === 403);
  assert.throws(() => usuarios.excluirUsuario(db, admin, admin.id), /próprio/);
});

test('nome de usuário: validação, unicidade e migração de bancos antigos (remove o e-mail)', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const db = abrirBanco(':memory:');
  popularPiloto(db);
  const ger = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'gerente'");
  const novo = (login) => usuarios.criarUsuario(db, ger, { nome: 'Fulano', login, papel: 'tecnico', senha: 'senhaBoa123' });
  assert.throws(() => novo('jo'), /inválido/);
  assert.throws(() => novo('joão silva'), /inválido/);
  assert.throws(() => novo('Tecnico'), /já está em uso/);
  novo('Joao.Silva');
  assert.ok(um(db, "SELECT id FROM usuarios WHERE login = 'joao.silva'"));
  assert.ok(!('email' in usuarios.listarUsuarios(db, ger).find((u) => u.login === 'joao.silva')), 'sem e-mail');

  // Banco criado antes do login por usuário: a coluna é criada a partir do e-mail.
  const arq = join(mkdtempSync(join(tmpdir(), 'hq-mig-')), 'antigo.db');
  const antigo = new DatabaseSync(arq);
  antigo.exec(`CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE, senha_hash TEXT NOT NULL,
    papel TEXT NOT NULL, hotel_id INTEGER, ativo INTEGER NOT NULL DEFAULT 1);
    INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES ('A', 'admin@executiveosorio.com.br', '${usuarios.hashSenha('senhaAntiga1')}', 'admin'),
      ('B', 'admin@outro.com', 'x', 'tecnico');`);
  antigo.close();
  const migrado = abrirBanco(arq);
  assert.deepEqual(todos(migrado, 'SELECT login FROM usuarios ORDER BY id').map((u) => u.login), ['admin', 'admin2']);
  assert.ok(usuarios.login(migrado, 'admin', 'senhaAntiga1'), 'senha antiga continua valendo');
  assert.ok(!todos(migrado, 'PRAGMA table_info(usuarios)').some((c) => c.name === 'email'), 'coluna de e-mail removida');
  migrado.close();
});
