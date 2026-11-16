import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, um, todos, exec } from '../src/db.js';
import { popularPiloto, popular } from '../src/seed.js';
import { importarRede } from '../src/rede.js';
import { somarDias, somarHoras } from '../src/domain/comum.js';
import * as usuarios from '../src/domain/usuarios.js';
import * as os from '../src/domain/os.js';
import * as fotos from '../src/domain/fotos.js';
import * as preventiva from '../src/domain/preventiva.js';
import * as estoque from '../src/domain/estoque.js';
import * as hospedes from '../src/domain/hospedes.js';
import * as backup from '../src/domain/backup.js';
import { verificar } from '../src/domain/agendador.js';
import { indicadores } from '../src/domain/indicadores.js';
import * as relatos from '../src/domain/relatos.js';
import * as obrigacoes from '../src/domain/obrigacoes.js';
import * as seguranca from '../src/domain/seguranca.js';
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
  const chefe = sel('gerencia');
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
  const ger = sel('gerencia'); const chefe = ger;
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

test('alçada: gerente aprova orçamento até o limite do hotel; acima, só diretoria/administração', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const chefe = ger; const admin = sel('admin');
  usuarios.atualizarHotel(db, admin, ger.hotel_id, { limite_aprovacao_gerente: 500, orcamento_mensal: 10000 });
  const q = um(db, "SELECT id FROM quartos WHERE numero = '601'");
  const abrir = () => os.criar(db, ger, { quarto_id: q.id, local: 'quarto', categoria: 'mobiliario', prioridade: 'media', descricao: 'Cadeira da bancada quebrada' }, T0);
  const pequena = abrir();
  os.executarAcao(db, chefe, pequena, 'receber', {}, T0);
  os.executarAcao(db, chefe, pequena, 'enviar_aprovacao', { valor: 400, descricao: 'Cadeira nova' }, T0);
  os.executarAcao(db, ger, pequena, 'autorizar', {}, T0);
  assert.equal(os.buscar(db, pequena).status, 'aprovada');
  const grande = abrir();
  os.executarAcao(db, chefe, grande, 'receber', {}, T0);
  os.executarAcao(db, chefe, grande, 'enviar_aprovacao', { valor: 600, descricao: 'Conjunto completo' }, T0);
  assert.throws(() => os.executarAcao(db, ger, grande, 'autorizar', {}, T0), (e) => e.status === 403);
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND tipo = 'orcamento' AND os_id = ?", admin.id, grande), 'administração é avisada');
  os.executarAcao(db, admin, grande, 'autorizar', {}, T0);
  assert.equal(os.buscar(db, grande).status, 'aprovada');
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
  assert.throws(() => auditoria.listar(db, sel('tecnico')), (e) => e.status === 403);
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

test('perfil "Aprovador financeiro" foi removido: contas antigas perdem o acesso na inicialização', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fin-'));
  const arquivo = join(dir, 'banco.db');
  const db = abrirBanco(arquivo);
  popularPiloto(db);
  exec(db, "INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id) VALUES ('Financeiro', 'financeiro', 'x', 'aprovador_financeiro', NULL)");
  db.close();
  const db2 = abrirBanco(arquivo);
  const u = um(db2, "SELECT ativo, excluido_em, login FROM usuarios WHERE nome = 'Financeiro'");
  assert.equal(u.ativo, 0);
  assert.ok(u.excluido_em);
  assert.notEqual(u.login, 'financeiro', 'login liberado');
  assert.equal(usuarios.listarUsuarios(db2, um(db2, "SELECT * FROM usuarios WHERE login = 'admin'")).some((x) => x.nome === 'Financeiro'), false);
  db2.close();
});

