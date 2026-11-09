import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, um, todos, exec } from '../src/db.js';
import { popularPiloto } from '../src/seed.js';
import { importarRede } from '../src/rede.js';
import { somarDias } from '../src/domain/comum.js';
import * as usuarios from '../src/domain/usuarios.js';
import * as os from '../src/domain/os.js';
import * as fotos from '../src/domain/fotos.js';
import * as preventiva from '../src/domain/preventiva.js';
import * as estoque from '../src/domain/estoque.js';
import * as hospedes from '../src/domain/hospedes.js';
import * as backup from '../src/domain/backup.js';
import * as auditoria from '../src/domain/auditoria.js';
import * as relatorios from '../src/domain/relatorios.js';
import { analise } from '../src/domain/recorrencia.js';
import { orcamentoDoMes } from '../src/domain/indicadores.js';

const T0 = '2026-11-10T13:00:00.000Z';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function cenario() {
  const db = abrirBanco(':memory:');
  const cred = popularPiloto(db);
  importarRede(db);
  const sel = (login) => um(db, 'SELECT id, nome, login, papel, hotel_id, trocar_senha FROM usuarios WHERE login = ?', login);
  return { db, cred, sel };
}

test('senha provisória: obrigatória para quem recebeu senha de outra pessoa; some ao trocar', () => {
  const { db, cred, sel } = cenario();
  const ger = sel('gerencia');
  assert.equal(ger.trocar_senha, 1, 'usuários iniciais trocam no primeiro acesso');
  const senhaGer = cred.find((c) => c.login === 'gerencia').senha;
  assert.throws(() => usuarios.alterarSenha(db, ger, { atual: senhaGer, nova: senhaGer }), /diferente/);
  usuarios.alterarSenha(db, ger, { atual: senhaGer, nova: 'minhaSenhaNova1' });
  assert.equal(sel('gerencia').trocar_senha, 0);
  const novo = usuarios.criarUsuario(db, ger, { nome: 'Técnico', login: 'tec.novo', papel: 'tecnico', senha: 'provisoria1' });
  assert.equal(um(db, 'SELECT trocar_senha FROM usuarios WHERE id = ?', novo).trocar_senha, 1);
  exec(db, 'UPDATE usuarios SET trocar_senha = 0 WHERE id = ?', novo);
  usuarios.redefinirSenha(db, ger, novo, 'outraProvisoria1');
  assert.equal(um(db, 'SELECT trocar_senha FROM usuarios WHERE id = ?', novo).trocar_senha, 1, 'senha redefinida volta a ser provisória');
});

test('backup diário: um por dia, consistente, retenção e nomes protegidos', async () => {
  const { db, sel } = cenario();
  const dir = mkdtempSync(join(tmpdir(), 'hq-backup-'));
  const nome = await backup.backupDiario(db, dir, T0);
  assert.equal(nome, 'hotelaria-2026-11-10.db');
  assert.equal(await backup.backupDiario(db, dir, T0), null, 'não repete no mesmo dia');
  const copia = abrirBanco(join(dir, 'backups', nome));
  assert.equal(um(copia, 'SELECT COUNT(*) AS n FROM hoteis').n, 23, 'backup abre e tem os dados');
  copia.close();
  for (let i = 1; i <= 35; i++) writeFileSync(join(dir, 'backups', `hotelaria-2026-09-${String(i % 30 + 1).padStart(2, '0')}.db`), '');
  await backup.gerar(db, dir, { agora: '2026-11-11T13:00:00Z' });
  assert.ok(backup.listar(dir).filter((b) => !b.manual).length <= backup.RETENCAO);
  const admin = sel('admin');
  assert.throws(() => backup.caminhoParaDownload(admin, dir, '../hotelaria.db'), /inválido/);
  assert.throws(() => backup.caminhoParaDownload(sel('gerencia'), dir, nome), (e) => e.status === 403);
  assert.ok(existsSync(backup.caminhoParaDownload(admin, dir, nome)));
});

