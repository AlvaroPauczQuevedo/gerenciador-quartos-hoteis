// Inspeções periódicas (seção 16) e problemas crônicos (seção 20, item 7).
import { todos, um, exec, lerConfig, gravarConfig } from '../db.js';
import { CHECKLIST_PADRAO, RESPOSTAS_INSPECAO, CATEGORIAS, STATUS_FINAIS, EQUIPAMENTOS_PADRAO } from './constantes.js';
import { agoraIso, somarDias, exigir, exigirHotel, exigirPapel, filtroHotel, texto, buscarQuarto } from './comum.js';
import * as os from './os.js';
import { registrarHistorico } from './quartos.js';
import { listarPadrao } from './fotos.js';

const PAPEIS_INSPECAO = ['governanta', 'gerente', 'admin', 'manutencao_chefe'];
const FINAIS_SQL = STATUS_FINAIS.map((s) => `'${s}'`).join(',');

export function criar(db, usuario, { quarto_id }, agora) {
  exigirPapel(usuario, ...PAPEIS_INSPECAO);
  const q = buscarQuarto(db, Number(quarto_id));
  exigirHotel(usuario, q.hotel_id);
  const aberta = um(db, "SELECT id FROM inspecoes WHERE quarto_id = ? AND status = 'em_andamento'", q.id);
  if (aberta) return aberta.id;
  const modelo = checklistDoHotel(db, q.hotel_id);
  exigir(modelo.itens.length, 'O checklist de inspeção deste hotel está vazio. Cadastre ou reative itens em Cadastros → Checklist de inspeção.');

  const r = exec(db, 'INSERT INTO inspecoes (hotel_id, quarto_id, inspetor_id, iniciada_em) VALUES (?, ?, ?, ?)',
    q.hotel_id, q.id, usuario.id, agoraIso(agora));
  const id = Number(r.lastInsertRowid);
  const equipamentos = todos(db, 'SELECT * FROM equipamentos WHERE quarto_id = ? AND ativo = 1', q.id);
  const porTipo = (tipo) => equipamentos.find((e) => e.tipo === tipo)?.id ?? null;
  const st = db.prepare(`INSERT INTO inspecao_itens (inspecao_id, ordem, ambiente, item, categoria, local, equipamento_id, critico)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let ordem = 0;
  for (const c of modelo.itens) st.run(id, ++ordem, c.ambiente, c.item, c.categoria, c.local, c.equipamento ? porTipo(c.equipamento) : null, c.critico ? 1 : 0);
  // Equipamentos cadastrados no quarto que o checklist não cobre.
  const cobertos = new Set(modelo.itens.map((c) => c.equipamento).filter(Boolean));
  const extras = equipamentos.filter((e) => !cobertos.has(e.tipo) && (modelo.personalizado || !EQUIPAMENTOS_PADRAO.includes(e.tipo)));
  for (const e of extras) st.run(id, ++ordem, 'Equipamentos', e.tipo + (e.descricao ? ` (${e.descricao})` : ''), 'equipamentos', 'quarto', e.id, 0);
  if (!extras.length && !modelo.personalizado) st.run(id, ++ordem, 'Equipamentos', 'Outros equipamentos existentes', 'equipamentos', 'quarto', null, 0);
  return id;
}

function buscarItem(db, usuario, itemId) {
  const it = um(db, `SELECT it.*, i.status AS inspecao_status, i.hotel_id, i.quarto_id, i.inspetor_id
    FROM inspecao_itens it JOIN inspecoes i ON i.id = it.inspecao_id WHERE it.id = ?`, Number(itemId));
  exigir(it, 'Item de inspeção não encontrado.', 404);
  exigirHotel(usuario, it.hotel_id);
  return it;
}

export function responder(db, usuario, itemId, { resposta, observacao }) {
  exigirPapel(usuario, ...PAPEIS_INSPECAO);
  const it = buscarItem(db, usuario, itemId);
  exigir(it.inspecao_status === 'em_andamento', 'A inspeção já foi concluída.');
  exigir(RESPOSTAS_INSPECAO[resposta], 'Resposta inválida.');
  exec(db, 'UPDATE inspecao_itens SET resposta = ?, observacao = ? WHERE id = ?', resposta, texto(observacao) || null, it.id);
}

// Itens básicos (críticos para a venda) pedem atendimento rápido; os demais permitem planejamento.
export const prioridadeSugerida = (it) => (it.critico
  ? (it.resposta === 'manutencao' ? 'alta' : 'media')
  : (it.resposta === 'manutencao' ? 'media' : 'baixa'));

// Integração 1: item reprovado vira demanda de manutenção sem redigitação. Se já houver OS
// aberta para o mesmo problema no quarto, o item é vinculado a ela (evita registros duplicados).
export function gerarOS(db, usuario, itemId, dados = {}, agora) {
  const it = buscarItem(db, usuario, itemId);
  exigir(['atencao', 'manutencao'].includes(it.resposta), 'Somente itens com "Necessita de atenção" ou "Necessita de manutenção" geram solicitação.');
  exigir(!it.os_id, 'Este item já está vinculado a uma ordem de serviço.');
  const ins = um(db, 'SELECT * FROM inspecoes WHERE id = ?', it.inspecao_id);

  const existente = um(
    db,
    `SELECT id, protocolo FROM ordens_servico WHERE quarto_id = ? AND status NOT IN (${FINAIS_SQL}, 'concluida')
       AND ${it.equipamento_id ? 'equipamento_id = ?' : "categoria = ? AND (local = ? OR equipamento_id IS NULL)"}
     ORDER BY criado_em DESC LIMIT 1`,
    it.quarto_id, ...(it.equipamento_id ? [it.equipamento_id] : [it.categoria, it.local])
  );
  if (existente && !dados.forcar_nova) {
    exec(db, 'UPDATE inspecao_itens SET os_id = ? WHERE id = ?', existente.id, it.id);
    exec(db, 'UPDATE fotos SET os_id = ? WHERE inspecao_item_id = ? AND os_id IS NULL', existente.id, it.id);
    os.executarAcao(db, usuario, existente.id, 'comentar', {
      texto: `Inspeção #${ins.id} confirmou o problema — ${it.ambiente}: ${it.item} (${RESPOSTAS_INSPECAO[it.resposta]})${it.observacao ? `. ${it.observacao}` : ''}`,
    }, agora);
    return { os_id: existente.id, vinculada: true, protocolo: existente.protocolo };
  }

  const prioridade = dados.prioridade || prioridadeSugerida(it);
  const osId = os.criar(db, usuario, {
    hotel_id: it.hotel_id,
    quarto_id: it.quarto_id,
    equipamento_id: it.equipamento_id,
    local: it.local,
    categoria: it.categoria,
    titulo: `${it.item} — ${RESPOSTAS_INSPECAO[it.resposta]}`,
    descricao: `Identificado na inspeção periódica #${ins.id} (${it.ambiente}: ${it.item}). ${it.observacao || 'Sem observações adicionais.'}${texto(dados.descricao) ? `\n${texto(dados.descricao)}` : ''}`,
    prioridade,
    identificado_em: ins.iniciada_em,
    justificativa: texto(dados.justificativa) || `Item reprovado na inspeção: ${RESPOSTAS_INSPECAO[it.resposta]}.`,
    impacto: dados.impacto || (it.critico && it.resposta === 'manutencao' ? 'alto' : it.resposta === 'manutencao' ? 'medio' : 'baixo'),
    bloqueio_quarto: !!dados.bloqueio_quarto,
    prazo_desejado: dados.prazo_desejado,
    origem: 'inspecao',
    inspecao_item_id: it.id,
  }, agora);
  exec(db, 'UPDATE inspecao_itens SET os_id = ? WHERE id = ?', osId, it.id);
  // As fotos da inspeção passam a ser o "antes" da OS — sem novo upload.
  exec(db, "UPDATE fotos SET os_id = ?, fase = 'antes' WHERE inspecao_item_id = ? AND os_id IS NULL", osId, it.id);
  return { os_id: osId, vinculada: false, protocolo: os.buscar(db, osId).protocolo };
}