test('sem chefe de manutenção: gerente aceita direto e distribui; contas antigas viram técnico', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chefe-'));
  const arquivo = join(dir, 'banco.db');
  const db0 = abrirBanco(arquivo);
  popularPiloto(db0);
  exec(db0, "INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id) VALUES ('Chefe Antigo', 'chefe.antigo', 'x', 'manutencao_chefe', 1)");
  db0.close();
  const db = abrirBanco(arquivo);
  assert.equal(um(db, "SELECT papel FROM usuarios WHERE login = 'chefe.antigo'").papel, 'tecnico');
  const sel = (login) => um(db, 'SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = ?', login);
  const ger = sel('gerencia'); const gov = sel('governanca'); const tec = sel('tecnico');
  const q = um(db, "SELECT id FROM quartos WHERE numero = '501'");
  const nova = () => os.criar(db, gov, { quarto_id: q.id, local: 'quarto', categoria: 'hidraulica', prioridade: 'media', descricao: 'Chuveiro sem pressão' }, T0);
  const a = nova();
  assert.throws(() => os.executarAcao(db, tec, a, 'aceitar', {}, T0), (e) => e.status === 403);
  os.executarAcao(db, ger, a, 'aceitar', { responsavel_id: tec.id }, T0);
  const oa = os.buscar(db, a);
  assert.deepEqual([oa.status, oa.recebido_por, oa.responsavel_id], ['aprovada', ger.id, tec.id]);
  assert.throws(() => os.executarAcao(db, ger, nova(), 'aceitar', { responsavel_id: ger.id }, T0), /Profissional de manutenção inválido/);
  const b = nova();
  os.executarAcao(db, ger, b, 'aceitar', {}, T0);
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND os_id = ? AND mensagem LIKE '%disponível%'", tec.id, b), 'técnicos avisados');
  os.executarAcao(db, tec, b, 'assumir', {}, T0);
  assert.equal(os.buscar(db, b).responsavel_id, tec.id);
  db.close();
});

test('acessos: entradas, falhas e bloqueio ficam separados das ações; sem senha; gerente só vê o próprio hotel; limpeza após 180 dias', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const outro = sel('gerencia.canela'); const admin = sel('admin');
  auditoria.registrarAcesso(db, 'login_ok', { usuario: ger, ip: '200.1.1.1', aparelho: auditoria.resumirAparelho('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1') });
  auditoria.registrarAcesso(db, 'login_falha', { login: 'GERENCIA', ip: '200.1.1.2', motivo: 'usuário ou senha inválidos' });
  auditoria.registrarAcesso(db, 'login_falha', { login: 'canela.x', ip: '200.1.1.3' });
  auditoria.registrarAcesso(db, 'login_falha', { login: 'Minha Senha Secreta 123!', ip: '200.1.1.4' });
  auditoria.registrarAcesso(db, 'login_falha', { login: 'ninguem', ip: '200.1.1.5' });
  auditoria.registrar(db, ger, 'quarto_bloqueado', { hotel_id: ger.hotel_id, alvo: '401' });

  assert.equal(auditoria.listar(db, admin, {}).length, 1, 'ações administrativas não misturam com acessos');
  const todosAcessos = auditoria.listar(db, admin, { grupo: 'acessos' });
  assert.equal(todosAcessos.length, 5);
  assert.ok(!JSON.stringify(todosAcessos).includes('Secreta'), 'texto fora do formato de login nunca é gravado');
  assert.equal(todosAcessos.find((a) => a.detalhes.includes('200.1.1.4')).alvo, '(formato inválido)');
  const falhaGerente = todosAcessos.find((a) => a.detalhes.includes('200.1.1.2'));
  assert.deepEqual([falhaGerente.usuario_id, falhaGerente.hotel_id, falhaGerente.alvo], [ger.id, ger.hotel_id, 'gerencia'], 'login digitado em maiúsculas é associado à conta');
  assert.equal(todosAcessos.find((a) => a.detalhes.includes('200.1.1.5')).usuario_id, null, 'conta inexistente');
  assert.match(todosAcessos.find((a) => a.acao === 'login_ok').detalhes, /Safari em iPhone\/iPad/);

  const doGerente = auditoria.listar(db, ger, { grupo: 'acessos' });
  assert.deepEqual(doGerente.map((a) => a.detalhes.match(/200\.1\.1\.\d/)[0]).sort(), ['200.1.1.1', '200.1.1.2'], 'só os acessos de contas do próprio hotel');
  assert.equal(auditoria.listar(db, outro, { grupo: 'acessos' }).length, 0);
  assert.throws(() => auditoria.listar(db, sel('tecnico'), { grupo: 'acessos' }), (e) => e.status === 403);

  const velho = '2026-01-01T00:00:00.000Z';
  exec(db, "UPDATE auditoria SET criado_em = ? WHERE acao = 'login_falha'", velho);
  exec(db, "UPDATE auditoria SET criado_em = ? WHERE acao = 'quarto_bloqueado'", velho);
  assert.equal(auditoria.limparAcessosAntigos(db, '2026-11-10T00:00:00.000Z'), 4);
  assert.equal(auditoria.listar(db, admin, { grupo: 'acessos' }).length, 1, 'entrada recente fica');
  assert.equal(auditoria.listar(db, admin, {}).length, 1, 'ações administrativas nunca são apagadas');
});