test('preventiva: datas distribuídas, gera só o que venceu e não acumula OS abertas', () => {
  const { db, sel } = cenario();
  const chefe = sel('manutencao');
  const planoId = preventiva.criarPlano(db, chefe, {
    nome: 'Limpeza do ar-condicionado', categoria: 'ar_condicionado', local: 'quarto', equipamento: 'Ar-condicionado',
    periodicidade_dias: 90, prioridade: 'baixa', inicio_em: T0,
  }, T0);
  const agenda = todos(db, 'SELECT * FROM preventiva_agenda WHERE plano_id = ? ORDER BY proxima_em', planoId);
  assert.equal(agenda.length, 105);
  assert.equal(agenda[0].proxima_em, T0);
  assert.equal(agenda.at(-1).proxima_em, somarDias(T0, 89), 'distribuídas ao longo dos 90 dias');

  const n1 = preventiva.gerar(db, T0);
  assert.equal(n1, 2, 'só os quartos com data de hoje');
  const geradas = todos(db, 'SELECT * FROM ordens_servico WHERE plano_preventiva_id = ?', planoId);
  assert.ok(geradas.every((o) => o.origem === 'preventiva' && o.equipamento_id && o.prioridade === 'baixa'));
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND mensagem LIKE 'Preventiva \"Limpeza do ar-condicionado\": 2 %'", chefe.id), 'um aviso resumido');

  // 90 dias depois, com a OS anterior ainda aberta: não gera outra para o mesmo quarto.
  const depois = somarDias(T0, 91);
  const quartoAberto = geradas[0].quarto_id;
  preventiva.gerar(db, depois);
  assert.equal(todos(db, 'SELECT * FROM ordens_servico WHERE plano_preventiva_id = ? AND quarto_id = ?', planoId, quartoAberto).length, 1);
  // Encerrada a OS, o próximo ciclo gera normalmente.
  exec(db, "UPDATE ordens_servico SET status = 'encerrada' WHERE id = ?", geradas[0].id);
  preventiva.gerar(db, somarDias(T0, 92));
  assert.equal(todos(db, 'SELECT * FROM ordens_servico WHERE plano_preventiva_id = ? AND quarto_id = ?', planoId, quartoAberto).length, 2);
  // Preventivas não contam como problema recorrente.
  assert.equal(analise(db, chefe, {}, somarDias(T0, 92)).alertas.length, 0);
  // Gerente de outro hotel não vê/altera o plano.
  assert.throws(() => preventiva.excluirPlano(db, sel('gerencia.canela'), planoId), (e) => e.status === 403);
});

test('estoque: custo médio, saída na OS lança custo, mínimo avisa uma vez', () => {
  const { db, sel } = cenario();
  const chefe = sel('manutencao'); const ger = sel('gerencia');
  const item = estoque.salvarItem(db, chefe, { nome: 'Lâmpada LED 9W', unidade: 'un', minimo: 5 });
  estoque.movimentar(db, chefe, item, { tipo: 'entrada', quantidade: 10, custo_unitario: 10 }, T0);
  estoque.movimentar(db, chefe, item, { tipo: 'entrada', quantidade: 10, custo_unitario: 14 }, T0);
  assert.equal(um(db, 'SELECT custo_unitario FROM estoque_itens WHERE id = ?', item).custo_unitario, 12);
  const q = um(db, "SELECT id FROM quartos WHERE numero = '501'");
  const id = os.criar(db, ger, { quarto_id: q.id, local: 'quarto', categoria: 'iluminacao', prioridade: 'media', descricao: 'Lâmpada queimada no abajur' }, T0);
  os.executarAcao(db, chefe, id, 'baixar_estoque', { item_id: item, quantidade: 3 }, T0);
  assert.equal(um(db, 'SELECT valor FROM os_custos WHERE os_id = ?', id).valor, 36);
  assert.throws(() => os.executarAcao(db, chefe, id, 'baixar_estoque', { item_id: item, quantidade: 50 }, T0), /insuficiente/);
  os.executarAcao(db, chefe, id, 'baixar_estoque', { item_id: item, quantidade: 12 }, T0);
  os.executarAcao(db, chefe, id, 'baixar_estoque', { item_id: item, quantidade: 1 }, T0);
  assert.equal(todos(db, "SELECT * FROM notificacoes WHERE usuario_id = ? AND mensagem LIKE 'Estoque baixo%'", chefe.id).length, 1);
  assert.throws(() => estoque.movimentar(db, sel('gerencia.canela'), item, { tipo: 'saida', quantidade: 1 }), (e) => e.status === 403);
});

