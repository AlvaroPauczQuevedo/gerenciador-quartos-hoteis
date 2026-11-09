// Estoque de materiais por hotel: entradas (compra, com fornecedor e custo), saídas vinculadas às OS
// (que lançam o custo na OS automaticamente) e ajustes de inventário. Alerta quando atinge o mínimo.
import { todos, um, exec } from '../db.js';
import { agoraIso, exigir, exigirHotel, exigirPapel, filtroHotel, texto } from './comum.js';
import { notificar, equipeManutencao, gerentesDoHotel } from './notificacoes.js';

const GESTORES = ['admin', 'gerente', 'manutencao_chefe'];
const arred = (n) => Math.round(Number(n) * 1000) / 1000;

function buscarItem(db, usuario, id) {
  const it = um(db, 'SELECT * FROM estoque_itens WHERE id = ?', Number(id));
  exigir(it, 'Item de estoque não encontrado.', 404);
  exigirHotel(usuario, it.hotel_id);
  return it;
}

export function listar(db, usuario, { hotel_id, todos: incluirInativos } = {}) {
  const f = filtroHotel(usuario, 'i.hotel_id', hotel_id);
  return todos(db, `SELECT i.*, h.nome AS hotel_nome, (i.quantidade <= i.minimo AND i.minimo > 0) AS abaixo_minimo,
      (SELECT MAX(m.criado_em) FROM estoque_movimentos m WHERE m.item_id = i.id) AS ultimo_movimento
    FROM estoque_itens i JOIN hoteis h ON h.id = i.hotel_id
    WHERE 1 = 1 ${f.sql} ${incluirInativos ? '' : 'AND i.ativo = 1'} ORDER BY h.nome, abaixo_minimo DESC, i.nome`, ...f.params);
}

export function movimentos(db, usuario, itemId) {
  const it = buscarItem(db, usuario, itemId);
  return todos(db, `SELECT m.*, u.nome AS usuario_nome, o.protocolo FROM estoque_movimentos m
    LEFT JOIN usuarios u ON u.id = m.usuario_id LEFT JOIN ordens_servico o ON o.id = m.os_id
    WHERE m.item_id = ? ORDER BY m.criado_em DESC, m.id DESC LIMIT 200`, it.id);
}

export function salvarItem(db, usuario, dados) {
  exigirPapel(usuario, ...GESTORES);
  const nome = texto(dados.nome);
  exigir(nome, 'Informe o nome do material.');
  const minimo = Number(dados.minimo || 0);
  exigir(minimo >= 0, 'Estoque mínimo inválido.');
  if (dados.id) {
    const it = buscarItem(db, usuario, dados.id);
    exec(db, 'UPDATE estoque_itens SET nome = ?, unidade = ?, minimo = ?, fornecedor = ?, ativo = ? WHERE id = ?',
      nome, texto(dados.unidade) || it.unidade, minimo, texto(dados.fornecedor) || null, dados.ativo === false ? 0 : 1, it.id);
    return it.id;
  }
  const hotelId = Number(dados.hotel_id || usuario.hotel_id);
  exigir(hotelId, 'Informe o hotel.');
  exigirHotel(usuario, hotelId);
  exigir(!um(db, 'SELECT id FROM estoque_itens WHERE hotel_id = ? AND nome = ?', hotelId, nome), 'Já existe um material com este nome neste hotel.');
  const r = exec(db, 'INSERT INTO estoque_itens (hotel_id, nome, unidade, minimo, custo_unitario, fornecedor) VALUES (?, ?, ?, ?, ?, ?)',
    hotelId, nome, texto(dados.unidade) || 'un', minimo, Number(dados.custo_unitario) || 0, texto(dados.fornecedor) || null);
  return Number(r.lastInsertRowid);
}

function verificarMinimo(db, item, agora) {
  const atual = um(db, 'SELECT * FROM estoque_itens WHERE id = ?', item.id);
  if (atual.minimo > 0 && atual.quantidade <= atual.minimo) {
    if (!atual.alerta_minimo_em) {
      notificar(db, [...equipeManutencao(db, atual.hotel_id), ...gerentesDoHotel(db, atual.hotel_id)], {
        tipo: 'materiais', agora,
        mensagem: `Estoque baixo: ${atual.nome} — restam ${arred(atual.quantidade)} ${atual.unidade} (mínimo ${arred(atual.minimo)}).`,
      });
      exec(db, 'UPDATE estoque_itens SET alerta_minimo_em = ? WHERE id = ?', agoraIso(agora), atual.id);
    }
  } else if (atual.alerta_minimo_em) {
    exec(db, 'UPDATE estoque_itens SET alerta_minimo_em = NULL WHERE id = ?', atual.id);
  }
}

// tipo: entrada (soma, atualiza custo médio) | saida (subtrai) | ajuste (define a quantidade contada no inventário)
export function movimentar(db, usuario, itemId, dados, agora) {
  exigirPapel(usuario, ...GESTORES, 'tecnico');
  const it = buscarItem(db, usuario, itemId);
  const tipo = dados.tipo;
  exigir(['entrada', 'saida', 'ajuste'].includes(tipo), 'Tipo de movimentação inválido.');
  if (tipo !== 'saida') exigirPapel(usuario, ...GESTORES);
  const qtd = arred(dados.quantidade);
  exigir(tipo === 'ajuste' ? qtd >= 0 : qtd > 0, 'Informe uma quantidade válida.');
  let nova;
  let custo = it.custo_unitario;
  if (tipo === 'entrada') {
    const unit = Number(dados.custo_unitario);
    if (unit > 0) custo = arred((it.quantidade * it.custo_unitario + qtd * unit) / (it.quantidade + qtd)); // custo médio
    nova = arred(it.quantidade + qtd);
  } else if (tipo === 'saida') {
    exigir(qtd <= it.quantidade, `Estoque insuficiente: há ${arred(it.quantidade)} ${it.unidade} de ${it.nome}.`);
    nova = arred(it.quantidade - qtd);
  } else {
    exigir(texto(dados.observacao), 'Informe o motivo do ajuste (ex.: contagem de inventário).');
    nova = qtd;
  }
  exec(db, 'UPDATE estoque_itens SET quantidade = ?, custo_unitario = ?, fornecedor = COALESCE(?, fornecedor) WHERE id = ?',
    nova, custo, texto(dados.fornecedor) || null, it.id);
  exec(db, `INSERT INTO estoque_movimentos (item_id, tipo, quantidade, custo_unitario, fornecedor, os_id, observacao, usuario_id, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, it.id, tipo, tipo === 'ajuste' ? arred(qtd - it.quantidade) : qtd,
  tipo === 'entrada' ? Number(dados.custo_unitario) || null : custo, texto(dados.fornecedor) || null, dados.os_id || null,
  texto(dados.observacao) || null, usuario.id, agoraIso(agora));
  verificarMinimo(db, it, agora);
  return { item: um(db, 'SELECT * FROM estoque_itens WHERE id = ?', it.id), valor: arred(qtd * custo), custo_unitario: custo };
}
