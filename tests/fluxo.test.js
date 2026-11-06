import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, um, todos, exec } from '../src/db.js';
import { hashSenha } from '../src/domain/usuarios.js';
import { somarDias, somarHoras } from '../src/domain/comum.js';
import * as quartos from '../src/domain/quartos.js';
import * as os from '../src/domain/os.js';
import * as fotos from '../src/domain/fotos.js';
import * as inspecoes from '../src/domain/inspecoes.js';
import { analise } from '../src/domain/recorrencia.js';
import { indicadores, rede } from '../src/domain/indicadores.js';
import { verificar } from '../src/domain/agendador.js';

const ctx = { uploadsDir: mkdtempSync(join(tmpdir(), 'hq-uploads-')) };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const T0 = '2026-01-10T12:00:00.000Z';

let db; let u; let quarto; let quartoB;

function usuario(nome, papel, hotelId) {
  const id = Number(exec(db, 'INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id) VALUES (?, ?, ?, ?, ?)',
    nome, nome.toLowerCase().replace(/\s/g, ''), 'x', papel, hotelId).lastInsertRowid);
  return um(db, 'SELECT id, nome, papel, hotel_id FROM usuarios WHERE id = ?', id);
}

beforeEach(() => {
  db = abrirBanco(':memory:');
  const h1 = Number(exec(db, "INSERT INTO hoteis (nome) VALUES ('H1')").lastInsertRowid);
  const h2 = Number(exec(db, "INSERT INTO hoteis (nome) VALUES ('H2')").lastInsertRowid);
  u = {
    admin: usuario('Admin', 'admin', null),
    diretoria: usuario('Dir', 'diretoria', null),
    fin: usuario('Fin', 'aprovador_financeiro', null),
    gerente: usuario('Gerente', 'gerente', h1),
    gov: usuario('Gov', 'governanta', h1),
    chefe: usuario('Chefe', 'manutencao_chefe', h1),
    tec: usuario('Tec', 'tecnico', h1),
    gerente2: usuario('Gerente2', 'gerente', h2),
    tec2: usuario('Tec2', 'tecnico', h2),
  };
  quarto = quartos.criar(db, u.admin, { hotel_id: h1, numero: '203' }, T0);
  quartoB = quartos.criar(db, u.admin, { hotel_id: h2, numero: '101' }, T0);
});

const abrir = (extra = {}, t = T0) => os.criar(db, u.gerente, {
  quarto_id: quarto, local: 'quarto', categoria: 'ar_condicionado', prioridade: 'alta',
  descricao: 'Ar-condicionado não gela.', equipamento_id: um(db, "SELECT id FROM equipamentos WHERE quarto_id = ? AND tipo = 'Ar-condicionado'", quarto).id, ...extra,
}, t);

function cicloCompleto(id, t) {
  os.executarAcao(db, u.chefe, id, 'receber', {}, somarHoras(t, 1));
  os.executarAcao(db, u.chefe, id, 'aceitar', { responsavel_id: u.tec.id }, somarHoras(t, 2));
  os.executarAcao(db, u.tec, id, 'iniciar', {}, somarHoras(t, 3));
  os.executarAcao(db, u.tec, id, 'registrar_custo', { tipo: 'material', descricao: 'Gás', valor: 200 }, somarHoras(t, 4));
  fotos.salvar(db, u.tec, { os_id: id, fase: 'depois', arquivo: PNG }, ctx, somarHoras(t, 5));
  os.executarAcao(db, u.tec, id, 'concluir', { texto: 'Recarga feita.' }, somarHoras(t, 5));
  os.executarAcao(db, u.gerente, id, 'validar', { liberar_quarto: true }, somarHoras(t, 6));
}

test('abertura gera protocolo único, prazo pela prioridade e notifica a manutenção', () => {
  const a = os.buscar(db, abrir());
  const b = os.buscar(db, abrir());
  assert.equal(a.protocolo, 'OS-2026-00001');
  assert.equal(b.protocolo, 'OS-2026-00002');
  assert.equal(a.status, 'nova');
  assert.equal(a.prazo_previsto, somarHoras(T0, 24));
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND tipo = 'nova_demanda'", u.chefe.id));
});