test('gerente designa o técnico já na abertura; outros perfis e técnicos de outro hotel são recusados', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const gov = sel('governanca'); const tec = sel('tecnico');
  const q = um(db, "SELECT id FROM quartos WHERE numero = '501'");
  const dados = { quarto_id: q.id, local: 'quarto', categoria: 'hidraulica', prioridade: 'media', descricao: 'Vazamento na pia do banheiro' };
  const id = os.criar(db, ger, { ...dados, responsavel_id: tec.id }, T0);
  const o = os.buscar(db, id);
  assert.deepEqual([o.status, o.responsavel_id, o.recebido_por], ['aprovada', tec.id, ger.id]);
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND os_id = ? AND tipo = 'designacao'", tec.id, id), 'técnico avisado');
  const antes = um(db, 'SELECT COUNT(*) AS n FROM ordens_servico').n;
  assert.throws(() => os.criar(db, gov, { ...dados, responsavel_id: tec.id }, T0), (e) => e.status === 403);
  assert.throws(() => os.criar(db, ger, { ...dados, responsavel_id: sel('gerencia.canela').id }, T0), /inválido|não atende/);
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM ordens_servico').n, antes, 'nada é gravado quando a designação é recusada');
  assert.equal(os.buscar(db, os.criar(db, ger, dados, T0)).status, 'nova', 'sem técnico escolhido continua como antes');
});

test('escalonamento: gerente é avisado no vencimento e a diretoria/admin só depois do limite, uma única vez', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const admin = sel('admin');
  const q = um(db, "SELECT id FROM quartos WHERE numero = '502'");
  const id = os.criar(db, ger, { quarto_id: q.id, local: 'quarto', categoria: 'eletrica', prioridade: 'media', descricao: 'Tomada do quarto sem energia' }, T0);
  const prazo = os.buscar(db, id).prazo_previsto;
  const n = (tipo) => um(db, 'SELECT COUNT(*) AS n FROM notificacoes WHERE os_id = ? AND tipo = ?', id, tipo).n;
  verificar(db, somarHoras(prazo, 1));
  assert.deepEqual([n('atrasada') > 0, n('escalonada')], [true, 0]);
  verificar(db, somarHoras(prazo, 25));
  verificar(db, somarHoras(prazo, 30));
  assert.equal(um(db, "SELECT COUNT(*) AS n FROM notificacoes WHERE os_id = ? AND tipo = 'escalonada' AND usuario_id = ?", id, admin.id).n, 1);
  assert.equal(n('escalonada'), um(db, "SELECT COUNT(*) AS n FROM usuarios WHERE ativo = 1 AND papel IN ('admin', 'diretoria') AND (hotel_id IS NULL OR hotel_id = ?)", ger.hotel_id).n, 'avisa uma vez cada pessoa');
});

test('avaliação do serviço na validação: nota de 1 a 5, aparece nos indicadores; nota inválida não valida', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const tec = sel('tecnico');
  const q = um(db, "SELECT id FROM quartos WHERE numero = '503'");
  const ctx = { uploadsDir: join(mkdtempSync(join(tmpdir(), 'up-')), 'uploads') };
  const id = os.criar(db, ger, { quarto_id: q.id, local: 'quarto', categoria: 'mobiliario', prioridade: 'media', descricao: 'Cadeira da mesa quebrada', responsavel_id: tec.id }, T0);
  os.executarAcao(db, tec, id, 'iniciar', {}, T0);
  fotos.salvar(db, tec, { os_id: id, fase: 'depois', arquivo: PNG }, ctx, T0);
  os.executarAcao(db, tec, id, 'concluir', { texto: 'Cadeira trocada.' }, T0);
  assert.throws(() => os.executarAcao(db, ger, id, 'validar', { nota: 9 }, T0), /1 a 5/);
  assert.equal(os.buscar(db, id).status, 'concluida', 'nota inválida não valida o serviço');
  os.executarAcao(db, ger, id, 'validar', { nota: 4, comentario_avaliacao: 'Rápido e limpo' }, T0);
  const o = os.buscar(db, id);
  assert.deepEqual([o.status, o.avaliacao_nota, o.avaliacao_comentario], ['encerrada', 4, 'Rápido e limpo']);
  assert.equal(indicadores(db, ger, {}, T0).geral.nota_media, 4);
  assert.equal(indicadores(db, ger, {}, T0).geral.avaliacoes, 1);
});