export function registrarCronico(db, usuario, dados, agora) {
  exigirPapel(usuario, ...PAPEIS_INSPECAO, 'diretoria');
  let { quarto_id, equipamento_id = null, categoria, descricao } = dados;
  let itemId = null;
  let origem = dados.origem || 'manual';
  if (dados.inspecao_item_id) {
    const it = buscarItem(db, usuario, dados.inspecao_item_id);
    exigir(!it.cronico_id, 'Este item já foi registrado como problema crônico.');
    quarto_id = it.quarto_id; equipamento_id = it.equipamento_id; categoria = it.categoria;
    descricao = texto(descricao) || `${it.ambiente}: ${it.item} — desgaste identificado em inspeção.${it.observacao ? ` ${it.observacao}` : ''}`;
    itemId = it.id; origem = 'inspecao';
  }
  const q = buscarQuarto(db, Number(quarto_id));
  exigirHotel(usuario, q.hotel_id);
  exigir(CATEGORIAS[categoria], 'Categoria inválida.');
  exigir(texto(descricao), 'Descreva o problema crônico.');
  const r = exec(db, `INSERT INTO problemas_cronicos (hotel_id, quarto_id, equipamento_id, categoria, descricao, origem, inspecao_item_id, criado_por, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, q.hotel_id, q.id, equipamento_id || null, categoria, texto(descricao), origem, itemId, usuario.id, agoraIso(agora));
  const id = Number(r.lastInsertRowid);
  if (itemId) exec(db, 'UPDATE inspecao_itens SET cronico_id = ? WHERE id = ?', id, itemId);
  registrarHistorico(db, { quarto_id: q.id, tipo: 'cronico', descricao: `Problema crônico registrado: ${texto(descricao)}`, usuario_id: usuario.id, agora });
  return id;
}

export function resolverCronico(db, usuario, id, agora) {
  exigirPapel(usuario, 'gerente', 'admin', 'manutencao_chefe', 'diretoria');
  const c = um(db, 'SELECT * FROM problemas_cronicos WHERE id = ?', Number(id));
  exigir(c, 'Problema crônico não encontrado.', 404);
  exigirHotel(usuario, c.hotel_id);
  exec(db, "UPDATE problemas_cronicos SET status = 'resolvido', resolvido_em = ? WHERE id = ?", agoraIso(agora), c.id);
  registrarHistorico(db, { quarto_id: c.quarto_id, tipo: 'cronico', descricao: `Problema crônico resolvido: ${c.descricao}`, usuario_id: usuario.id, agora });
}

export function calcularPontuacao(itens) {
  const peso = { conforme: 1, atencao: 0.5, manutencao: 0 };
  const aplicaveis = itens.filter((i) => i.resposta && i.resposta !== 'na');
  if (!aplicaveis.length) return { pontuacao: null, estrelas: null };
  const pontuacao = (aplicaveis.reduce((s, i) => s + peso[i.resposta], 0) / aplicaveis.length) * 100;
  const estrelas = pontuacao >= 95 ? 5 : pontuacao >= 85 ? 4 : pontuacao >= 70 ? 3 : pontuacao >= 50 ? 2 : 1;
  return { pontuacao: Math.round(pontuacao * 10) / 10, estrelas };
}

export function concluir(db, usuario, id, dados = {}, agora) {
  exigirPapel(usuario, ...PAPEIS_INSPECAO);
  const ins = um(db, 'SELECT * FROM inspecoes WHERE id = ?', Number(id));
  exigir(ins, 'Inspeção não encontrada.', 404);
  exigirHotel(usuario, ins.hotel_id);
  exigir(ins.status === 'em_andamento', 'Inspeção já concluída.');
  const itens = todos(db, 'SELECT * FROM inspecao_itens WHERE inspecao_id = ? ORDER BY ordem', ins.id);
  const pend = itens.filter((i) => !i.resposta);
  exigir(!pend.length, `Responda todos os itens antes de concluir (${pend.length} pendente(s)).`);

  // Automático: item básico com "necessita de manutenção" vira OS e bloqueia o quarto para venda;
  // item não básico com pendência vira problema crônico (depende de ocupação/budget).
  const geradas = [];
  const cronicos = [];
  if (dados.gerar_os_automaticas && itens.some((i) => i.critico)) {
    for (const it of itens.filter((i) => i.resposta === 'manutencao' && i.critico && !i.os_id)) {
      geradas.push(gerarOS(db, usuario, it.id, { bloqueio_quarto: true }, agora));
    }
    for (const it of itens.filter((i) => ['atencao', 'manutencao'].includes(i.resposta) && !i.critico && !i.os_id && !i.cronico_id)) {
      cronicos.push(registrarCronico(db, usuario, { inspecao_item_id: it.id }, agora));
    }
  } else if (dados.gerar_os_automaticas) {
    // Checklist padrão (sem itens básicos marcados): toda "necessita de manutenção" vira OS.
    for (const it of itens.filter((i) => i.resposta === 'manutencao' && !i.os_id)) geradas.push(gerarOS(db, usuario, it.id, {}, agora));
  }
  const { pontuacao, estrelas } = calcularPontuacao(itens);
  const now = agoraIso(agora);
  exec(db, "UPDATE inspecoes SET status = 'concluida', pontuacao = ?, estrelas = ?, observacoes = ?, concluida_em = ? WHERE id = ?",
    pontuacao, estrelas, texto(dados.observacoes) || null, now, ins.id);
  const q = buscarQuarto(db, ins.quarto_id);
  exec(db, `UPDATE quartos SET ultima_inspecao_em = ?, proxima_inspecao_em = ?, alerta_inspecao_enviado_em = NULL
    ${estrelas ? ', estrelas = ?' : ''} WHERE id = ?`, now, somarDias(now, q.periodicidade_inspecao_dias), ...(estrelas ? [estrelas] : []), q.id);
  const reprovados = itens.filter((i) => ['atencao', 'manutencao'].includes(i.resposta)).length;
  registrarHistorico(db, {
    quarto_id: q.id, tipo: 'inspecao', inspecao_id: ins.id, usuario_id: usuario.id, agora,
    descricao: `Inspeção concluída: ${pontuacao ?? '—'}% de conformidade${estrelas ? ` (${estrelas} estrela${estrelas > 1 ? 's' : ''})` : ''}, ${reprovados} item(ns) com pendência.`,
  });
  return { pontuacao, estrelas, geradas, cronicos: cronicos.length };
}

export function detalhe(db, usuario, id) {
  const ins = um(db, `SELECT i.*, q.numero AS quarto_numero, h.nome AS hotel_nome, u.nome AS inspetor_nome
    FROM inspecoes i JOIN quartos q ON q.id = i.quarto_id JOIN hoteis h ON h.id = i.hotel_id JOIN usuarios u ON u.id = i.inspetor_id
    WHERE i.id = ?`, Number(id));
  exigir(ins, 'Inspeção não encontrada.', 404);
  exigirHotel(usuario, ins.hotel_id);
  ins.itens = todos(db, `SELECT it.*, o.protocolo AS os_protocolo, o.status AS os_status, e.tipo AS equipamento_tipo
    FROM inspecao_itens it LEFT JOIN ordens_servico o ON o.id = it.os_id LEFT JOIN equipamentos e ON e.id = it.equipamento_id
    WHERE it.inspecao_id = ? ORDER BY it.ordem`, ins.id);
  const fotos = todos(db, 'SELECT id, inspecao_item_id, arquivo, mime, legenda, criado_em FROM fotos WHERE inspecao_id = ? ORDER BY id', ins.id);
  for (const it of ins.itens) it.fotos = fotos.filter((f) => f.inspecao_item_id === it.id);
  ins.parcial = calcularPontuacao(ins.itens);
  ins.fotos_padrao = listarPadrao(db, ins.quarto_id);
  return ins;
}

export function listar(db, usuario, filtros = {}, agora) {
  const now = agoraIso(agora);
  const f = filtroHotel(usuario, 'i.hotel_id', filtros.hotel_id);
  const inspecoes = todos(db, `SELECT i.id, i.status, i.pontuacao, i.estrelas, i.iniciada_em, i.concluida_em, i.quarto_id,
      q.numero AS quarto_numero, h.nome AS hotel_nome, u.nome AS inspetor_nome,
      (SELECT COUNT(*) FROM inspecao_itens it WHERE it.inspecao_id = i.id AND it.resposta IN ('atencao', 'manutencao')) AS pendencias,
      (SELECT COUNT(*) FROM inspecao_itens it WHERE it.inspecao_id = i.id AND it.resposta IS NULL) AS sem_resposta
    FROM inspecoes i JOIN quartos q ON q.id = i.quarto_id JOIN hoteis h ON h.id = i.hotel_id JOIN usuarios u ON u.id = i.inspetor_id
    WHERE 1 = 1 ${f.sql} ORDER BY i.status = 'concluida', i.iniciada_em DESC LIMIT 200`, ...f.params);
  const fq = filtroHotel(usuario, 'q.hotel_id', filtros.hotel_id);
  const agenda = todos(db, `SELECT q.id, q.numero, q.hotel_id, h.nome AS hotel_nome, q.periodicidade_inspecao_dias, q.ultima_inspecao_em,
      q.proxima_inspecao_em, q.estrelas,
      (SELECT id FROM inspecoes WHERE quarto_id = q.id AND status = 'em_andamento') AS inspecao_aberta
    FROM quartos q JOIN hoteis h ON h.id = q.hotel_id
    WHERE q.proxima_inspecao_em <= ? ${fq.sql} ORDER BY q.proxima_inspecao_em`, somarDias(now, 7), ...fq.params);
  for (const a of agenda) a.vencida = a.proxima_inspecao_em < now;
  return { inspecoes, agenda };
}

// ---- Checklist configurável por hotel ----

// Cada hotel tem a SUA lista de itens (linhas próprias em checklist_modelo, por hotel_id):
// incluir, desativar ou excluir um item afeta apenas aquele hotel. Hotéis que nunca tiveram
// checklist próprio usam o padrão do sistema; depois de personalizado, nunca volta ao padrão sozinho.
const marcaPersonalizado = (hotelId) => `checklist_personalizado:${hotelId}`;
const temChecklistProprio = (db, hotelId) =>
  lerConfig(db, marcaPersonalizado(hotelId)) === '1' || !!um(db, 'SELECT 1 AS x FROM checklist_modelo WHERE hotel_id = ? LIMIT 1', hotelId);

export function checklistDoHotel(db, hotelId, { incluirInativos = false } = {}) {
  const itens = todos(db, `SELECT * FROM checklist_modelo WHERE hotel_id = ? ${incluirInativos ? '' : 'AND ativo = 1'} ORDER BY ordem, id`, hotelId);
  if (temChecklistProprio(db, hotelId)) return { personalizado: true, itens };
  if (incluirInativos) return { personalizado: false, itens: [] };
  return { personalizado: false, itens: CHECKLIST_PADRAO.map((c) => ({ ...c, critico: 0 })) };
}

export function definirChecklist(db, hotelId, itens) {
  gravarConfig(db, marcaPersonalizado(hotelId), '1');
  exec(db, 'DELETE FROM checklist_modelo WHERE hotel_id = ?', hotelId);
  const st = db.prepare('INSERT INTO checklist_modelo (hotel_id, ordem, ambiente, item, categoria, local, equipamento, critico) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  itens.forEach((c, i) => st.run(hotelId, i + 1, c.ambiente, c.item, c.categoria, c.local, c.equipamento || null, c.critico ? 1 : 0));
}

export function adicionarItemChecklist(db, usuario, dados) {
  exigirPapel(usuario, 'admin', 'gerente');
  const hotelId = Number(dados.hotel_id || usuario.hotel_id);
  exigirHotel(usuario, hotelId);
  exigir(texto(dados.item), 'Informe o item.');
  exigir(texto(dados.ambiente), 'Informe o grupo/ambiente.');
  exigir(CATEGORIAS[dados.categoria], 'Categoria inválida.');
  exigir(um(db, 'SELECT id FROM hoteis WHERE id = ?', hotelId), 'Hotel não encontrado.', 404);
  gravarConfig(db, marcaPersonalizado(hotelId), '1');
  const ordem = (todos(db, 'SELECT MAX(ordem) AS m FROM checklist_modelo WHERE hotel_id = ?', hotelId)[0].m || 0) + 1;
  const r = exec(db, 'INSERT INTO checklist_modelo (hotel_id, ordem, ambiente, item, categoria, local, equipamento, critico) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    hotelId, ordem, texto(dados.ambiente), texto(dados.item), dados.categoria, texto(dados.local) || 'quarto', texto(dados.equipamento) || null, dados.critico ? 1 : 0);
  return Number(r.lastInsertRowid);
}

export function alternarItemChecklist(db, usuario, id) {
  exigirPapel(usuario, 'admin', 'gerente');
  const it = um(db, 'SELECT * FROM checklist_modelo WHERE id = ?', Number(id));
  exigir(it, 'Item não encontrado.', 404);
  exigirHotel(usuario, it.hotel_id);
  exec(db, 'UPDATE checklist_modelo SET ativo = 1 - ativo WHERE id = ?', it.id);
}

// Exclui o item do checklist DESTE hotel. Inspeções já feitas guardam a própria cópia dos itens
// (inspecao_itens), então o histórico não é afetado; inspeções em andamento também não.
export function excluirItemChecklist(db, usuario, id) {
  exigirPapel(usuario, 'admin', 'gerente');
  const it = um(db, 'SELECT * FROM checklist_modelo WHERE id = ?', Number(id));
  exigir(it, 'Item não encontrado.', 404);
  exigirHotel(usuario, it.hotel_id);
  gravarConfig(db, marcaPersonalizado(it.hotel_id), '1');
  exec(db, 'DELETE FROM checklist_modelo WHERE id = ?', it.id);
}