test('fluxo completo registra quem abriu, recebeu, executou e validou e atualiza o histórico do quarto', () => {
  const id = abrir({ bloqueio_quarto: true });
  assert.equal(quartos.detalhe(db, u.gerente, quarto).status_comercial, 'bloqueado');
  cicloCompleto(id, T0);
  const o = os.buscar(db, id);
  assert.equal(o.status, 'encerrada');
  assert.deepEqual([o.aberto_por, o.recebido_por, o.executado_por, o.validado_por], [u.gerente.id, u.chefe.id, u.tec.id, u.gerente.id]);
  const q = quartos.detalhe(db, u.gerente, quarto);
  assert.equal(q.status_comercial, 'liberado');
  assert.ok(q.historico.some((h) => h.tipo === 'manutencao' && h.os_id === id));
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND tipo = 'concluida'", u.gerente.id));
});

test('conclusão exige evidência fotográfica', () => {
  const id = abrir();
  os.executarAcao(db, u.chefe, id, 'receber', {}, T0);
  os.executarAcao(db, u.chefe, id, 'aceitar', { responsavel_id: u.tec.id }, T0);
  os.executarAcao(db, u.tec, id, 'iniciar', {}, T0);
  assert.throws(() => os.executarAcao(db, u.tec, id, 'concluir', { texto: 'ok' }, T0), /fotografia/);
});

test('permissões: técnico não aceita, gerente de outro hotel não acessa, ações fora do status são negadas', () => {
  const id = abrir();
  assert.throws(() => os.executarAcao(db, u.tec, id, 'aceitar', {}, T0), (e) => e.status === 403);
  assert.throws(() => os.detalhe(db, u.gerente2, id), (e) => e.status === 403);
  assert.throws(() => os.executarAcao(db, u.gerente, id, 'validar', {}, T0), (e) => e.status === 403);
  assert.equal(os.listar(db, u.gerente2, {}).length, 0);
  assert.equal(os.listar(db, u.diretoria, {}).length, 1);
});

test('reavaliação de prioridade exige justificativa e fica no histórico', () => {
  const id = abrir();
  assert.throws(() => os.executarAcao(db, u.chefe, id, 'reavaliar_prioridade', { prioridade: 'baixa' }, T0), /justificativa/);
  os.executarAcao(db, u.chefe, id, 'reavaliar_prioridade', { prioridade: 'baixa', texto: 'Quarto tem outro aparelho' }, T0);
  const o = os.detalhe(db, u.gerente, id);
  assert.equal(o.prioridade, 'baixa');
  assert.equal(o.prioridade_original, 'alta');
  assert.ok(o.eventos.some((e) => e.tipo === 'prioridade' && e.texto.includes('Quarto tem outro aparelho')));
});

test('aprovação financeira bloqueia execução normal, mas não a emergencial', () => {
  const id = abrir();
  os.executarAcao(db, u.chefe, id, 'receber', {}, T0);
  os.executarAcao(db, u.chefe, id, 'enviar_aprovacao', { valor: 3000, descricao: 'Troca do aparelho' }, T0);
  assert.equal(os.buscar(db, id).status, 'aguardando_autorizacao');
  assert.throws(() => os.executarAcao(db, u.tec, id, 'iniciar', {}, T0), (e) => e.status === 403);
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND tipo = 'orcamento'", u.fin.id));
  os.executarAcao(db, u.fin, id, 'autorizar', {}, T0);
  assert.equal(os.buscar(db, id).status, 'aprovada');

  const em = abrir({ prioridade: 'emergencial', categoria: 'hidraulica', equipamento_id: null, local: 'banheiro', descricao: 'Vazamento forte no banheiro.' });
  os.executarAcao(db, u.tec, em, 'iniciar', {}, T0);
  const o = os.buscar(db, em);
  assert.equal(o.status, 'em_execucao');
  assert.equal(o.responsavel_id, u.tec.id);
  assert.equal(o.prazo_previsto, somarHoras(T0, 4));
});

test('validação: correção e reabertura', () => {
  const id = abrir();
  cicloCompleto(id, T0);
  os.executarAcao(db, u.gerente, id, 'reabrir', { texto: 'Voltou a pingar' }, somarDias(T0, 2));
  let o = os.buscar(db, id);
  assert.equal(o.status, 'em_avaliacao');
  assert.equal(o.reaberturas, 1);
  os.executarAcao(db, u.chefe, id, 'aceitar', {}, somarDias(T0, 2));
  os.executarAcao(db, u.tec, id, 'iniciar', {}, somarDias(T0, 2));
  os.executarAcao(db, u.tec, id, 'concluir', { texto: 'Dreno trocado' }, somarDias(T0, 3));
  os.executarAcao(db, u.gerente, id, 'solicitar_correcao', { texto: 'Acabamento ruim' }, somarDias(T0, 3));
  o = os.buscar(db, id);
  assert.equal(o.status, 'em_correcao');
  assert.equal(o.correcoes, 1);
});

