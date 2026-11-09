// Central de ordens de serviço (seções 15 e 20): abertura, fluxo de vida, distribuição,
// validação e rastreabilidade completa (quem abriu, recebeu, executou e validou).
import { todos, um, exec } from '../db.js';
import {
  CATEGORIAS, LOCAIS, PRIORIDADES, IMPACTOS, STATUS, STATUS_FINAIS, STATUS_ENTREGUES, SLA_HORAS, TIPOS_CUSTO,
} from './constantes.js';
import {
  agoraIso, somarHoras, exigir, falha, exigirHotel, filtroHotel, normalizarData, texto, buscarQuarto, podeVerHotel,
} from './comum.js';
import {
  notificar, equipeManutencao, gerentesDoHotel, aprovadoresDoHotel, usuariosDoHotel,
} from './notificacoes.js';
import * as quartos from './quartos.js';
import * as estoque from './estoque.js';
import { ocorrenciasRelacionadas } from './recorrencia.js';
import { listarPadrao } from './fotos.js';

const ENTREGUES_SQL = STATUS_ENTREGUES.map((s) => `'${s}'`).join(',');
const FINAIS_SQL = STATUS_FINAIS.map((s) => `'${s}'`).join(',');

// ---------- utilitários ----------

const ORIGENS = ['manual', 'inspecao', 'preventiva', 'hospede'];

export function gerarProtocolo(db, agora) {
  const ano = new Date(agoraIso(agora)).getUTCFullYear();
  exec(db, 'INSERT INTO protocolos (ano, ultimo) VALUES (?, 1) ON CONFLICT(ano) DO UPDATE SET ultimo = ultimo + 1', ano);
  const { ultimo } = um(db, 'SELECT ultimo FROM protocolos WHERE ano = ?', ano);
  return `OS-${ano}-${String(ultimo).padStart(5, '0')}`;
}

export function buscar(db, id) {
  const os = um(db, 'SELECT * FROM ordens_servico WHERE id = ?', Number(id));
  exigir(os, 'Ordem de serviço não encontrada.', 404);
  return os;
}

function evento(db, os, usuario, tipo, { texto: t = null, de = null, para = null, agora } = {}) {
  exec(
    db,
    'INSERT INTO os_eventos (os_id, usuario_id, tipo, status_de, status_para, texto, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
    os.id, usuario ? usuario.id : null, tipo, de, para, t, agoraIso(agora)
  );
  exec(db, 'UPDATE ordens_servico SET atualizado_em = ? WHERE id = ?', agoraIso(agora), os.id);
}

