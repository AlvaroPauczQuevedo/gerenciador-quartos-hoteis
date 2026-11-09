import { Roteador } from './http.js';
import { transacao, todos } from './db.js';
import { meta } from './domain/constantes.js';
import { exigir, exigirHotel, filtroHotel } from './domain/comum.js';
import * as usuarios from './domain/usuarios.js';
import * as quartos from './domain/quartos.js';
import * as os from './domain/os.js';
import * as fotos from './domain/fotos.js';
import * as inspecoes from './domain/inspecoes.js';
import * as notificacoes from './domain/notificacoes.js';
import * as push from './domain/push.js';
import { analise as analiseRecorrencia, ocorrenciasRelacionadas } from './domain/recorrencia.js';
import { indicadores, rede, resumoInicial } from './domain/indicadores.js';

// Cada handler recebe { db, usuario, params, query, body, ctx } e devolve o JSON da resposta.
// Handlers marcados com `mutacao` rodam dentro de uma transação.
export function criarRotas() {
  const r = new Roteador();
  const get = (p, h) => r.get(p, h);
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
  post('/api/hoteis', ({ db, usuario, body }) => ({ id: usuarios.criarHotel(db, usuario, body) }));
  put('/api/hoteis/:id', ({ db, usuario, params, body }) => { usuarios.atualizarHotel(db, usuario, params.id, body); return { ok: true }; });
  get('/api/usuarios', ({ db, usuario, query }) => usuarios.listarUsuarios(db, usuario, query));
  post('/api/usuarios', ({ db, usuario, body }) => ({ id: usuarios.criarUsuario(db, usuario, body) }));
  post('/api/usuarios/:id/excluir', ({ db, usuario, params }) => usuarios.excluirUsuario(db, usuario, params.id));
  post('/api/usuarios/:id/alternar', ({ db, usuario, params }) => { usuarios.alternarAtivo(db, usuario, params.id); return { ok: true }; });

  // ---- quartos ----
  get('/api/quartos', ({ db, usuario, query }) => quartos.listar(db, usuario, query));
  post('/api/quartos', ({ db, usuario, body }) => ({ id: quartos.criar(db, usuario, body) }));
  post('/api/quartos/lote', ({ db, usuario, body }) => quartos.criarLote(db, usuario, body));
  post('/api/quartos/numeracao', ({ db, usuario, body }) => quartos.definirNumeracao(db, usuario, body));
  put('/api/quartos/:id', ({ db, usuario, params, body }) => { quartos.editar(db, usuario, Number(params.id), body); return { ok: true }; });
  post('/api/quartos/:id/excluir', ({ db, usuario, params }) => { quartos.excluir(db, usuario, Number(params.id)); return { ok: true }; });
  post('/api/eu/senha', ({ db, usuario, body }) => { usuarios.alterarSenha(db, usuario, body); return { ok: true }; });
  post('/api/usuarios/:id/senha', ({ db, usuario, params, body }) => { usuarios.redefinirSenha(db, usuario, params.id, body.senha); return { ok: true }; });
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
  post('/api/quartos/:id/bloquear', ({ db, usuario, params, body }) => ({ id: quartos.bloquear(db, usuario, Number(params.id), { motivo: body.motivo }) }));
  post('/api/quartos/:id/liberar', ({ db, usuario, params, body }) => ({ liberados: quartos.liberar(db, usuario, Number(params.id), { observacao: body.observacao }) }));
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
  post('/api/checklist', ({ db, usuario, body }) => ({ id: inspecoes.adicionarItemChecklist(db, usuario, body) }));
  post('/api/checklist/:id/alternar', ({ db, usuario, params }) => { inspecoes.alternarItemChecklist(db, usuario, params.id); return { ok: true }; });
  post('/api/checklist/:id/excluir', ({ db, usuario, params }) => { inspecoes.excluirItemChecklist(db, usuario, params.id); return { ok: true }; });

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