test('idade do último backup (usada pelo /healthz e pelo alerta aos administradores)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  assert.equal(backup.idadeUltimoBackupHoras(dir), null);
  mkdirSync(join(dir, 'backups'));
  writeFileSync(join(dir, 'backups', 'hotelaria-2026-11-10.db'), 'x');
  const h = backup.idadeUltimoBackupHoras(dir, Date.now() + 50 * 3600e3);
  assert.ok(h > 49.9 && h < 50.1, String(h));
});

test('relato pelo QR sem login: desligado por padrão, liga por hotel, limites e conta técnica invisível', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const outro = sel('gerencia.canela'); const tec = sel('tecnico');
  const q = um(db, "SELECT id, hotel_id FROM quartos WHERE numero = '504'");
  const ctx = { uploadsDir: join(mkdtempSync(join(tmpdir(), 'up-')), 'uploads') };
  const relato = { quarto_id: q.id, categoria: 'iluminacao', descricao: 'A luz do banheiro não acende', nome: 'Maria' };
  const contar = () => um(db, 'SELECT COUNT(*) AS n FROM ordens_servico').n;

  assert.equal(relatos.dadosPublicos(db, q.id).ativo, false);
  assert.throws(() => relatos.registrar(db, relato, ctx, T0), (e) => e.status === 403);
  assert.throws(() => relatos.definirAtivo(db, outro, ger.hotel_id, true), (e) => e.status === 403, 'gerente de outro hotel não liga');
  assert.throws(() => relatos.definirAtivo(db, tec, ger.hotel_id, true), (e) => e.status === 403);
  relatos.definirAtivo(db, ger, ger.hotel_id, true);
  assert.equal(relatos.dadosPublicos(db, q.id).ativo, true);
  assert.throws(() => relatos.dadosPublicos(db, 999999), (e) => e.status === 404);

  const antes = contar();
  assert.deepEqual(relatos.registrar(db, { ...relato, site: 'http://spam' }, ctx, T0), { protocolo: 'OS-0000-00000' });
  assert.throws(() => relatos.registrar(db, { ...relato, descricao: 'curto' }, ctx, T0), /mínimo/);
  assert.throws(() => relatos.registrar(db, { ...relato, foto: 'data:text/html;base64,PGgxPg==' }, ctx, T0), /JPG, PNG ou WEBP/);
  assert.equal(contar(), antes, 'robô, descrição curta e foto inválida não criam OS');

  const { protocolo } = relatos.registrar(db, { ...relato, foto: PNG }, ctx, T0);
  const o = um(db, 'SELECT * FROM ordens_servico WHERE protocolo = ?', protocolo);
  assert.deepEqual([o.origem, o.prioridade, o.categoria, o.status, o.quarto_id, o.hotel_id], ['qr', 'media', 'iluminacao', 'nova', q.id, q.hotel_id]);
  assert.match(o.descricao, /Relatado por: Maria/);
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM fotos WHERE os_id = ?', o.id).n, 1);
  assert.ok(um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND os_id = ? AND tipo = 'nova_demanda'", ger.id, o.id), 'gerente é avisado');
  assert.ok(!um(db, "SELECT 1 AS x FROM notificacoes WHERE usuario_id = ? AND os_id = ?", outro.id, o.id), 'outro hotel não recebe');

  const conta = um(db, "SELECT * FROM usuarios WHERE login = ?", `relato-qr-${q.hotel_id}`);
  assert.deepEqual([conta.ativo, !!conta.excluido_em], [0, true]);
  assert.ok(!usuarios.listarUsuarios(db, ger).some((u) => u.login === conta.login), 'conta técnica não aparece na equipe');
  assert.throws(() => usuarios.login(db, conta.login, '!'), (e) => e.status === 401);
  assert.equal(os.detalhe(db, ger, o.id).eventos[0].usuario_nome, 'Relato pelo QR code');
  assert.equal(os.acoesDisponiveis(db, ger, os.buscar(db, o.id)).some((a) => a.chave === 'aceitar'), true, 'gerente trata como qualquer OS');

  for (let i = 1; i < relatos.MAX_RELATOS_POR_QUARTO_DIA; i++) relatos.registrar(db, relato, ctx, T0);
  assert.throws(() => relatos.registrar(db, relato, ctx, T0), (e) => e.status === 429);
  relatos.registrar(db, relato, ctx, '2026-11-12T13:00:00.000Z'); // dois dias depois o limite zera
  relatos.definirAtivo(db, ger, ger.hotel_id, false);
  assert.throws(() => relatos.registrar(db, relato, ctx, T0), (e) => e.status === 403);
});

