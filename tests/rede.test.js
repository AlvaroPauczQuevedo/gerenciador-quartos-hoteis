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
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM quartos WHERE hotel_id = ?', santaMaria.id).n, 98, 'Smart Santa Maria: total do HITS');
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

test('checklist é individual: excluir/desativar/incluir em um hotel não afeta os outros', async () => {
  const inspecoes = await import('../src/domain/inspecoes.js');
  const { db } = base();
  const sel = (login) => um(db, 'SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = ?', login);
  const canela = sel('gerencia.canela');
  const chapeco = sel('gerencia.chapeco');
  const itensDe = (hotelId) => todos(db, 'SELECT item, ativo FROM checklist_modelo WHERE hotel_id = ? ORDER BY ordem', hotelId);
  const antesChapeco = itensDe(chapeco.hotel_id);
  const antesOsorio = itensDe(um(db, "SELECT id FROM hoteis WHERE logo = 'executive-osorio'").id);

  // Gerente de Canela exclui, desativa e inclui itens no próprio hotel.
  const tv = um(db, "SELECT id FROM checklist_modelo WHERE hotel_id = ? AND item = 'TV funcionando'", canela.hotel_id);
  const cama = um(db, "SELECT id FROM checklist_modelo WHERE hotel_id = ? AND item = 'Cama'", canela.hotel_id);
  inspecoes.excluirItemChecklist(db, canela, tv.id);
  inspecoes.alternarItemChecklist(db, canela, cama.id);
  inspecoes.adicionarItemChecklist(db, canela, { item: 'Lareira', ambiente: 'Básico para funcionamento e venda', categoria: 'outros', critico: true });
  assert.equal(itensDe(canela.hotel_id).length, 31);
  assert.ok(!itensDe(canela.hotel_id).some((i) => i.item === 'TV funcionando'));

  // Os outros hotéis continuam exatamente iguais.
  assert.deepEqual(itensDe(chapeco.hotel_id), antesChapeco);
  assert.deepEqual(itensDe(um(db, "SELECT id FROM hoteis WHERE logo = 'executive-osorio'").id), antesOsorio);

  // Gerente não mexe no checklist de outro hotel, nem incluindo com hotel_id alheio.
  const itemChapeco = um(db, 'SELECT id FROM checklist_modelo WHERE hotel_id = ? LIMIT 1', chapeco.hotel_id);
  assert.throws(() => inspecoes.excluirItemChecklist(db, canela, itemChapeco.id), (e) => e.status === 403);
  assert.throws(() => inspecoes.alternarItemChecklist(db, canela, itemChapeco.id), (e) => e.status === 403);
  assert.throws(() => inspecoes.adicionarItemChecklist(db, canela, { hotel_id: chapeco.hotel_id, item: 'X', ambiente: 'Y', categoria: 'outros' }), (e) => e.status === 403);
  assert.deepEqual(itensDe(chapeco.hotel_id), antesChapeco);

  // Nova inspeção em Canela usa a lista de Canela; em Chapecó, a de Chapecó.
  const quartoCanela = um(db, 'SELECT id FROM quartos WHERE hotel_id = ? LIMIT 1', canela.hotel_id);
  const quartoChapeco = um(db, 'SELECT id FROM quartos WHERE hotel_id = ? LIMIT 1', chapeco.hotel_id);
  const nomes = (insId) => todos(db, 'SELECT item FROM inspecao_itens WHERE inspecao_id = ?', insId).map((i) => i.item);
  const insCanela = nomes(inspecoes.criar(db, canela, { quarto_id: quartoCanela.id }));
  const insChapeco = nomes(inspecoes.criar(db, chapeco, { quarto_id: quartoChapeco.id }));
  assert.ok(insCanela.includes('Lareira') && !insCanela.includes('TV funcionando') && !insCanela.includes('Cama'));
  assert.ok(insChapeco.includes('TV funcionando') && insChapeco.includes('Cama') && !insChapeco.includes('Lareira'));
});

test('checklist esvaziado não volta para o padrão do sistema', async () => {
  const inspecoes = await import('../src/domain/inspecoes.js');
  const { db } = base();
  const g = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = 'gerencia.xanxere'");
  for (const it of todos(db, 'SELECT id FROM checklist_modelo WHERE hotel_id = ?', g.hotel_id)) inspecoes.excluirItemChecklist(db, g, it.id);
  assert.deepEqual(inspecoes.checklistDoHotel(db, g.hotel_id, { incluirInativos: true }), { personalizado: true, itens: [] });
  const quarto = um(db, 'SELECT id FROM quartos WHERE hotel_id = ? LIMIT 1', g.hotel_id);
  assert.throws(() => inspecoes.criar(db, g, { quarto_id: quarto.id }), /checklist de inspeção deste hotel está vazio/);
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM inspecoes WHERE quarto_id = ?', quarto.id).n, 0, 'nenhuma inspeção vazia criada');
});