test('alçada: gerente aprova orçamento até o limite do hotel; acima, só o aprovador', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const chefe = sel('manutencao'); const admin = sel('admin');
  usuarios.atualizarHotel(db, admin, ger.hotel_id, { limite_aprovacao_gerente: 500, orcamento_mensal: 10000 });
  const q = um(db, "SELECT id FROM quartos WHERE numero = '601'");
  const abrir = () => os.criar(db, ger, { quarto_id: q.id, local: 'quarto', categoria: 'mobiliario', prioridade: 'media', descricao: 'Cadeira da bancada quebrada' }, T0);
  const pequena = abrir();
  os.executarAcao(db, chefe, pequena, 'receber', {}, T0);
  os.executarAcao(db, chefe, pequena, 'enviar_aprovacao', { valor: 400, descricao: 'Cadeira nova' }, T0);
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND tipo = 'orcamento'", ger.id), 'gerente é avisado');
  os.executarAcao(db, ger, pequena, 'autorizar', {}, T0);
  assert.equal(os.buscar(db, pequena).status, 'aprovada');
  const grande = abrir();
  os.executarAcao(db, chefe, grande, 'receber', {}, T0);
  os.executarAcao(db, chefe, grande, 'enviar_aprovacao', { valor: 600, descricao: 'Conjunto completo' }, T0);
  assert.throws(() => os.executarAcao(db, ger, grande, 'autorizar', {}, T0), (e) => e.status === 403);
  os.executarAcao(db, chefe, pequena, 'registrar_custo', { tipo: 'material', descricao: 'Cadeira', valor: 400 }, T0);
  assert.deepEqual(orcamentoDoMes(db, [ger.hotel_id], T0), { custo: 400, previsto: 10000 });
});

test('avaliação de hóspede: gera OS de origem hóspede e aparece no cruzamento', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia');
  const q = um(db, "SELECT id FROM quartos WHERE numero = '702'");
  const r = hospedes.registrar(db, ger, q.id, { nota: 2, origem: 'booking', categoria: 'ar_condicionado', comentario: 'Ar-condicionado barulhento a noite toda', gerar_os: true }, T0);
  const o = os.buscar(db, r.os_id);
  assert.equal(o.origem, 'hospede');
  assert.equal(o.prioridade, 'alta');
  hospedes.registrar(db, ger, q.id, { nota: 3, origem: 'google', comentario: 'Quarto ok' }, T0);
  assert.equal(hospedes.doQuarto(db, q.id).media, 2.5);
  const criticos = hospedes.quartosCriticos(db, ger, {}, T0);
  assert.equal(criticos[0].numero, '702');
  assert.equal(criticos[0].manutencoes, 1);
  assert.throws(() => hospedes.registrar(db, sel('gerencia.canela'), q.id, { nota: 1, origem: 'booking' }), (e) => e.status === 403);
});

test('auditoria: gerente vê o próprio hotel; relatório CSV no padrão do Excel brasileiro', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const admin = sel('admin');
  auditoria.registrar(db, ger, 'quarto_bloqueado', { hotel_id: ger.hotel_id, alvo: '401' });
  auditoria.registrar(db, sel('gerencia.canela'), 'quarto_bloqueado', { hotel_id: sel('gerencia.canela').hotel_id, alvo: '10' });
  assert.equal(auditoria.listar(db, ger).length, 1);
  assert.equal(auditoria.listar(db, admin).length, 2);
  assert.throws(() => auditoria.listar(db, sel('manutencao')), (e) => e.status === 403);
  const { nome, conteudo } = relatorios.exportar(db, ger, 'quartos', {});
  assert.match(nome, /^quartos-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(conteudo.charCodeAt(0), 0xFEFF, 'BOM para o Excel reconhecer UTF-8');
  const linhas = conteudo.trim().split('\r\n');
  assert.equal(linhas.length, 106, 'cabeçalho + 105 quartos (somente do hotel do gerente)');
  assert.match(linhas[0], /^Hotel;Quarto;Andar;/);
});

test('etiqueta QR e fotos continuam isoladas por hotel (regressão)', () => {
  const { db, sel } = cenario();
  const q = um(db, "SELECT id FROM quartos WHERE numero = '401'");
  const ctx = { uploadsDir: mkdtempSync(join(tmpdir(), 'hq-f-')) };
  assert.throws(() => fotos.salvarPadrao(db, sel('gerencia.canela'), q.id, { fotos: [{ arquivo: PNG }] }, ctx), (e) => e.status === 403);
  assert.equal(readdirSync(ctx.uploadsDir).length, 0);
});