test('obrigações legais: lista padrão, registro com comprovante, vencimento recalculado e permissões', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const outro = sel('gerencia.canela'); const admin = sel('admin'); const gov = sel('governanca');
  const ctx = { uploadsDir: join(mkdtempSync(join(tmpdir(), 'ob-')), 'uploads') };
  const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 teste').toString('base64')}`;

  assert.equal(obrigacoes.criarModelos(db, ger, ger.hotel_id, T0), Object.keys(obrigacoes.TIPOS_OBRIGACAO).length - 1);
  assert.equal(obrigacoes.criarModelos(db, ger, ger.hotel_id, T0), 0, 'não duplica');
  assert.throws(() => obrigacoes.criarModelos(db, gov, ger.hotel_id, T0), (e) => e.status === 403);
  assert.throws(() => obrigacoes.criarModelos(db, outro, ger.hotel_id, T0), (e) => e.status === 403);
  assert.throws(() => obrigacoes.listar(db, gov, {}, T0), (e) => e.status === 403);
  assert.equal(obrigacoes.listar(db, outro, {}, T0).length, 0, 'cada hotel só vê as suas');
  assert.ok(obrigacoes.listar(db, admin, {}, T0).every((o) => o.situacao === 'sem_registro'));

  const pmoc = obrigacoes.listar(db, ger, {}, T0).find((o) => o.tipo === 'pmoc');
  assert.throws(() => obrigacoes.registrar(db, ger, pmoc.id, { realizado_em: '2026-12-01' }, ctx, T0), /futuro/);
  assert.throws(() => obrigacoes.registrar(db, ger, pmoc.id, { realizado_em: '2026-11-01', comprovante: 'data:text/html;base64,PGgxPg==' }, ctx, T0), /Comprovante inválido/);
  assert.throws(() => obrigacoes.registrar(db, ger, pmoc.id, { realizado_em: '2026-11-01', validade_ate: '2026-10-01' }, ctx, T0), /validade/);
  const r = obrigacoes.registrar(db, ger, pmoc.id, { realizado_em: '2026-11-01T00:00:00.000Z', fornecedor: 'Clima Sul', custo: '850', comprovante: PDF }, ctx, T0);
  assert.equal(r.proxima_em, '2027-11-01', 'data + periodicidade (aceita ISO com horário vindo do formulário)');
  const hist = obrigacoes.historico(db, ger, pmoc.id);
  assert.deepEqual([hist.length, hist[0].fornecedor, hist[0].custo, hist[0].mime], [1, 'Clima Sul', 850, 'application/pdf']);
  assert.ok(fotos.buscarArquivo(db, ger, hist[0].arquivo), 'comprovante é servido a quem vê o hotel');
  assert.throws(() => fotos.buscarArquivo(db, outro, hist[0].arquivo), (e) => e.status === 403);

  // comprovante antigo não mexe no vencimento; validade informada manda
  obrigacoes.registrar(db, ger, pmoc.id, { realizado_em: '2025-10-01' }, ctx, T0);
  assert.equal(obrigacoes.listar(db, ger, {}, T0).find((o) => o.id === pmoc.id).proxima_em, '2027-11-01');
  const avcb = obrigacoes.listar(db, ger, {}, T0).find((o) => o.tipo === 'avcb');
  assert.equal(obrigacoes.registrar(db, ger, avcb.id, { realizado_em: '2026-11-01', validade_ate: '2028-03-15' }, ctx, T0).proxima_em, '2028-03-15');

  assert.throws(() => obrigacoes.excluir(db, ger, pmoc.id), /já tem registros/);
  const outra = obrigacoes.criar(db, ger, { tipo: 'outro', nome: 'Laudo teste', periodicidade_dias: 30 }, T0);
  obrigacoes.excluir(db, ger, outra);
  assert.equal(obrigacoes.listar(db, admin, { hotel_id: ger.hotel_id }, T0).some((o) => o.id === outra), false);
});