function atualizar(db, os, campos) {
  const chaves = Object.keys(campos);
  if (!chaves.length) return;
  exec(db, `UPDATE ordens_servico SET ${chaves.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...chaves.map((k) => campos[k]), os.id);
  Object.assign(os, campos);
}

function mudarStatus(db, os, usuario, para, { texto: t = null, campos = {}, agora } = {}) {
  const de = os.status;
  atualizar(db, os, { ...campos, status: para, atualizado_em: agoraIso(agora) });
  evento(db, os, usuario, 'status', { de, para, texto: t, agora });
}

const rotulo = (os) => `${os.protocolo} — ${os.titulo}`;
const participantes = (os) => [os.aberto_por, os.recebido_por, os.responsavel_id];
const estaAtrasada = (os, now) => !STATUS_ENTREGUES.includes(os.status) && !!os.prazo_previsto && os.prazo_previsto < now;

// ---------- perfis ----------

// Quem coordena a manutenção do hotel: o gerente da unidade (ou a administração da rede).
const ehManutencao = (u, os) => ((u.papel === 'gerente' && Number(u.hotel_id) === Number(os.hotel_id)) || u.papel === 'admin') && podeVerHotel(u, os.hotel_id);
const ehAprovador = (u, os) => ['diretoria', 'admin'].includes(u.papel) && podeVerHotel(u, os.hotel_id);
// Alçada: orçamentos até o limite configurado para o hotel podem ser aprovados pelo gerente da unidade.
const limiteGerente = (db, hotelId) => Number(um(db, 'SELECT limite_aprovacao_gerente AS l FROM hoteis WHERE id = ?', hotelId)?.l || 0);
function podeDecidirOrcamento(db, u, os) {
  const pendente = um(db, "SELECT valor FROM aprovacoes WHERE os_id = ? AND status = 'pendente'", os.id);
  if (!pendente) return false;
  if (ehAprovador(u, os)) return true;
  const limite = limiteGerente(db, os.hotel_id);
  return u.papel === 'gerente' && Number(u.hotel_id) === Number(os.hotel_id) && limite > 0 && pendente.valor <= limite;
}
const ehValidador = (u, os) =>
  (u.papel === 'gerente' && Number(u.hotel_id) === Number(os.hotel_id)) || u.papel === 'admin' || u.id === os.aberto_por;

function ehExecutor(db, u, os) {
  if (ehManutencao(u, os)) return true;
  if (os.responsavel_id === u.id) return true;
  return !!um(db, 'SELECT 1 AS x FROM os_tarefas WHERE os_id = ? AND tecnico_id = ?', os.id, u.id);
}

function validarTecnico(db, os, id) {
  const t = um(db, 'SELECT * FROM usuarios WHERE id = ? AND ativo = 1', Number(id));
  exigir(t && t.papel === 'tecnico', 'Profissional de manutenção inválido.');
  exigir(t.hotel_id == null || Number(t.hotel_id) === Number(os.hotel_id), 'O profissional não atende esta unidade.');
  return t;
}

// ---------- abertura (15.1) ----------

export function criar(db, usuario, dados, agora) {
  exigir(['gerente', 'governanta', 'admin'].includes(usuario.papel),
    'Seu perfil não pode abrir solicitações de manutenção.', 403);
  const hotelId = Number(dados.hotel_id || usuario.hotel_id);
  exigir(hotelId, 'Informe o hotel de origem.');
  exigirHotel(usuario, hotelId);
  const hotel = um(db, 'SELECT * FROM hoteis WHERE id = ?', hotelId);
  exigir(hotel, 'Hotel não encontrado.', 404);

  let quartoId = dados.quarto_id ? Number(dados.quarto_id) : null;
  if (quartoId) {
    const q = buscarQuarto(db, quartoId);
    exigir(q.hotel_id === hotelId, 'O quarto informado não pertence ao hotel de origem.');
  }
  let equipamentoId = dados.equipamento_id ? Number(dados.equipamento_id) : null;
  if (equipamentoId) {
    const e = um(db, 'SELECT * FROM equipamentos WHERE id = ?', equipamentoId);
    exigir(e && e.quarto_id === quartoId, 'Equipamento não pertence ao quarto informado.');
  }

  const local = texto(dados.local);
  const categoria = texto(dados.categoria);
  const prioridade = texto(dados.prioridade);
  const descricao = texto(dados.descricao);
  exigir(LOCAIS[local], 'Informe o local do problema.');
  exigir(CATEGORIAS[categoria], 'Informe uma categoria válida.');
  exigir(PRIORIDADES[prioridade], 'Informe o grau de prioridade.');
  exigir(descricao.length >= 10, 'Descreva o problema com mais detalhes (mínimo de 10 caracteres).');
  if (dados.impacto) exigir(IMPACTOS[dados.impacto], 'Impacto inválido.');
  const bloqueio = !!dados.bloqueio_quarto;
  exigir(!bloqueio || quartoId, 'O bloqueio só pode ser solicitado quando há um quarto informado.');

  const now = agoraIso(agora);
  const prazoDesejado = normalizarData(dados.prazo_desejado);
  const prazoPrevisto = prazoDesejado || somarHoras(now, SLA_HORAS[prioridade]);
  const titulo = texto(dados.titulo) || `${CATEGORIAS[categoria]} — ${LOCAIS[local]}${quartoId ? ` (quarto ${buscarQuarto(db, quartoId).numero})` : ''}`;

  const r = exec(
    db,
    `INSERT INTO ordens_servico (protocolo, hotel_id, quarto_id, equipamento_id, local, categoria, titulo, descricao,
      prioridade, prioridade_original, identificado_em, justificativa, impacto, bloqueio_quarto, prazo_desejado,
      prazo_previsto, observacoes, status, origem, inspecao_item_id, os_origem_id, exige_validacao, aberto_por,
      criado_em, atualizado_em, plano_preventiva_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nova', ?, ?, ?, ?, ?, ?, ?, ?)`,
    gerarProtocolo(db, now), hotelId, quartoId, equipamentoId, local, categoria, titulo, descricao,
    prioridade, prioridade, normalizarData(dados.identificado_em) || now, texto(dados.justificativa) || null,
    texto(dados.impacto) || null, bloqueio ? 1 : 0, prazoDesejado, prazoPrevisto, texto(dados.observacoes) || null,
    ORIGENS.includes(dados.origem) ? dados.origem : 'manual', dados.inspecao_item_id || null, dados.os_origem_id || null,
    hotel.exige_validacao, usuario.id, now, now, dados.plano_preventiva_id || null
  );
  const os = buscar(db, Number(r.lastInsertRowid));
  evento(db, os, usuario, 'abertura', {
    para: 'nova', agora,
    texto: `Solicitação aberta com prioridade ${PRIORIDADES[prioridade]}.${{ inspecao: ' Origem: inspeção periódica.', preventiva: ' Origem: manutenção preventiva programada.', hospede: ' Origem: avaliação/reclamação de hóspede.' }[os.origem] || ''}`,
  });

  // Integração 6: necessidade de indisponibilidade bloqueia o quarto até liberação autorizada.
  if (bloqueio) quartos.bloquear(db, usuario, quartoId, { motivo: `${os.protocolo}: ${titulo}`, os_id: os.id, agora });

  // Preventivas são geradas em lote pelo agendador, que envia um único aviso por plano (sem alerta de recorrência).
  if (os.origem === 'preventiva') return os.id;

  // Integração 4: equipe de manutenção recebe notificação. Emergenciais alertam também técnicos e gerentes.
  const destinatarios = equipeManutencao(db, hotelId);
  if (prioridade === 'emergencial') destinatarios.push(...usuariosDoHotel(db, hotelId, ['tecnico']), ...gerentesDoHotel(db, hotelId));
  notificar(db, destinatarios, {
    tipo: 'nova_demanda', os_id: os.id, quarto_id: quartoId, excluir: usuario.id, agora,
    mensagem: `${prioridade === 'emergencial' ? '[EMERGENCIAL] ' : ''}Nova demanda ${rotulo(os)} — ${hotel.nome}`,
  });

  // Integração 5: problema que se repete gera alerta gerencial.
  if (quartoId) {
    const anteriores = ocorrenciasRelacionadas(db, { quarto_id: quartoId, equipamento_id: equipamentoId, categoria, excluir_id: os.id, agora });
    if (anteriores.length >= 1) {
      atualizar(db, os, { recorrente: 1 });
      const alvo = equipamentoId ? um(db, 'SELECT tipo FROM equipamentos WHERE id = ?', equipamentoId).tipo : CATEGORIAS[categoria];
      const msg = `Recorrência: ${anteriores.length + 1}ª ocorrência de "${alvo}" no quarto ${buscarQuarto(db, quartoId).numero} nos últimos 12 meses (${os.protocolo}). Recomenda-se avaliação aprofundada.`;
      evento(db, os, null, 'recorrencia', { texto: msg, agora });
      notificar(db, [...gerentesDoHotel(db, hotelId), ...equipeManutencao(db, hotelId), ...(anteriores.length >= 2 ? usuariosDoHotel(db, hotelId, ['diretoria']) : [])], {
        tipo: 'recorrencia', mensagem: msg, os_id: os.id, quarto_id: quartoId, agora,
      });
    }
  }
  return os.id;
}

// ---------- ações do fluxo (15.4 a 15.6) ----------

const NAO_FINAL = (os) => !STATUS_FINAIS.includes(os.status);
const ATIVA = (os) => !STATUS_ENTREGUES.includes(os.status);
const EMERG = (os) => os.prioridade === 'emergencial';

export const ACOES = {
  receber: {
    rotulo: 'Receber demanda',
    pode: (db, u, os) => os.status === 'nova' && ehManutencao(u, os),
    exec(db, u, os, d, agora) {
      mudarStatus(db, os, u, 'em_avaliacao', { campos: { recebido_por: u.id, recebido_em: agoraIso(agora) }, texto: texto(d.texto) || 'Demanda recebida pela manutenção.', agora });
      notificar(db, [os.aberto_por], { tipo: 'recebida', mensagem: `${rotulo(os)} foi recebida por ${u.nome}.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  assumir: {
    rotulo: 'Assumir demanda',
    pode: (db, u, os) => {
      if (os.responsavel_id === u.id || !ATIVA(os) || ['devolvida_complementacao'].includes(os.status)) return false;
      return u.papel === 'tecnico' && podeVerHotel(u, os.hotel_id) && !os.responsavel_id &&
        (['aprovada', 'em_correcao'].includes(os.status) || EMERG(os));
    },
    exec(db, u, os, d, agora) {
      const campos = { responsavel_id: u.id };
      if (!os.recebido_por) Object.assign(campos, { recebido_por: u.id, recebido_em: agoraIso(agora) });
      if (os.status === 'nova') mudarStatus(db, os, u, 'em_avaliacao', { campos, texto: 'Demanda recebida.', agora });
      else atualizar(db, os, campos);
      evento(db, os, u, 'designacao', { texto: `${u.nome} assumiu a demanda.`, agora });
      notificar(db, [os.aberto_por], { tipo: 'designacao', mensagem: `${u.nome} assumiu ${rotulo(os)}.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  aceitar: {
    rotulo: 'Aceitar e designar técnico',
    pode: (db, u, os) => ['nova', 'em_avaliacao'].includes(os.status) && ehManutencao(u, os),
    exec(db, u, os, d, agora) {
      const campos = os.recebido_por ? {} : { recebido_por: u.id, recebido_em: agoraIso(agora) };
      if (d.prazo_previsto) campos.prazo_previsto = normalizarData(d.prazo_previsto);
      if (d.responsavel_id) campos.responsavel_id = validarTecnico(db, os, d.responsavel_id).id;
      mudarStatus(db, os, u, 'aprovada', { campos, texto: texto(d.texto) || 'Solicitação aceita pela manutenção.', agora });
      notificar(db, [os.aberto_por], { tipo: 'aprovada', mensagem: `${rotulo(os)} foi aceita pela manutenção.`, os_id: os.id, excluir: u.id, agora });
      if (campos.responsavel_id) notificarDesignacao(db, u, os, campos.responsavel_id, agora);
      else notificar(db, usuariosDoHotel(db, os.hotel_id, ['tecnico']), { tipo: 'designacao', mensagem: `${rotulo(os)} está disponível para ser assumida.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  devolver: {
    rotulo: 'Devolver para complementação',
    exigeTexto: true,
    pode: (db, u, os) => ['nova', 'em_avaliacao'].includes(os.status) && ehManutencao(u, os),
    exec(db, u, os, d, agora) {
      mudarStatus(db, os, u, 'devolvida_complementacao', { campos: { recebido_por: os.recebido_por || u.id, recebido_em: os.recebido_em || agoraIso(agora) }, texto: d.texto, agora });
      notificar(db, [os.aberto_por], { tipo: 'devolvida', mensagem: `${rotulo(os)} foi devolvida para complementação: ${d.texto}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  complementar: {
    rotulo: 'Enviar complementação',
    exigeTexto: true,
    pode: (db, u, os) => os.status === 'devolvida_complementacao' && ehValidador(u, os),
    exec(db, u, os, d, agora) {
      const campos = {};
      if (texto(d.descricao)) campos.descricao = texto(d.descricao);
      mudarStatus(db, os, u, 'em_avaliacao', { campos, texto: `Complementação: ${d.texto}`, agora });
      notificar(db, [os.recebido_por, ...equipeManutencao(db, os.hotel_id)], { tipo: 'nova_demanda', mensagem: `${rotulo(os)} foi complementada pelo solicitante.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  recusar: {
    rotulo: 'Recusar solicitação',
    exigeTexto: true,
    pode: (db, u, os) => ['nova', 'em_avaliacao'].includes(os.status) && ehManutencao(u, os),
    exec(db, u, os, d, agora) {
      mudarStatus(db, os, u, 'recusada', { campos: { encerrado_em: agoraIso(agora), recebido_por: os.recebido_por || u.id }, texto: d.texto, agora });
      notificar(db, [os.aberto_por], { tipo: 'recusada', mensagem: `${rotulo(os)} foi recusada: ${d.texto}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  solicitar_orcamento: {
    rotulo: 'Informar necessidade de orçamento',
    exigeTexto: true,
    pode: (db, u, os) => ['em_avaliacao', 'aprovada', 'em_execucao', 'aguardando_materiais'].includes(os.status) && ehExecutor(db, u, os),
    exec(db, u, os, d, agora) {
      mudarStatus(db, os, u, 'aguardando_orcamento', { texto: d.texto, agora });
      notificar(db, [os.aberto_por, ...equipeManutencao(db, os.hotel_id)], { tipo: 'orcamento', mensagem: `${rotulo(os)} aguarda orçamento: ${d.texto}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  enviar_aprovacao: {
    rotulo: 'Encaminhar orçamento para aprovação financeira',
    pode: (db, u, os) => ['em_avaliacao', 'aguardando_orcamento', 'aprovada', 'em_execucao', 'aguardando_materiais'].includes(os.status) && ehManutencao(u, os) &&
      !um(db, "SELECT 1 AS x FROM aprovacoes WHERE os_id = ? AND status = 'pendente'", os.id),
    exec(db, u, os, d, agora) {
      const valor = Number(d.valor);
      exigir(valor > 0, 'Informe o valor do orçamento.');
      exigir(texto(d.descricao), 'Descreva o orçamento.');
      // Emergenciais em execução não param: a aprovação é registrada para regularização posterior.
      const posterior = EMERG(os) && ['em_execucao', 'aguardando_materiais'].includes(os.status);
      exec(db, 'INSERT INTO aprovacoes (os_id, valor, descricao, fornecedor, posterior, solicitado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)',
        os.id, valor, texto(d.descricao), texto(d.fornecedor) || null, posterior ? 1 : 0, u.id, agoraIso(agora));
      const t = `Orçamento de ${moeda(valor)} encaminhado para aprovação${posterior ? ' (regularização posterior — atendimento emergencial)' : ''}: ${texto(d.descricao)}`;
      if (posterior) evento(db, os, u, 'orcamento', { texto: t, agora });
      else mudarStatus(db, os, u, 'aguardando_autorizacao', { texto: t, agora });
      const limite = limiteGerente(db, os.hotel_id);
      const quemAprova = limite > 0 && valor <= limite ? gerentesDoHotel(db, os.hotel_id) : aprovadoresDoHotel(db, os.hotel_id);
      notificar(db, quemAprova, { tipo: 'orcamento', mensagem: `Orçamento de ${moeda(valor)} aguarda aprovação — ${rotulo(os)}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  autorizar: {
    rotulo: 'Autorizar orçamento',
    pode: (db, u, os) => podeDecidirOrcamento(db, u, os),
    exec(db, u, os, d, agora) {
      decidirAprovacao(db, u, os, 'aprovado', d, agora);
      const t = `Orçamento autorizado por ${u.nome}.${texto(d.texto) ? ` ${texto(d.texto)}` : ''}`;
      if (os.status === 'aguardando_autorizacao') mudarStatus(db, os, u, 'aprovada', { texto: t, agora });
      else evento(db, os, u, 'orcamento', { texto: t, agora });
      notificar(db, [...participantes(os), ...equipeManutencao(db, os.hotel_id)], { tipo: 'aprovada', mensagem: `Orçamento de ${rotulo(os)} foi autorizado.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  negar: {
    rotulo: 'Recusar orçamento',
    exigeTexto: true,
    pode: (db, u, os) => podeDecidirOrcamento(db, u, os),
    exec(db, u, os, d, agora) {
      decidirAprovacao(db, u, os, 'recusado', d, agora);
      const t = `Orçamento recusado por ${u.nome}: ${d.texto}. A manutenção deve reavaliar a solicitação.`;
      if (os.status === 'aguardando_autorizacao') mudarStatus(db, os, u, 'em_avaliacao', { texto: t, agora });
      else evento(db, os, u, 'orcamento', { texto: t, agora });
      notificar(db, [...participantes(os), ...equipeManutencao(db, os.hotel_id)], { tipo: 'recusada', mensagem: `Orçamento de ${rotulo(os)} foi recusado: ${d.texto}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  designar: {
    rotulo: 'Designar profissional',
    pode: (db, u, os) => ATIVA(os) && ehManutencao(u, os),
    exec(db, u, os, d, agora) {
      const t = validarTecnico(db, os, d.responsavel_id);
      const campos = { responsavel_id: t.id };
      if (!os.recebido_por) Object.assign(campos, { recebido_por: u.id, recebido_em: agoraIso(agora) });
      atualizar(db, os, campos);
      notificarDesignacao(db, u, os, t.id, agora);
    },
  },
  definir_prazo: {
    rotulo: 'Definir prazo de atendimento',
    pode: (db, u, os) => ATIVA(os) && ehManutencao(u, os),
    exec(db, u, os, d, agora) {
      const prazo = normalizarData(d.prazo_previsto);
      exigir(prazo, 'Informe o prazo.');
      atualizar(db, os, { prazo_previsto: prazo, alerta_prazo_em: null, alerta_atraso_em: null });
      evento(db, os, u, 'prazo', { texto: `Prazo de atendimento definido para ${new Date(prazo).toLocaleString('pt-BR')}.${texto(d.texto) ? ` ${texto(d.texto)}` : ''}`, agora });
      notificar(db, [os.aberto_por, os.responsavel_id], { tipo: 'prazo_proximo', mensagem: `Prazo de ${rotulo(os)} definido para ${new Date(prazo).toLocaleString('pt-BR')}.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  reavaliar_prioridade: {
    rotulo: 'Reavaliar prioridade',
    exigeTexto: true,
    pode: (db, u, os) => ATIVA(os) && ehManutencao(u, os),
    exec(db, u, os, d, agora) {
      exigir(PRIORIDADES[d.prioridade], 'Prioridade inválida.');
      exigir(d.prioridade !== os.prioridade, 'A nova prioridade é igual à atual.');
      const de = os.prioridade;
      atualizar(db, os, { prioridade: d.prioridade });
      evento(db, os, u, 'prioridade', { texto: `Prioridade alterada de ${PRIORIDADES[de]} para ${PRIORIDADES[d.prioridade]}. Justificativa: ${d.texto}`, agora });
      notificar(db, [os.aberto_por, os.responsavel_id], { tipo: 'prioridade', mensagem: `Prioridade de ${rotulo(os)} alterada para ${PRIORIDADES[d.prioridade]}: ${d.texto}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  iniciar: {
    rotulo: 'Iniciar execução',
    pode: (db, u, os) => {
      const normal = ['aprovada', 'em_correcao'].includes(os.status);
      // Emergenciais podem iniciar a contenção sem aguardar etapas administrativas (15.6).
      const emergencial = EMERG(os) && ['nova', 'em_avaliacao', 'aguardando_orcamento', 'aguardando_autorizacao'].includes(os.status);
      if (!normal && !emergencial) return false;
      return ehExecutor(db, u, os) || (u.papel === 'tecnico' && podeVerHotel(u, os.hotel_id) && (!os.responsavel_id || EMERG(os)));
    },
    exec(db, u, os, d, agora) {
      const now = agoraIso(agora);
      const campos = { iniciado_em: os.iniciado_em || now };
      if (!os.responsavel_id) campos.responsavel_id = u.id;
      if (!os.recebido_por) Object.assign(campos, { recebido_por: u.id, recebido_em: now });
      const adm = !['aprovada', 'em_correcao'].includes(os.status);
      if (adm) exec(db, "UPDATE aprovacoes SET posterior = 1 WHERE os_id = ? AND status = 'pendente'", os.id);
      mudarStatus(db, os, u, 'em_execucao', {
        campos, agora,
        texto: adm ? 'Atendimento emergencial iniciado para contenção do problema. Etapas administrativas e validação serão regularizadas posteriormente.'
          : texto(d.texto) || (os.status === 'em_correcao' ? 'Execução da correção iniciada.' : 'Serviço em execução.'),
      });
      notificar(db, [os.aberto_por], { tipo: 'designacao', mensagem: `${rotulo(os)} entrou em execução (${u.nome}).`, os_id: os.id, excluir: u.id, agora });
    },
  },
  aguardar_materiais: {
    rotulo: 'Pausar: aguardando materiais',
    pode: (db, u, os) => os.status === 'em_execucao' && ehExecutor(db, u, os),
    exec(db, u, os, d, agora) {
      const novos = inserirMateriais(db, u, os, d.materiais, agora);
      const pend = todos(db, "SELECT descricao FROM os_materiais WHERE os_id = ? AND status = 'solicitado'", os.id);
      exigir(pend.length, 'Informe os materiais necessários.');
      mudarStatus(db, os, u, 'aguardando_materiais', { texto: `Aguardando materiais: ${pend.map((m) => m.descricao).join(', ')}.${texto(d.texto) ? ` ${texto(d.texto)}` : ''}`, agora });
      notificar(db, [...equipeManutencao(db, os.hotel_id), os.aberto_por], { tipo: 'materiais', mensagem: `${rotulo(os)} aguarda materiais${novos ? ` (${novos} item(ns) solicitado(s))` : ''}.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  solicitar_material: {
    rotulo: 'Solicitar materiais',
    pode: (db, u, os) => ATIVA(os) && ehExecutor(db, u, os),
    exec(db, u, os, d, agora) {
      const n = inserirMateriais(db, u, os, d.materiais, agora);
      exigir(n, 'Informe ao menos um material.');
      notificar(db, equipeManutencao(db, os.hotel_id), { tipo: 'materiais', mensagem: `${n} material(is) solicitado(s) para ${rotulo(os)}.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  materiais_disponiveis: {
    rotulo: 'Materiais disponíveis — retomar execução',
    pode: (db, u, os) => os.status === 'aguardando_materiais' && ehExecutor(db, u, os),
    exec(db, u, os, d, agora) {
      exec(db, "UPDATE os_materiais SET status = 'disponivel' WHERE os_id = ? AND status = 'solicitado'", os.id);
      mudarStatus(db, os, u, 'em_execucao', { texto: texto(d.texto) || 'Materiais disponíveis. Execução retomada.', agora });
    },
  },
  registrar_dificuldade: {
    rotulo: 'Registrar dificuldade',
    exigeTexto: true,
    pode: (db, u, os) => ATIVA(os) && ehExecutor(db, u, os),
    exec(db, u, os, d, agora) {
      evento(db, os, u, 'dificuldade', { texto: d.texto, agora });
      notificar(db, [...equipeManutencao(db, os.hotel_id), os.aberto_por], { tipo: 'comentario', mensagem: `Dificuldade registrada em ${rotulo(os)}: ${d.texto}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  registrar_custo: {
    rotulo: 'Registrar custo',
    pode: (db, u, os) => (NAO_FINAL(os) || os.status === 'encerrada') && ehExecutor(db, u, os),
    exec(db, u, os, d, agora) {
      exigir(TIPOS_CUSTO[d.tipo], 'Tipo de custo inválido.');
      const valor = Number(d.valor);
      exigir(valor > 0, 'Informe um valor maior que zero.');
      exigir(texto(d.descricao), 'Descreva o custo.');
      exec(db, 'INSERT INTO os_custos (os_id, tipo, descricao, valor, registrado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        os.id, d.tipo, texto(d.descricao), valor, u.id, agoraIso(agora));
      evento(db, os, u, 'custo', { texto: `Custo registrado (${TIPOS_CUSTO[d.tipo]}): ${texto(d.descricao)} — ${moeda(valor)}`, agora });
    },
  },
  baixar_estoque: {
    rotulo: 'Usar material do estoque',
    pode: (db, u, os) => (NAO_FINAL(os) || os.status === 'encerrada') && ehExecutor(db, u, os)
      && !!um(db, 'SELECT 1 AS x FROM estoque_itens WHERE hotel_id = ? AND ativo = 1 AND quantidade > 0 LIMIT 1', os.hotel_id),
    exec(db, u, os, d, agora) {
      const item = um(db, 'SELECT * FROM estoque_itens WHERE id = ?', Number(d.item_id));
      exigir(item && item.hotel_id === os.hotel_id, 'Material de estoque inválido para este hotel.');
      const r = estoque.movimentar(db, u, item.id, { tipo: 'saida', quantidade: d.quantidade, os_id: os.id, observacao: os.protocolo }, agora);
      const qtd = Number(d.quantidade);
      exec(db, 'INSERT INTO os_custos (os_id, tipo, descricao, valor, registrado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
        os.id, 'material', `${qtd} ${item.unidade} ${item.nome} (estoque)`, r.valor, u.id, agoraIso(agora));
      evento(db, os, u, 'custo', { texto: `Material do estoque: ${qtd} ${item.unidade} de ${item.nome} — ${moeda(r.valor)}. Saldo: ${r.item.quantidade} ${item.unidade}.`, agora });
    },
  },
  adicionar_tarefa: {
    rotulo: 'Distribuir atividade',
    pode: (db, u, os) => ATIVA(os) && ehManutencao(u, os),
    exec(db, u, os, d, agora) {
      exigir(texto(d.descricao), 'Descreva a atividade.');
      const t = validarTecnico(db, os, d.tecnico_id);
      exec(db, 'INSERT INTO os_tarefas (os_id, descricao, tecnico_id, criado_por, criado_em) VALUES (?, ?, ?, ?, ?)',
        os.id, texto(d.descricao), t.id, u.id, agoraIso(agora));
      evento(db, os, u, 'tarefa', { texto: `Atividade "${texto(d.descricao)}" atribuída a ${t.nome}.`, agora });
      notificar(db, [t.id], { tipo: 'designacao', mensagem: `Nova atividade em ${rotulo(os)}: ${texto(d.descricao)}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  concluir_tarefa: {
    rotulo: 'Concluir atividade',
    interna: true,
    pode: (db, u, os) => ATIVA(os) && ehExecutor(db, u, os),
    exec(db, u, os, d, agora) {
      const t = um(db, 'SELECT * FROM os_tarefas WHERE id = ? AND os_id = ?', Number(d.tarefa_id), os.id);
      exigir(t, 'Atividade não encontrada.', 404);
      exigir(t.tecnico_id === u.id || ehManutencao(u, os), 'Apenas o profissional designado pode concluir esta atividade.', 403);
      exec(db, 'UPDATE os_tarefas SET concluida = 1, concluida_em = ? WHERE id = ?', agoraIso(agora), t.id);
      evento(db, os, u, 'tarefa', { texto: `Atividade concluída: ${t.descricao}`, agora });
    },
  },
  concluir: {
    rotulo: 'Registrar conclusão',
    exigeTexto: true,
    pode: (db, u, os) => os.status === 'em_execucao' && ehExecutor(db, u, os),
    exec(db, u, os, d, agora) {
      const fotos = um(db, "SELECT COUNT(*) AS n FROM fotos WHERE os_id = ? AND fase = 'depois'", os.id).n;
      exigir(fotos > 0, 'Anexe ao menos uma fotografia do serviço concluído (fase "Após a conclusão") como evidência.');
      const now = agoraIso(agora);
      exec(db, "UPDATE os_materiais SET status = 'aplicado' WHERE os_id = ? AND status = 'disponivel'", os.id);
      const campos = { concluido_em: now, executado_por: os.responsavel_id || u.id, relatorio_conclusao: d.texto };
      mudarStatus(db, os, u, 'concluida', { campos, texto: `Serviço concluído: ${d.texto}`, agora });
      if (!os.exige_validacao) {
        encerrar(db, u, os, { texto: 'Encerrada automaticamente: a unidade não exige validação do gerente.', agora });
      } else {
        notificar(db, [os.aberto_por, ...gerentesDoHotel(db, os.hotel_id)], { tipo: 'concluida', mensagem: `${rotulo(os)} foi concluída e aguarda sua validação.`, os_id: os.id, excluir: u.id, agora });
      }
    },
  },
  validar: {
    rotulo: 'Aprovar serviço (validar)',
    pode: (db, u, os) => os.status === 'concluida' && ehValidador(u, os),
    exec(db, u, os, d, agora) {
      atualizar(db, os, { validado_por: u.id, validado_em: agoraIso(agora) });
      encerrar(db, u, os, { texto: `Serviço validado por ${u.nome}.${texto(d.texto) ? ` Observações: ${texto(d.texto)}` : ''}`, agora });
      if (d.liberar_quarto && os.quarto_id) quartos.liberar(db, u, os.quarto_id, { os_id: os.id, observacao: `Liberado após validação de ${os.protocolo}`, agora });
      notificar(db, [os.responsavel_id, os.executado_por, os.recebido_por], { tipo: 'aprovada', mensagem: `${rotulo(os)} foi validada e encerrada.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  solicitar_correcao: {
    rotulo: 'Solicitar correção',
    exigeTexto: true,
    pode: (db, u, os) => os.status === 'concluida' && ehValidador(u, os),
    exec(db, u, os, d, agora) {
      mudarStatus(db, os, u, 'em_correcao', { campos: { correcoes: os.correcoes + 1, concluido_em: null }, texto: `Correção solicitada: ${d.texto}`, agora });
      notificar(db, [os.responsavel_id, os.executado_por, ...equipeManutencao(db, os.hotel_id)], { tipo: 'correcao', mensagem: `Correção solicitada em ${rotulo(os)}: ${d.texto}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  reabrir: {
    rotulo: 'Reabrir demanda',
    exigeTexto: true,
    pode: (db, u, os) => os.status === 'encerrada' && ehValidador(u, os),
    exec(db, u, os, d, agora) {
      mudarStatus(db, os, u, 'em_avaliacao', {
        campos: { reaberturas: os.reaberturas + 1, concluido_em: null, encerrado_em: null, validado_em: null, validado_por: null, alerta_atraso_em: null, alerta_prazo_em: null },
        texto: `Demanda reaberta: ${d.texto}`, agora,
      });
      if (d.bloquear_quarto && os.quarto_id) quartos.bloquear(db, u, os.quarto_id, { motivo: `${os.protocolo} reaberta: ${d.texto}`, os_id: os.id, agora });
      notificar(db, [os.responsavel_id, ...equipeManutencao(db, os.hotel_id)], { tipo: 'reaberta', mensagem: `${rotulo(os)} foi reaberta: ${d.texto}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  cancelar: {
    rotulo: 'Cancelar solicitação',
    exigeTexto: true,
    pode: (db, u, os) => ['nova', 'em_avaliacao', 'devolvida_complementacao', 'aguardando_orcamento', 'aguardando_autorizacao', 'aprovada'].includes(os.status) && ehValidador(u, os),
    exec(db, u, os, d, agora) {
      mudarStatus(db, os, u, 'cancelada', { campos: { encerrado_em: agoraIso(agora) }, texto: `Cancelada: ${d.texto}`, agora });
      exec(db, "UPDATE aprovacoes SET status = 'recusado', justificativa_decisao = 'OS cancelada' WHERE os_id = ? AND status = 'pendente'", os.id);
      if (os.quarto_id && ['gerente', 'admin', 'diretoria'].includes(u.papel)) quartos.liberar(db, u, os.quarto_id, { os_id: os.id, observacao: 'OS cancelada', agora });
      notificar(db, [os.recebido_por, os.responsavel_id], { tipo: 'recusada', mensagem: `${rotulo(os)} foi cancelada pelo solicitante.`, os_id: os.id, excluir: u.id, agora });
    },
  },
  comentar: {
    rotulo: 'Comentar',
    interna: true,
    exigeTexto: true,
    pode: () => true,
    exec(db, u, os, d, agora) {
      evento(db, os, u, 'comentario', { texto: d.texto, agora });
      notificar(db, participantes(os), { tipo: 'comentario', mensagem: `${u.nome} comentou em ${rotulo(os)}: ${d.texto.slice(0, 140)}`, os_id: os.id, excluir: u.id, agora });
    },
  },
  bloquear_quarto: {
    rotulo: 'Bloquear quarto para comercialização',
    pode: (db, u, os) => !!os.quarto_id && ATIVA(os) && (ehManutencao(u, os) || ehValidador(u, os)) &&
      !um(db, 'SELECT 1 AS x FROM bloqueios WHERE os_id = ? AND liberado_em IS NULL', os.id),
    exec(db, u, os, d, agora) {
      quartos.bloquear(db, u, os.quarto_id, { motivo: texto(d.texto) || `${os.protocolo}: ${os.titulo}`, os_id: os.id, agora });
      atualizar(db, os, { bloqueio_quarto: 1 });
      evento(db, os, u, 'bloqueio', { texto: 'Quarto bloqueado para comercialização até liberação autorizada.', agora });
    },
  },
  liberar_quarto: {
    rotulo: 'Liberar quarto para comercialização',
    pode: (db, u, os) => !!os.quarto_id && ['gerente', 'admin', 'diretoria'].includes(u.papel) && podeVerHotel(u, os.hotel_id) &&
      !!um(db, 'SELECT 1 AS x FROM bloqueios WHERE os_id = ? AND liberado_em IS NULL', os.id),
    exec(db, u, os, d, agora) {
      quartos.liberar(db, u, os.quarto_id, { os_id: os.id, observacao: texto(d.texto), agora });
      evento(db, os, u, 'bloqueio', { texto: `Liberação do quarto autorizada por ${u.nome}.`, agora });
    },
  },
};

function moeda(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function notificarDesignacao(db, u, os, tecnicoId, agora) {
  const t = um(db, 'SELECT nome FROM usuarios WHERE id = ?', tecnicoId);
  evento(db, os, u, 'designacao', { texto: `${t.nome} designado(a) como responsável pelo atendimento.`, agora });
  notificar(db, [tecnicoId], { tipo: 'designacao', mensagem: `Você foi designado(a) para ${rotulo(os)}.`, os_id: os.id, excluir: u.id, agora });
  notificar(db, [os.aberto_por], { tipo: 'designacao', mensagem: `${t.nome} foi designado(a) para ${rotulo(os)}.`, os_id: os.id, excluir: u.id, agora });
}

function inserirMateriais(db, u, os, materiais, agora) {
  const lista = (Array.isArray(materiais) ? materiais : []).filter((m) => texto(m?.descricao));
  for (const m of lista) {
    exec(db, 'INSERT INTO os_materiais (os_id, descricao, quantidade, unidade, solicitado_por, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
      os.id, texto(m.descricao), Number(m.quantidade) || 1, texto(m.unidade) || null, u.id, agoraIso(agora));
  }
  if (lista.length) evento(db, os, u, 'material', { texto: `Materiais solicitados: ${lista.map((m) => `${Number(m.quantidade) || 1} ${texto(m.unidade)} ${texto(m.descricao)}`.replace(/\s+/g, ' ')).join('; ')}`, agora });
  return lista.length;
}

function decidirAprovacao(db, u, os, status, d, agora) {
  exec(db, "UPDATE aprovacoes SET status = ?, decidido_por = ?, decidido_em = ?, justificativa_decisao = ? WHERE os_id = ? AND status = 'pendente'",
    status, u.id, agoraIso(agora), texto(d.texto) || null, os.id);
}

// Integração 4: encerramento atualiza automaticamente o histórico do quarto.
function encerrar(db, u, os, { texto: t, agora }) {
  const now = agoraIso(agora);
  mudarStatus(db, os, u, 'encerrada', { campos: { encerrado_em: now }, texto: t, agora });
  if (os.quarto_id) {
    exec(db, 'UPDATE quartos SET ultima_manutencao_em = ? WHERE id = ?', now, os.quarto_id);
    const custo = um(db, 'SELECT COALESCE(SUM(valor), 0) AS v FROM os_custos WHERE os_id = ?', os.id).v;
    quartos.registrarHistorico(db, {
      quarto_id: os.quarto_id, tipo: 'manutencao', os_id: os.id, usuario_id: u.id, agora,
      descricao: `${os.protocolo} encerrada — ${os.titulo}${custo ? ` (custo ${moeda(custo)})` : ''}`,
    });
  }
}

export function executarAcao(db, usuario, id, acao, dados = {}, agora) {
  const os = buscar(db, id);
  exigirHotel(usuario, os.hotel_id);
  const def = ACOES[acao];
  exigir(def, 'Ação desconhecida.', 404);
  if (!def.pode(db, usuario, os)) falha(403, `Ação "${def.rotulo}" não permitida para seu perfil no status atual (${STATUS[os.status]}).`);
  if (def.exigeTexto) {
    dados.texto = texto(dados.texto);
    exigir(dados.texto, 'Informe uma justificativa/descrição para esta ação.');
  }
  def.exec(db, usuario, os, dados, agora);
  return buscar(db, id);
}

export function acoesDisponiveis(db, usuario, os) {
  return Object.entries(ACOES)
    .filter(([, def]) => def.pode(db, usuario, os))
    .map(([chave, def]) => ({ chave, rotulo: def.rotulo, interna: !!def.interna, exigeTexto: !!def.exigeTexto }));
}

// ---------- consultas (15.3) ----------

const SELECT_LISTA = `
  SELECT o.*, h.nome AS hotel_nome, q.numero AS quarto_numero, e.tipo AS equipamento_tipo,
    ua.nome AS aberto_por_nome, ur.nome AS responsavel_nome,
    (SELECT COALESCE(SUM(valor), 0) FROM os_custos WHERE os_id = o.id) AS custo_total,
    (SELECT COUNT(*) FROM aprovacoes WHERE os_id = o.id AND status = 'pendente') AS aprovacoes_pendentes
  FROM ordens_servico o
  JOIN hoteis h ON h.id = o.hotel_id
  LEFT JOIN quartos q ON q.id = o.quarto_id
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  JOIN usuarios ua ON ua.id = o.aberto_por
  LEFT JOIN usuarios ur ON ur.id = o.responsavel_id`;

// Grupos do painel da manutenção (15.3).
export const GRUPOS_PAINEL = {
  novas: { rotulo: 'Novas solicitações', status: ['nova'] },
  avaliacao: { rotulo: 'Aguardando avaliação', status: ['em_avaliacao', 'devolvida_complementacao'] },
  aprovadas: { rotulo: 'Aprovadas', status: ['aprovada'] },
  execucao: { rotulo: 'Em execução', status: ['em_execucao'] },
  materiais: { rotulo: 'Aguardando materiais', status: ['aguardando_materiais'] },
  orcamento: { rotulo: 'Aguardando orçamento', status: ['aguardando_orcamento'] },
  autorizacao: { rotulo: 'Aguardando autorização', status: ['aguardando_autorizacao'] },
  correcao: { rotulo: 'Devolvidas para correção', status: ['em_correcao'] },
  validacao: { rotulo: 'Concluídas (aguardando validação)', status: ['concluida'] },
  encerradas: { rotulo: 'Encerradas', status: ['encerrada'] },
  atrasadas: { rotulo: 'Atrasadas', atrasadas: true },
  todas_abertas: { rotulo: 'Todas em aberto', status: Object.keys(STATUS).filter((s) => !STATUS_FINAIS.includes(s)) },
};

export function listar(db, usuario, filtros = {}, agora) {
  const now = agoraIso(agora);
  const f = filtroHotel(usuario, 'o.hotel_id', filtros.hotel_id);
  const where = [`1 = 1 ${f.sql}`];
  const params = [...f.params];
  const grupo = GRUPOS_PAINEL[filtros.grupo];
  let status = filtros.status ? String(filtros.status).split(',') : grupo?.status;
  if (status) {
    where.push(`o.status IN (${status.map(() => '?').join(',')})`);
    params.push(...status);
  }
  if (grupo?.atrasadas || filtros.atrasadas) {
    where.push(`o.status NOT IN (${ENTREGUES_SQL}) AND o.prazo_previsto < ?`);
    params.push(now);
  }
  for (const campo of ['prioridade', 'categoria', 'quarto_id', 'local']) {
    if (filtros[campo]) { where.push(`o.${campo} = ?`); params.push(filtros[campo]); }
  }
  if (filtros.responsavel_id) {
    const rid = filtros.responsavel_id === 'eu' ? usuario.id : Number(filtros.responsavel_id);
    where.push('(o.responsavel_id = ? OR EXISTS (SELECT 1 FROM os_tarefas t WHERE t.os_id = o.id AND t.tecnico_id = ?))');
    params.push(rid, rid);
  }
  if (filtros.aberto_por === 'eu') { where.push('o.aberto_por = ?'); params.push(usuario.id); }
  if (filtros.busca) {
    where.push('(o.protocolo LIKE ? OR o.titulo LIKE ? OR o.descricao LIKE ? OR q.numero = ?)');
    const b = `%${filtros.busca}%`;
    params.push(b, b, b, filtros.busca);
  }
  if (filtros.de) { where.push('o.criado_em >= ?'); params.push(normalizarData(filtros.de)); }
  if (filtros.ate) { where.push('o.criado_em <= ?'); params.push(normalizarData(filtros.ate)); }
  const linhas = todos(
    db,
    `${SELECT_LISTA} WHERE ${where.join(' AND ')}
     ORDER BY CASE o.prioridade WHEN 'emergencial' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
       o.prazo_previsto IS NULL, o.prazo_previsto, o.criado_em DESC
     LIMIT ?`,
    ...params, Math.min(Number(filtros.limite) || 300, 1000)
  );
  for (const o of linhas) o.atrasada = estaAtrasada(o, now);
  return linhas;
}

export function contagemPainel(db, usuario, filtros = {}, agora) {
  const now = agoraIso(agora);
  const f = filtroHotel(usuario, 'hotel_id', filtros.hotel_id);
  const porStatus = Object.fromEntries(
    todos(db, `SELECT status, COUNT(*) AS n FROM ordens_servico WHERE 1 = 1 ${f.sql} GROUP BY status`, ...f.params).map((r) => [r.status, r.n])
  );
  const atrasadas = um(db, `SELECT COUNT(*) AS n FROM ordens_servico WHERE status NOT IN (${ENTREGUES_SQL}) AND prazo_previsto < ? ${f.sql}`, now, ...f.params).n;
  const minhas = um(db, `SELECT COUNT(*) AS n FROM ordens_servico o WHERE o.status NOT IN (${FINAIS_SQL}) ${f.sql.replace('hotel_id', 'o.hotel_id')}
    AND (o.responsavel_id = ? OR EXISTS (SELECT 1 FROM os_tarefas t WHERE t.os_id = o.id AND t.tecnico_id = ? AND t.concluida = 0))`, ...f.params, usuario.id, usuario.id).n;
  const grupos = Object.entries(GRUPOS_PAINEL).map(([chave, g]) => ({
    chave, rotulo: g.rotulo,
    total: g.atrasadas ? atrasadas : g.status.reduce((s, st) => s + (porStatus[st] || 0), 0),
  }));
  return { grupos, minhas, porStatus };
}

export function detalhe(db, usuario, id, agora) {
  const base = buscar(db, id);
  exigirHotel(usuario, base.hotel_id);
  const now = agoraIso(agora);
  const os = um(
    db,
    `${SELECT_LISTA.replace('SELECT o.*,', `SELECT o.*, urc.nome AS recebido_por_nome, uex.nome AS executado_por_nome, uva.nome AS validado_por_nome,
      ua.papel AS aberto_por_papel, q.status_comercial AS quarto_status_comercial, h.exige_validacao AS hotel_exige_validacao,`)}
     LEFT JOIN usuarios urc ON urc.id = o.recebido_por
     LEFT JOIN usuarios uex ON uex.id = o.executado_por
     LEFT JOIN usuarios uva ON uva.id = o.validado_por
     WHERE o.id = ?`,
    base.id
  );
  os.atrasada = estaAtrasada(os, now);
  os.eventos = todos(db, `SELECT ev.*, u.nome AS usuario_nome, u.papel AS usuario_papel FROM os_eventos ev
    LEFT JOIN usuarios u ON u.id = ev.usuario_id WHERE ev.os_id = ? ORDER BY ev.criado_em, ev.id`, os.id);
  os.tarefas = todos(db, `SELECT t.*, u.nome AS tecnico_nome FROM os_tarefas t LEFT JOIN usuarios u ON u.id = t.tecnico_id WHERE t.os_id = ? ORDER BY t.id`, os.id);
  os.materiais = todos(db, `SELECT m.*, u.nome AS solicitado_por_nome FROM os_materiais m LEFT JOIN usuarios u ON u.id = m.solicitado_por WHERE m.os_id = ? ORDER BY m.id`, os.id);
  os.custos = todos(db, `SELECT c.*, u.nome AS registrado_por_nome FROM os_custos c LEFT JOIN usuarios u ON u.id = c.registrado_por WHERE c.os_id = ? ORDER BY c.id`, os.id);
  os.aprovacoes = todos(db, `SELECT a.*, u1.nome AS solicitado_por_nome, u2.nome AS decidido_por_nome FROM aprovacoes a
    LEFT JOIN usuarios u1 ON u1.id = a.solicitado_por LEFT JOIN usuarios u2 ON u2.id = a.decidido_por WHERE a.os_id = ? ORDER BY a.id`, os.id);
  os.fotos = todos(db, `SELECT f.*, u.nome AS enviado_por_nome FROM fotos f LEFT JOIN usuarios u ON u.id = f.enviado_por WHERE f.os_id = ? ORDER BY f.criado_em, f.id`, os.id);
  os.fotos_padrao = os.quarto_id ? listarPadrao(db, os.quarto_id) : [];
  os.bloqueio_ativo = !!um(db, 'SELECT 1 AS x FROM bloqueios WHERE os_id = ? AND liberado_em IS NULL', os.id);
  os.relacionadas = os.quarto_id
    ? ocorrenciasRelacionadas(db, { quarto_id: os.quarto_id, equipamento_id: os.equipamento_id, categoria: os.categoria, excluir_id: os.id, agora, antesDe: os.criado_em, janelaDias: 730 })
    : [];
  os.inspecao = os.inspecao_item_id
    ? um(db, 'SELECT i.id AS item_id, i.item, i.ambiente, i.inspecao_id FROM inspecao_itens i WHERE i.id = ?', os.inspecao_item_id)
    : null;
  os.acoes = acoesDisponiveis(db, usuario, base);
  os.estoque = todos(db, 'SELECT id, nome, unidade, quantidade, custo_unitario FROM estoque_itens WHERE hotel_id = ? AND ativo = 1 AND quantidade > 0 ORDER BY nome', os.hotel_id);
  os.tecnicos = todos(db, `SELECT id, nome, papel FROM usuarios WHERE ativo = 1 AND papel = 'tecnico'
    AND (hotel_id = ? OR hotel_id IS NULL) ORDER BY nome`, os.hotel_id);
  return os;
}