test('hotel sem exigência de validação encerra direto na conclusão', () => {
  exec(db, 'UPDATE hoteis SET exige_validacao = 0');
  const id = abrir();
  os.executarAcao(db, u.chefe, id, 'receber', {}, T0);
  os.executarAcao(db, u.chefe, id, 'aceitar', { responsavel_id: u.tec.id }, T0);
  os.executarAcao(db, u.tec, id, 'iniciar', {}, T0);
  fotos.salvar(db, u.tec, { os_id: id, fase: 'depois', arquivo: PNG }, ctx, T0);
  os.executarAcao(db, u.tec, id, 'concluir', { texto: 'ok' }, T0);
  assert.equal(os.buscar(db, id).status, 'encerrada');
});

test('recorrência: 3 ocorrências no mesmo equipamento geram alerta crítico com recomendação de substituição', () => {
  const datas = ['2026-01-10T12:00:00Z', '2026-03-12T12:00:00Z', '2026-05-15T12:00:00Z'];
  let ultimo;
  for (const t of datas) { ultimo = abrir({}, t); cicloCompleto(ultimo, t); }
  assert.equal(os.buscar(db, ultimo).recorrente, 1);
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE tipo = 'recorrencia' AND usuario_id = ?", u.diretoria.id));
  const r = analise(db, u.diretoria, {}, '2026-06-01T00:00:00Z');
  assert.equal(r.alertas.length, 1);
  assert.equal(r.alertas[0].nivel, 'critico');
  assert.equal(r.alertas[0].ocorrencias, 3);
  assert.match(r.alertas[0].recomendacao, /substituição/);
  assert.equal(r.equipamentos[0].tipo, 'Ar-condicionado');
});

test('recorrência considera histórico: retorno logo após a intervenção pesa mais que chamados espaçados', () => {
  const a = abrir({}, '2026-01-10T12:00:00Z');
  cicloCompleto(a, '2026-01-10T12:00:00Z');
  abrir({}, '2026-01-25T12:00:00Z');
  const r = analise(db, u.admin, {}, '2026-02-01T00:00:00Z');
  assert.equal(r.alertas[0].retornos, 1);
  assert.equal(r.retornos.length, 1);
  assert.equal(r.repeticoes.length, 1);
});

test('inspeção: item reprovado vira OS com fotos reaproveitadas e sem duplicar OS aberta', () => {
  const ins = inspecoes.criar(db, u.gov, { quarto_id: quarto }, T0);
  const itens = todos(db, 'SELECT * FROM inspecao_itens WHERE inspecao_id = ?', ins);
  const chuveiro = itens.find((i) => i.item === 'Funcionamento do chuveiro');
  const ac1 = itens.find((i) => i.item === 'Funcionamento do ar-condicionado');
  const ac2 = itens.find((i) => i.item === 'Ar-condicionado');
  for (const it of itens) inspecoes.responder(db, u.gov, it.id, { resposta: 'conforme' });
  inspecoes.responder(db, u.gov, chuveiro.id, { resposta: 'manutencao', observacao: 'Não liga' });
  inspecoes.responder(db, u.gov, ac1.id, { resposta: 'manutencao' });
  inspecoes.responder(db, u.gov, ac2.id, { resposta: 'atencao' });
  fotos.salvar(db, u.gov, { inspecao_item_id: chuveiro.id, fase: 'inspecao', arquivo: PNG }, ctx, T0);

  const r1 = inspecoes.gerarOS(db, u.gov, chuveiro.id, {}, T0);
  const o = os.detalhe(db, u.gov, r1.os_id);
  assert.equal(o.origem, 'inspecao');
  assert.equal(o.categoria, 'hidraulica');
  assert.equal(o.fotos.length, 1);
  assert.equal(o.fotos[0].fase, 'antes');
  assert.throws(() => inspecoes.gerarOS(db, u.gov, chuveiro.id, {}, T0), /já está vinculado/);

  const a = inspecoes.gerarOS(db, u.gov, ac1.id, {}, T0);
  const b = inspecoes.gerarOS(db, u.gov, ac2.id, {}, T0);
  assert.equal(a.vinculada, false);
  assert.equal(b.vinculada, true);
  assert.equal(b.os_id, a.os_id);

  const res = inspecoes.concluir(db, u.gov, ins, {}, T0);
  assert.ok(res.estrelas >= 1 && res.estrelas <= 5);
  const q = quartos.detalhe(db, u.gov, quarto, T0);
  assert.equal(q.estrelas, res.estrelas);
  assert.equal(q.proxima_inspecao_em, somarDias(T0, 30));
});