test('obrigações legais: avisos 30 e 7 dias antes e ao vencer, cada um uma vez, e recomeçam após novo registro', () => {
  const { db, sel } = cenario();
  const ger = sel('gerencia'); const admin = sel('admin');
  const ctx = { uploadsDir: join(mkdtempSync(join(tmpdir(), 'ob-')), 'uploads') };
  const id = obrigacoes.criar(db, ger, { tipo: 'extintores', proxima_em: '2026-12-10' }, T0); // faltam 30 dias
  const avisos = (u) => todos(db, "SELECT mensagem FROM notificacoes WHERE usuario_id = ? AND tipo = 'obrigacao' ORDER BY id", u.id).map((n) => n.mensagem);

  verificar(db, T0); verificar(db, somarHoras(T0, 1));
  assert.equal(avisos(ger).length, 1);
  assert.match(avisos(ger)[0], /vence em 30 dias \(10\/12\/2026\)/);
  assert.equal(avisos(admin).length, 0, 'diretoria/admin só são avisados quando vence');

  verificar(db, '2026-12-05T13:00:00.000Z'); verificar(db, '2026-12-06T13:00:00.000Z');
  assert.equal(avisos(ger).length, 2);
  assert.match(avisos(ger)[1], /vence em 5 dia/);

  verificar(db, '2026-12-11T13:00:00.000Z'); verificar(db, '2026-12-20T13:00:00.000Z');
  assert.equal(avisos(ger).length, 3);
  assert.match(avisos(ger)[2], /VENCIDA/);
  assert.equal(avisos(admin).length, 1);
  assert.equal(obrigacoes.resumo(db, ger, {}, '2026-12-20T13:00:00.000Z').vencidas, 1);

  obrigacoes.registrar(db, ger, id, { realizado_em: '2026-12-20' }, ctx, '2026-12-20T13:00:00.000Z');
  assert.equal(obrigacoes.listar(db, ger, {}, '2026-12-20T13:00:00.000Z')[0].proxima_em, '2027-12-20');
  verificar(db, '2027-11-25T13:00:00.000Z');
  assert.equal(avisos(ger).length, 4, 'novo ciclo avisa de novo');
});

