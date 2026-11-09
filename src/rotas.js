import { Roteador } from './http.js';
import { transacao, todos, um } from './db.js';
import { meta } from './domain/constantes.js';
import { exigir, exigirHotel, filtroHotel } from './domain/comum.js';
import * as usuarios from './domain/usuarios.js';
import * as quartos from './domain/quartos.js';
import * as os from './domain/os.js';
import * as fotos from './domain/fotos.js';
import * as inspecoes from './domain/inspecoes.js';
import * as notificacoes from './domain/notificacoes.js';
import * as push from './domain/push.js';
import * as auditoria from './domain/auditoria.js';
import * as backup from './domain/backup.js';
import * as preventiva from './domain/preventiva.js';
import * as estoque from './domain/estoque.js';
import * as hospedes from './domain/hospedes.js';
import * as importacaoQuartos from './domain/importacao-quartos.js';
import { ErroHttp } from './domain/comum.js';
import { analise as analiseRecorrencia, ocorrenciasRelacionadas } from './domain/recorrencia.js';
import { indicadores, rede, resumoInicial } from './domain/indicadores.js';

// Cada handler recebe { db, usuario, params, query, body, ctx } e devolve o JSON da resposta.
// Handlers marcados com `mutacao` rodam dentro de uma transação.
export function criarRotas() {
  const r = new Roteador();
  const get = (p, h) => r.get(p, h);
  // Auditoria: registrada na mesma transação da ação (se a ação falhar, o registro também é desfeito).
  const aud = (db, usuario, acao, dados) => auditoria.registrar(db, usuario, acao, dados);
  const alvoUsuario = (db, id) => um(db, 'SELECT login, hotel_id, ativo FROM usuarios WHERE id = ?', Number(id));
  const alvoQuarto = (db, id) => um(db, 'SELECT numero, hotel_id FROM quartos WHERE id = ?', Number(id));
  const alvoItem = (db, id) => um(db, 'SELECT item, hotel_id, ativo FROM checklist_modelo WHERE id = ?', Number(id));
  const post = (p, h) => r.post(p, Object.assign(h, { mutacao: true }));
  const put = (p, h) => r.put(p, Object.assign(h, { mutacao: true }));

  const anexar = (db, usuario, lista, vinculo, ctx) => {
    for (const f of Array.isArray(lista) ? lista : []) fotos.salvar(db, usuario, { ...f, ...vinculo }, ctx);
  };

  // ---- sessão ----
  get('/api/eu', ({ db, usuario }) => ({
    usuario, meta: meta(), hoteis: usuarios.listarHoteis(db, usuario), naoLidas: notificacoes.contarNaoLidas(db, usuario.id),
  }));
  get('/api/resumo', ({ db, usuario }) => resumoInicial(db, usuario));

  // ---- cadastros ----
  get('/api/hoteis', ({ db, usuario }) => usuarios.listarHoteis(db, usuario));
  post('/api/hoteis', ({ db, usuario, body }) => { const id = usuarios.criarHotel(db, usuario, body); aud(db, usuario, 'hotel_criado', { hotel_id: id, alvo: body.nome }); return { id }; });
  put('/api/hoteis/:id', ({ db, usuario, params, body }) => { usuarios.atualizarHotel(db, usuario, params.id, body); aud(db, usuario, 'hotel_alterado', { hotel_id: Number(params.id), detalhes: body }); return { ok: true }; });
  get('/api/usuarios', ({ db, usuario, query }) => usuarios.listarUsuarios(db, usuario, query));
  post('/api/usuarios', ({ db, usuario, body }) => { const id = usuarios.criarUsuario(db, usuario, body); const a = alvoUsuario(db, id); aud(db, usuario, 'usuario_criado', { hotel_id: a.hotel_id, alvo: a.login, detalhes: { papel: body.papel } }); return { id }; });
  post('/api/usuarios/:id/excluir', ({ db, usuario, params }) => { const a = alvoUsuario(db, params.id); const r = usuarios.excluirUsuario(db, usuario, params.id); aud(db, usuario, 'usuario_excluido', { hotel_id: a?.hotel_id, alvo: a?.login, detalhes: r }); return r; });
  post('/api/usuarios/:id/alternar', ({ db, usuario, params }) => { usuarios.alternarAtivo(db, usuario, params.id); const a = alvoUsuario(db, params.id); aud(db, usuario, a?.ativo ? 'usuario_ativado' : 'usuario_desativado', { hotel_id: a?.hotel_id, alvo: a?.login }); return { ok: true }; });

  // ---- quartos ----
  get('/api/quartos', ({ db, usuario, query }) => quartos.listar(db, usuario, query));
  post('/api/quartos', ({ db, usuario, body }) => { const id = quartos.criar(db, usuario, body); aud(db, usuario, 'quarto_criado', { hotel_id: Number(body.hotel_id), alvo: body.numero }); return { id }; });
  post('/api/quartos/lote', ({ db, usuario, body }) => { const r = quartos.criarLote(db, usuario, body); aud(db, usuario, 'quarto_criado', { hotel_id: Number(body.hotel_id), alvo: body.inicio + '–' + body.fim, detalhes: { criados: r.criados } }); return r; });
  post('/api/quartos/importar', ({ db, usuario, body }) => {
    const r = importacaoQuartos.importar(db, usuario, body);
    if (r.aplicado) for (const h of r.hoteis) aud(db, usuario, 'numeracao_definida', { hotel_id: h.hotel_id, alvo: 'Planilha de quartos (HITS)', detalhes: { criados: h.criados, atualizados: h.atualizados, provisorios_removidos: h.provisorios_removidos, fora_da_planilha: h.fora_da_planilha.length } });
    return r;
  });
  post('/api/quartos/numeracao', ({ db, usuario, body }) => { const r = quartos.definirNumeracao(db, usuario, body); aud(db, usuario, 'numeracao_definida', { hotel_id: Number(body.hotel_id || usuario.hotel_id), detalhes: { faixas: body.faixas, ...r } }); return r; });
  put('/api/quartos/:id', ({ db, usuario, params, body }) => { const a = alvoQuarto(db, params.id); quartos.editar(db, usuario, Number(params.id), body); aud(db, usuario, 'quarto_editado', { hotel_id: a?.hotel_id, alvo: a?.numero, detalhes: body }); return { ok: true }; });
  post('/api/quartos/:id/excluir', ({ db, usuario, params }) => { const a = alvoQuarto(db, params.id); quartos.excluir(db, usuario, Number(params.id)); aud(db, usuario, 'quarto_excluido', { hotel_id: a?.hotel_id, alvo: a?.numero }); return { ok: true }; });
  post('/api/eu/senha', ({ db, usuario, body }) => { usuarios.alterarSenha(db, usuario, body); aud(db, usuario, 'senha_alterada', { hotel_id: usuario.hotel_id, alvo: usuario.login }); return { ok: true }; });
  post('/api/usuarios/:id/senha', ({ db, usuario, params, body }) => { usuarios.redefinirSenha(db, usuario, params.id, body.senha); const a = alvoUsuario(db, params.id); aud(db, usuario, 'senha_redefinida', { hotel_id: a?.hotel_id, alvo: a?.login }); return { ok: true }; });
  post('/api/quartos/programar-inspecao', ({ db, usuario, body }) => {
    let ids = Array.isArray(body.quarto_ids) ? body.quarto_ids.map(Number) : [];
    if (!ids.length && body.hotel_id) {
      exigirHotel(usuario, body.hotel_id);
      ids = todos(db, 'SELECT id FROM quartos WHERE hotel_id = ?', Number(body.hotel_id)).map((q) => q.id);
    }
    exigir(ids.length, 'Selecione os quartos ou o hotel.');
    return { atualizados: quartos.programarInspecao(db, usuario, ids, body) };
  });
  get('/api/quartos/:id', ({ db, usuario, params }) => quartos.detalhe(db, usuario, Number(params.id)));
  get('/api/quartos/:id/galeria', ({ db, usuario, params }) => fotos.galeriaQuarto(db, usuario, Number(params.id)));
  get('/api/quartos/:id/recorrencia', ({ db, usuario, params, query }) => {
    const q = quartos.detalhe(db, usuario, Number(params.id));
    return ocorrenciasRelacionadas(db, { quarto_id: q.id, equipamento_id: query.equipamento_id ? Number(query.equipamento_id) : null, categoria: query.categoria });
  });
  post('/api/quartos/:id/bloquear', ({ db, usuario, params, body }) => { const id = quartos.bloquear(db, usuario, Number(params.id), { motivo: body.motivo }); const a = alvoQuarto(db, params.id); aud(db, usuario, 'quarto_bloqueado', { hotel_id: a?.hotel_id, alvo: a?.numero, detalhes: body.motivo }); return { id }; });
  post('/api/quartos/:id/liberar', ({ db, usuario, params, body }) => { const liberados = quartos.liberar(db, usuario, Number(params.id), { observacao: body.observacao }); const a = alvoQuarto(db, params.id); aud(db, usuario, 'quarto_liberado', { hotel_id: a?.hotel_id, alvo: a?.numero, detalhes: body.observacao }); return { liberados }; });
  post('/api/quartos/:id/estrelas', ({ db, usuario, params, body }) => { quartos.definirEstrelas(db, usuario, Number(params.id), body.estrelas); return { ok: true }; });
  post('/api/quartos/:id/equipamentos', ({ db, usuario, params, body }) => ({ id: quartos.adicionarEquipamento(db, usuario, Number(params.id), body) }));
  post('/api/equipamentos/:id/substituir', ({ db, usuario, params, body }) => ({ id: quartos.substituirEquipamento(db, usuario, Number(params.id), body) }));

  // ---- ordens de serviço ----
  get('/api/os', ({ db, usuario, query }) => os.listar(db, usuario, query));
  get('/api/os/painel', ({ db, usuario, query }) => os.contagemPainel(db, usuario, query));
  post('/api/os', ({ db, usuario, body, ctx }) => {
    const id = os.criar(db, usuario, body);
    anexar(db, usuario, body.fotos, { os_id: id, fase: 'antes' }, ctx);
    return { id, protocolo: os.buscar(db, id).protocolo };
  });
  get('/api/os/:id', ({ db, usuario, params }) => os.detalhe(db, usuario, Number(params.id)));
  post('/api/os/:id/acoes/:acao', ({ db, usuario, params, body, ctx }) => {
    const id = Number(params.id);
    exigirHotel(usuario, os.buscar(db, id).hotel_id);
    const fase = { concluir: 'depois', validar: 'validacao', solicitar_correcao: 'validacao', reabrir: 'validacao' }[params.acao] || 'durante';
    anexar(db, usuario, body.fotos, { os_id: id, fase }, ctx);
    os.executarAcao(db, usuario, id, params.acao, body);
    return os.detalhe(db, usuario, id);
  });

  // ---- fotos ----
  post('/api/fotos', ({ db, usuario, body, ctx }) => ({ id: fotos.salvar(db, usuario, body, ctx) }));
  post('/api/quartos/:id/fotos-padrao', ({ db, usuario, params, body, ctx }) => fotos.salvarPadrao(db, usuario, Number(params.id), body, ctx));
  post('/api/fotos/:id/remover-padrao', ({ db, usuario, params, body, ctx }) => ({ removidas: fotos.removerPadrao(db, usuario, params.id, body, ctx) }));

  // ---- inspeções ----
  get('/api/inspecoes', ({ db, usuario, query }) => inspecoes.listar(db, usuario, query));
  post('/api/inspecoes', ({ db, usuario, body }) => ({ id: inspecoes.criar(db, usuario, body) }));
  get('/api/inspecoes/:id', ({ db, usuario, params }) => inspecoes.detalhe(db, usuario, Number(params.id)));
  put('/api/inspecoes/itens/:id', ({ db, usuario, params, body }) => { inspecoes.responder(db, usuario, Number(params.id), body); return { ok: true }; });
  post('/api/inspecoes/itens/:id/gerar-os', ({ db, usuario, params, body }) => inspecoes.gerarOS(db, usuario, Number(params.id), body));
  post('/api/inspecoes/itens/:id/cronico', ({ db, usuario, params, body }) => ({ id: inspecoes.registrarCronico(db, usuario, { ...body, inspecao_item_id: Number(params.id) }) }));
  post('/api/inspecoes/:id/concluir', ({ db, usuario, params, body }) => inspecoes.concluir(db, usuario, Number(params.id), body));

  // ---- checklist de inspeção por hotel ----
  get('/api/checklist', ({ db, usuario, query }) => {
    const hotelId = Number(query.hotel_id || usuario.hotel_id || usuarios.listarHoteis(db, usuario)[0]?.id);
    exigirHotel(usuario, hotelId);
    return { hotel_id: hotelId, ...inspecoes.checklistDoHotel(db, hotelId, { incluirInativos: true }) };
  });
  post('/api/checklist', ({ db, usuario, body }) => { const id = inspecoes.adicionarItemChecklist(db, usuario, body); const a = alvoItem(db, id); aud(db, usuario, 'checklist_incluido', { hotel_id: a?.hotel_id, alvo: a?.item }); return { id }; });
  post('/api/checklist/:id/alternar', ({ db, usuario, params }) => { inspecoes.alternarItemChecklist(db, usuario, params.id); const a = alvoItem(db, params.id); aud(db, usuario, 'checklist_alternado', { hotel_id: a?.hotel_id, alvo: a?.item, detalhes: { ativo: a?.ativo } }); return { ok: true }; });
  post('/api/checklist/:id/excluir', ({ db, usuario, params }) => { const a = alvoItem(db, params.id); inspecoes.excluirItemChecklist(db, usuario, params.id); aud(db, usuario, 'checklist_excluido', { hotel_id: a?.hotel_id, alvo: a?.item }); return { ok: true }; });

  // ---- problemas crônicos ----
  get('/api/cronicos', ({ db, usuario, query }) => {
    const f = filtroHotel(usuario, 'c.hotel_id', query.hotel_id);
    return todos(db, `SELECT c.*, q.numero AS quarto_numero, h.nome AS hotel_nome, e.tipo AS equipamento_tipo, u.nome AS criado_por_nome
      FROM problemas_cronicos c JOIN hoteis h ON h.id = c.hotel_id LEFT JOIN quartos q ON q.id = c.quarto_id
      LEFT JOIN equipamentos e ON e.id = c.equipamento_id LEFT JOIN usuarios u ON u.id = c.criado_por
      WHERE 1 = 1 ${f.sql} ${query.status ? 'AND c.status = ?' : ''} ORDER BY c.status, c.criado_em DESC`, ...f.params, ...(query.status ? [query.status] : []));
  });
  post('/api/cronicos', ({ db, usuario, body }) => ({ id: inspecoes.registrarCronico(db, usuario, { ...body, origem: body.origem === 'recorrencia' ? 'recorrencia' : 'manual' }) }));
  post('/api/cronicos/:id/resolver', ({ db, usuario, params }) => { inspecoes.resolverCronico(db, usuario, params.id); return { ok: true }; });

  // ---- inteligência e indicadores ----
  get('/api/recorrencia', ({ db, usuario, query }) => analiseRecorrencia(db, usuario, query));
  get('/api/indicadores', ({ db, usuario, query }) => indicadores(db, usuario, query));
  get('/api/rede', ({ db, usuario, query }) => rede(db, usuario, query));

  // ---- backups (somente administrador) ----
  get('/api/backups', ({ usuario, ctx }) => {
    if (usuario.papel !== 'admin') throw new ErroHttp(403, 'Somente o administrador acessa os backups.');
    return { retencao: backup.RETENCAO, itens: backup.listar(ctx.dataDir) };
  });
  r.post('/api/backups', async ({ db, usuario, ctx }) => {
    if (usuario.papel !== 'admin') throw new ErroHttp(403, 'Somente o administrador gera backups.');
    const nome = await backup.gerar(db, ctx.dataDir, { manual: true });
    auditoria.registrar(db, usuario, 'backup_gerado', { alvo: nome });
    return { nome };
  });

  // ---- manutenção preventiva ----
  get('/api/preventiva', ({ db, usuario, query }) => preventiva.listar(db, usuario, query));
  post('/api/preventiva', ({ db, usuario, body }) => { const id = preventiva.criarPlano(db, usuario, body); aud(db, usuario, 'preventiva_criada', { hotel_id: Number(body.hotel_id || usuario.hotel_id), alvo: body.nome, detalhes: { periodicidade: body.periodicidade_dias } }); return { id }; });
  put('/api/preventiva/:id', ({ db, usuario, params, body }) => { const p = preventiva.alterarPlano(db, usuario, params.id, body); aud(db, usuario, 'preventiva_alterada', { hotel_id: p.hotel_id, alvo: p.nome, detalhes: body }); return { ok: true }; });
  post('/api/preventiva/:id/excluir', ({ db, usuario, params }) => { const p = preventiva.excluirPlano(db, usuario, params.id); aud(db, usuario, 'preventiva_excluida', { hotel_id: p.hotel_id, alvo: p.nome }); return { ok: true }; });

  // ---- avaliações de hóspedes ----
  get('/api/quartos/:id/avaliacoes', ({ db, usuario, params }) => { quartos.detalhe(db, usuario, Number(params.id)); return hospedes.doQuarto(db, Number(params.id)); });
  post('/api/quartos/:id/avaliacoes', ({ db, usuario, params, body }) => hospedes.registrar(db, usuario, Number(params.id), body));
  post('/api/avaliacoes/:id/excluir', ({ db, usuario, params }) => { hospedes.excluir(db, usuario, params.id); return { ok: true }; });
  get('/api/avaliacoes/criticos', ({ db, usuario, query }) => hospedes.quartosCriticos(db, usuario, query));

  // ---- estoque ----
  get('/api/estoque', ({ db, usuario, query }) => estoque.listar(db, usuario, query));
  get('/api/estoque/:id/movimentos', ({ db, usuario, params }) => estoque.movimentos(db, usuario, params.id));
  post('/api/estoque', ({ db, usuario, body }) => { const id = estoque.salvarItem(db, usuario, body); const it = um(db, 'SELECT nome, hotel_id FROM estoque_itens WHERE id = ?', id); aud(db, usuario, 'estoque_item', { hotel_id: it.hotel_id, alvo: it.nome, detalhes: body }); return { id }; });
  post('/api/estoque/:id/movimentar', ({ db, usuario, params, body }) => { const r = estoque.movimentar(db, usuario, params.id, body); aud(db, usuario, 'estoque_movimento', { hotel_id: r.item.hotel_id, alvo: r.item.nome, detalhes: { tipo: body.tipo, quantidade: body.quantidade, saldo: r.item.quantidade } }); return r; });

  // ---- auditoria ----
  get('/api/auditoria', ({ db, usuario, query }) => ({ acoes: auditoria.ACOES_AUDITORIA, itens: auditoria.listar(db, usuario, query) }));

  // ---- notificações push no celular ----
  get('/api/push/chave', ({ db }) => ({ publica: push.chavesVapid(db).publica }));
  get('/api/push/aparelhos', ({ db, usuario }) => push.aparelhosDoUsuario(db, usuario.id));
  post('/api/push/inscrever', ({ db, usuario, body, cliente }) => { push.inscrever(db, usuario, body, cliente); return { ok: true }; });
  post('/api/push/cancelar', ({ db, usuario, body }) => { push.cancelar(db, usuario, body.endpoint); return { ok: true }; });
  r.post('/api/push/teste', ({ db, usuario }) => push.testar(db, usuario));

  // ---- notificações ----
  get('/api/notificacoes', ({ db, usuario, query }) => ({
    itens: notificacoes.listar(db, usuario.id, { somenteNaoLidas: query.nao_lidas === '1' }),
    naoLidas: notificacoes.contarNaoLidas(db, usuario.id),
  }));
  post('/api/notificacoes/:id/lida', ({ db, usuario, params }) => { notificacoes.marcarLida(db, usuario.id, params.id); return { ok: true }; });

  return r;
}

export { transacao };
