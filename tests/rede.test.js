import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { abrirBanco, todos, um } from '../src/db.js';
import { popularPiloto } from '../src/seed.js';
import { importarRede, HOTEIS_REDE, loginGerencia } from '../src/rede.js';
import * as usuarios from '../src/domain/usuarios.js';
import * as quartos from '../src/domain/quartos.js';
import { verificar } from '../src/domain/agendador.js';
import { somarDias } from '../src/domain/comum.js';

function base() {
  const db = abrirBanco(':memory:');
  popularPiloto(db);
  return { db, criados: importarRede(db) };
}

test('importa os 22 hotéis novos, mantém Osório e é idempotente', () => {
  const { db, criados } = base();
  assert.equal(criados.length, 22);
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM hoteis').n, 23);
  const osorio = um(db, "SELECT * FROM hoteis WHERE logo = 'executive-osorio'");
  assert.equal(osorio.nome, 'Tri Hotel Executive Osório');
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM quartos WHERE hotel_id = ?', osorio.id).n, 105, 'Osório intacto');
  assert.equal(importarRede(db).length, 0, 'segunda execução não duplica');

  for (const h of HOTEIS_REDE.filter((x) => !x.existente)) {
    const hotel = um(db, 'SELECT * FROM hoteis WHERE logo = ?', h.logo);
    assert.ok(hotel, h.nome);
    assert.equal(um(db, 'SELECT COUNT(*) AS n FROM quartos WHERE hotel_id = ?', hotel.id).n, h.quartos || 0, h.nome);
    assert.equal(um(db, 'SELECT COUNT(*) AS n FROM checklist_modelo WHERE hotel_id = ?', hotel.id).n, 31, `${h.nome}: checklist`);
    const equipe = todos(db, 'SELECT login, papel FROM usuarios WHERE hotel_id = ?', hotel.id);
    assert.deepEqual(equipe, [{ login: loginGerencia(h), papel: 'gerente' }], `${h.nome}: só a gerência`);
  }
  const santaMaria = um(db, "SELECT id FROM hoteis WHERE logo = 'smart-santa-maria'");
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM quartos WHERE hotel_id = ?', santaMaria.id).n, 0);
});

test('logins da gerência válidos e logos presentes para todos os hotéis', () => {
  const { db, criados } = base();
  for (const c of criados) {
    assert.ok(c.login.length <= 30, c.login);
    assert.ok(usuarios.login(db, c.login, c.senha));
  }
  for (const h of HOTEIS_REDE) {
    for (const arq of ['horizontal.svg', 'horizontal-branco.svg']) assert.ok(existsSync(`public/img/hoteis/${h.logo}/${arq}`), `${h.logo}/${arq}`);
  }
  assert.ok(existsSync('public/img/rede/horizontal.svg') && existsSync('public/img/rede/horizontal-branco.svg'));
});

test('gerente de uma unidade não vê as outras; admin vê a rede inteira', () => {
  const { db } = base();
  const g = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = 'gerencia.canela'");
  const admin = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = 'admin'");
  assert.equal(usuarios.listarHoteis(db, g).length, 1);
  assert.equal(quartos.listar(db, g).length, 174);
  assert.equal(usuarios.listarHoteis(db, admin).length, 23);
  const osorio = um(db, "SELECT id FROM quartos WHERE numero = '401'");
  assert.throws(() => quartos.detalhe(db, g, osorio.id), (e) => e.status === 403);
});

test('numeração real substitui os quartos provisórios', () => {
  const { db } = base();
  const g = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = 'gerencia.centro-chapeco'");
  assert.equal(todos(db, 'SELECT * FROM quartos WHERE hotel_id = ? AND numeracao_provisoria = 1', g.hotel_id).length, 48);
  const r = quartos.definirNumeracao(db, g, { faixas: [{ andar: '1', inicio: 101, fim: 124 }, { andar: '2', inicio: 201, fim: 224 }] });
  assert.deepEqual([r.removidos, r.criados], [48, 48]);
  const lista = quartos.listar(db, g);
  assert.equal(lista.length, 48);
  assert.ok(lista.every((q) => !q.numeracao_provisoria));
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM equipamentos e JOIN quartos q ON q.id = e.quarto_id WHERE q.hotel_id = ?', g.hotel_id).n, 48 * 10);

  const q = lista.find((x) => x.numero === '224');
  quartos.editar(db, g, q.id, { numero: '225', andar: '2', tipo: 'Suíte' });
  assert.throws(() => quartos.editar(db, g, q.id, { numero: '201' }), /Já existe/);
  quartos.excluir(db, g, q.id);
  assert.equal(quartos.listar(db, g).length, 47);
});

test('inspeção vencida gera um aviso por hotel, não um por quarto', () => {
  const { db } = base();
  verificar(db, somarDias(new Date().toISOString(), 8));
  const g = um(db, "SELECT id FROM usuarios WHERE login = 'gerencia.chapeco'");
  const avisos = todos(db, "SELECT mensagem FROM notificacoes WHERE usuario_id = ? AND tipo = 'inspecao_vencida'", g.id);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].mensagem, /^172 quartos/);
});