test('TOTP confere com o vetor oficial da RFC 6238 (SHA-1, segredo "12345678901234567890")', () => {
  const segredo = seguranca.base32(Buffer.from('12345678901234567890'));
  assert.equal(segredo, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(seguranca.codigoTotp(segredo, Math.floor(59 / 30)), '287082');
  assert.equal(seguranca.codigoTotp(segredo, Math.floor(1111111109 / 30)), '081804');
  assert.equal(seguranca.codigoTotp(segredo, Math.floor(1234567890 / 30)), '005924');
});

test('duas etapas: configurar exige a senha, login pede o código, código não se repete, recuperação vale uma vez, reset por quem gerencia', () => {
  const { db, sel, cred } = cenario();
  const admin = sel('admin'); const ger = sel('gerencia'); const outro = sel('gerencia.canela');
  const senha = (login) => cred.find((c) => c.login === login).senha;
  const usu = (id) => um(db, 'SELECT * FROM usuarios WHERE id = ?', id);
  usuarios.alterarSenha(db, admin, { atual: senha('admin'), nova: 'SenhaNova2026!' });
  const agora = new Date().toISOString(); // data real: a lista de sessões só mostra as não expiradas
  const passo = Math.floor(new Date(agora).getTime() / 1000 / 30);

  assert.throws(() => seguranca.iniciar2FA(db, admin, { senha: 'errada' }), (e) => e.status === 400);
  const { segredo, uri } = seguranca.iniciar2FA(db, admin, { senha: 'SenhaNova2026!' });
  assert.match(uri, /^otpauth:\/\/totp\/Tri%20Hot%C3%A9is%3Aadmin\?secret=[A-Z2-7]+&issuer=/);
  assert.ok(usuarios.login(db, 'admin', 'SenhaNova2026!'), 'ainda não ativado: entra só com a senha');
  assert.throws(() => seguranca.ativar2FA(db, admin, { codigo: '000000' }, agora), /incorreto/);
  const { codigos } = seguranca.ativar2FA(db, admin, { codigo: seguranca.codigoTotp(segredo, passo) }, agora);
  assert.equal(codigos.length, 8);
  assert.equal(seguranca.estado2FA(db, admin).ativo, true);

  assert.throws(() => usuarios.login(db, 'admin', 'SenhaNova2026!'), (e) => e.segundoFator === true && e.status === 401, 'sem código: pede o código');
  assert.throws(() => usuarios.login(db, 'admin', 'errada', { codigo: '123456' }), (e) => !e.segundoFator && e.status === 401, 'senha errada nunca revela o 2º fator');
  assert.throws(() => usuarios.login(db, 'admin', 'SenhaNova2026!', { codigo: '000000', agora }), /incorreto/);
  assert.throws(() => usuarios.login(db, 'admin', 'SenhaNova2026!', { codigo: seguranca.codigoTotp(segredo, passo), agora }), /incorreto/, 'o código usado na ativação não vale de novo');
  const token = usuarios.login(db, 'admin', 'SenhaNova2026!', { codigo: seguranca.codigoTotp(segredo, passo + 1), agora, ip: '10.0.0.9', aparelho: 'Chrome em Windows' });
  assert.ok(token);
  assert.throws(() => usuarios.login(db, 'admin', 'SenhaNova2026!', { codigo: seguranca.codigoTotp(segredo, passo + 1), agora }), /incorreto/, 'mesmo código não se repete');

  assert.ok(usuarios.login(db, 'admin', 'SenhaNova2026!', { codigo: codigos[0].toUpperCase(), agora }), 'código de recuperação (com ou sem hífen/maiúsculas)');
  assert.throws(() => usuarios.login(db, 'admin', 'SenhaNova2026!', { codigo: codigos[0], agora }), /incorreto/, 'recuperação vale uma vez');
  assert.equal(seguranca.estado2FA(db, admin).recuperacao_restantes, 7);
  assert.ok(!JSON.stringify(usu(admin.id)).includes(codigos[1]), 'só o hash dos códigos é guardado');

  // sessões: aparelho/IP, encerrar outras
  const sessoes = seguranca.listarSessoes(db, admin, token);
  assert.deepEqual(sessoes.filter((s) => s.atual).map((s) => [s.ip, s.aparelho]), [['10.0.0.9', 'Chrome em Windows']]);
  assert.equal(seguranca.encerrarOutrasSessoes(db, admin, token), sessoes.length - 1);
  assert.throws(() => seguranca.encerrarSessao(db, admin, sessoes.find((s) => s.atual).id, token), /em uso/);

  // desativar exige senha + código; reset por quem gerencia
  assert.throws(() => seguranca.desativar2FA(db, admin, { senha: 'SenhaNova2026!', codigo: '000000' }, agora), /incorreto/);
  assert.throws(() => seguranca.resetar2FA(db, outro, admin.id), (e) => e.status === 403);
  seguranca.iniciar2FA(db, ger, { senha: senha('gerencia') });
  seguranca.ativar2FA(db, ger, { codigo: seguranca.codigoTotp(usu(ger.id).totp_segredo, passo) }, agora);
  assert.throws(() => seguranca.resetar2FA(db, outro, ger.id), (e) => e.status === 403, 'gerente de outro hotel não redefine');
  seguranca.resetar2FA(db, admin, ger.id);
  assert.ok(usuarios.login(db, 'gerencia', senha('gerencia')), 'depois do reset entra só com a senha');
  seguranca.desativar2FA(db, admin, { senha: 'SenhaNova2026!', codigo: codigos[2] }, agora);
  assert.equal(seguranca.estado2FA(db, admin).ativo, false);
});

test('dados de demonstração (seed:demo) carregam com os perfis atuais e deixam OS em todas as situações', () => {
  const db = abrirBanco(':memory:');
  popular(db, { uploadsDir: join(mkdtempSync(join(tmpdir(), 'demo-')), 'uploads') });
  const papeis = todos(db, 'SELECT DISTINCT papel FROM usuarios').map((r) => r.papel).sort();
  assert.deepEqual(papeis, ['admin', 'diretoria', 'gerente', 'governanta', 'tecnico']);
  const situacoes = new Set(todos(db, 'SELECT DISTINCT status FROM ordens_servico').map((r) => r.status));
  for (const s of ['nova', 'aprovada', 'em_execucao', 'aguardando_autorizacao', 'concluida', 'encerrada']) assert.ok(situacoes.has(s), s);
});