test('problema crônico a partir de item de inspeção', () => {
  const ins = inspecoes.criar(db, u.gov, { quarto_id: quarto }, T0);
  const it = um(db, "SELECT * FROM inspecao_itens WHERE inspecao_id = ? AND item = 'Vedação e rejuntes'", ins);
  inspecoes.responder(db, u.gov, it.id, { resposta: 'atencao', observacao: 'Desgaste' });
  inspecoes.registrarCronico(db, u.gov, { inspecao_item_id: it.id }, T0);
  const q = quartos.detalhe(db, u.gov, quarto);
  assert.equal(q.cronicos.length, 1);
  assert.equal(q.cronicos[0].origem, 'inspecao');
});

test('agendador: alerta de prazo próximo, atraso e inspeção vencida apenas uma vez', () => {
  const id = abrir();
  os.executarAcao(db, u.chefe, id, 'receber', {}, T0);
  verificar(db, somarHoras(T0, 20));
  verificar(db, somarHoras(T0, 21));
  assert.equal(um(db, "SELECT COUNT(*) AS n FROM notificacoes WHERE tipo = 'prazo_proximo' AND usuario_id = ?", u.chefe.id).n, 1);
  verificar(db, somarHoras(T0, 30));
  verificar(db, somarHoras(T0, 31));
  assert.equal(um(db, "SELECT COUNT(*) AS n FROM notificacoes WHERE tipo = 'atrasada' AND usuario_id = ?", u.gerente.id).n, 1);
  assert.equal(os.listar(db, u.chefe, { grupo: 'atrasadas' }, somarHoras(T0, 31)).length, 1);
  // Quarto novo tem 7 dias para a primeira inspeção.
  assert.ok(!um(db, "SELECT 1 AS x FROM notificacoes WHERE tipo = 'inspecao_vencida' AND usuario_id = ?", u.gov.id));
  verificar(db, somarDias(T0, 8));
  verificar(db, somarDias(T0, 9));
  assert.equal(um(db, "SELECT COUNT(*) AS n FROM notificacoes WHERE tipo = 'inspecao_vencida' AND usuario_id = ?", u.gov.id).n, 1);
});

test('liberação do quarto só por gerente/diretoria/admin', () => {
  quartos.bloquear(db, u.chefe, quarto, { motivo: 'Obra' }, T0);
  assert.throws(() => quartos.liberar(db, u.chefe, quarto, {}, T0), (e) => e.status === 403);
  quartos.liberar(db, u.gerente, quarto, {}, T0);
  assert.equal(quartos.detalhe(db, u.gerente, quarto).status_comercial, 'liberado');
});

test('indicadores e visão de rede consolidam todas as unidades', () => {
  const id = abrir();
  cicloCompleto(id, T0);
  os.criar(db, u.gerente2, { quarto_id: quartoB, local: 'quarto', categoria: 'pintura', prioridade: 'baixa', descricao: 'Parede manchada perto da janela' }, T0);
  const ind = indicadores(db, u.diretoria, { de: '2026-01-01', ate: '2026-02-01' }, '2026-02-01T00:00:00Z');
  assert.equal(ind.geral.total, 2);
  assert.equal(ind.geral.concluidas, 1);
  assert.equal(ind.geral.taxa_no_prazo, 100);
  assert.equal(ind.geral.custo_medio, 200);
  assert.equal(ind.porHotel.length, 2);
  const indGerente = indicadores(db, u.gerente, { de: '2026-01-01', ate: '2026-02-01' }, '2026-02-01T00:00:00Z');
  assert.equal(indGerente.geral.total, 1);
  const r = rede(db, u.diretoria, { de: '2026-01-01', ate: '2026-02-01' }, '2026-02-01T00:00:00Z');
  assert.equal(r.unidades.length, 2);
  assert.ok(ind.gargalos.length > 0);
});
