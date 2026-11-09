// Indicadores de desempenho da manutenção (15.8) e visão consolidada da diretoria (19).
import { todos } from '../db.js';
import { CATEGORIAS, PRIORIDADES, STATUS, STATUS_FINAIS, STATUS_ENTREGUES } from './constantes.js';
import { agoraIso, somarDias, filtroHotel, normalizarData, horasEntre } from './comum.js';
import { analise as analiseRecorrencia } from './recorrencia.js';
import { mediaPorHotel, quartosCriticos } from './hospedes.js';

const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (a, b) => (b ? (a / b) * 100 : null);

function periodo(filtros, agora) {
  const ate = normalizarData(filtros.ate) || agoraIso(agora);
  const de = normalizarData(filtros.de) || somarDias(ate, -90);
  return { de, ate };
}

function carregar(db, usuario, filtros, agora) {
  const { de, ate } = periodo(filtros, agora);
  const f = filtroHotel(usuario, 'o.hotel_id', filtros.hotel_id);
  const os = todos(db, `SELECT o.*, h.nome AS hotel_nome, u.nome AS responsavel_nome,
      (SELECT COALESCE(SUM(valor), 0) FROM os_custos WHERE os_id = o.id) AS custo
    FROM ordens_servico o JOIN hoteis h ON h.id = o.hotel_id LEFT JOIN usuarios u ON u.id = o.responsavel_id
    WHERE o.criado_em >= ? AND o.criado_em <= ? ${f.sql}`, de, ate, ...f.params);
  return { os, de, ate };
}

// Métricas comuns a qualquer recorte (rede, hotel, profissional, categoria).
function resumir(lista, now) {
  const concluidas = lista.filter((o) => o.concluido_em && ['concluida', 'encerrada'].includes(o.status));
  const comPrazo = concluidas.filter((o) => o.prazo_previsto);
  const noPrazo = comPrazo.filter((o) => o.concluido_em <= o.prazo_previsto);
  const custo = lista.reduce((s, o) => s + o.custo, 0);
  return {
    total: lista.length,
    concluidas: concluidas.length,
    encerradas: lista.filter((o) => o.status === 'encerrada').length,
    pendentes: lista.filter((o) => !STATUS_FINAIS.includes(o.status)).length,
    atrasadas: lista.filter((o) => !STATUS_ENTREGUES.includes(o.status) && o.prazo_previsto && o.prazo_previsto < now).length,
    tempo_resposta_h: media(lista.filter((o) => o.recebido_em).map((o) => horasEntre(o.criado_em, o.recebido_em))),
    tempo_atendimento_h: media(lista.filter((o) => o.iniciado_em).map((o) => horasEntre(o.criado_em, o.iniciado_em))),
    tempo_conclusao_h: media(concluidas.map((o) => horasEntre(o.criado_em, o.concluido_em))),
    taxa_no_prazo: pct(noPrazo.length, comPrazo.length),
    reabertas: lista.filter((o) => o.reaberturas > 0).length,
    correcoes: lista.reduce((s, o) => s + o.correcoes, 0),
    recorrentes: lista.filter((o) => o.recorrente).length,
    custo_total: custo,
    custo_medio: concluidas.length ? concluidas.reduce((s, o) => s + o.custo, 0) / concluidas.length : null,
  };
}

function agruparResumo(lista, chave, rotuloFn, now) {
  const m = new Map();
  for (const o of lista) {
    const k = chave(o);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(o);
  }
  return [...m.entries()].map(([k, l]) => ({ chave: k, rotulo: rotuloFn(k, l), ...resumir(l, now) })).sort((a, b) => b.total - a.total);
}

// Gargalos: tempo médio de permanência em cada status, calculado a partir do histórico de eventos.
function gargalos(db, ids, now) {
  if (!ids.length) return [];
  const eventos = todos(db, `SELECT os_id, status_para, criado_em FROM os_eventos WHERE status_para IS NOT NULL
    AND os_id IN (${ids.join(',')}) ORDER BY os_id, criado_em, id`);
  const acum = {};
  for (let i = 0; i < eventos.length; i++) {
    const ev = eventos[i];
    if (STATUS_FINAIS.includes(ev.status_para)) continue;
    const prox = eventos[i + 1] && eventos[i + 1].os_id === ev.os_id ? eventos[i + 1].criado_em : now;
    (acum[ev.status_para] ||= { horas: [], abertos: 0 }).horas.push(horasEntre(ev.criado_em, prox));
    if (!(eventos[i + 1] && eventos[i + 1].os_id === ev.os_id)) acum[ev.status_para].abertos++;
  }
  return Object.entries(acum)
    .map(([status, a]) => ({ status, rotulo: STATUS[status], media_h: media(a.horas), passagens: a.horas.length, parados_agora: a.abertos }))
    .sort((a, b) => b.media_h - a.media_h);
}

function evolucaoMensal(lista) {
  const m = {};
  for (const o of lista) {
    const k = o.criado_em.slice(0, 7);
    (m[k] ||= { mes: k, abertas: 0, concluidas: 0, custo: 0 }).abertas++;
    m[k].custo += o.custo;
    if (o.concluido_em) {
      const kc = o.concluido_em.slice(0, 7);
      (m[kc] ||= { mes: kc, abertas: 0, concluidas: 0, custo: 0 }).concluidas++;
    }
  }
  return Object.values(m).sort((a, b) => a.mes.localeCompare(b.mes));
}

export function indicadores(db, usuario, filtros = {}, agora) {
  const now = agoraIso(agora);
  const { os, de, ate } = carregar(db, usuario, filtros, agora);
  return {
    periodo: { de, ate },
    geral: resumir(os, now),
    porHotel: agruparResumo(os, (o) => o.hotel_id, (k, l) => l[0].hotel_nome, now),
    porProfissional: agruparResumo(os.filter((o) => o.responsavel_id), (o) => o.responsavel_id, (k, l) => l[0].responsavel_nome, now),
    porCategoria: agruparResumo(os, (o) => o.categoria, (k) => CATEGORIAS[k], now),
    porPrioridade: agruparResumo(os, (o) => o.prioridade, (k) => PRIORIDADES[k], now),
    gargalos: gargalos(db, os.map((o) => o.id), now),
    evolucao: evolucaoMensal(os),
    problemasRecorrentes: analiseRecorrencia(db, usuario, { hotel_id: filtros.hotel_id }, agora).alertas.slice(0, 10),
  };
}

// Visão consolidada da rede (seção 19).
export function rede(db, usuario, filtros = {}, agora) {
  const now = agoraIso(agora);
  const { os, de, ate } = carregar(db, usuario, filtros, agora);
  const f = filtroHotel(usuario, 'q.hotel_id', filtros.hotel_id);
  const quartos = todos(db, `SELECT q.*, h.nome AS hotel_nome,
      (SELECT COUNT(*) FROM problemas_cronicos c WHERE c.quarto_id = q.id AND c.status = 'ativo') AS cronicos,
      (SELECT COUNT(*) FROM ordens_servico o WHERE o.quarto_id = q.id AND o.status NOT IN ('encerrada', 'recusada', 'cancelada')) AS os_abertas
    FROM quartos q JOIN hoteis h ON h.id = q.hotel_id WHERE 1 = 1 ${f.sql}`, ...f.params);
  // Pendências atuais independem do período selecionado.
  const fo = filtroHotel(usuario, 'hotel_id', filtros.hotel_id);
  const pendentesAgora = todos(db, `SELECT hotel_id, prioridade, status, prazo_previsto FROM ordens_servico
    WHERE status NOT IN ('encerrada', 'recusada', 'cancelada') ${fo.sql}`, ...fo.params);
  const fh = filtroHotel(usuario, 'id', filtros.hotel_id);
  const hoteis = todos(db, `SELECT * FROM hoteis WHERE ativo = 1 ${fh.sql} ORDER BY nome`, ...fh.params);
  const recorr = analiseRecorrencia(db, usuario, { hotel_id: filtros.hotel_id }, agora);

  const unidades = hoteis.map((h) => {
    const qs = quartos.filter((q) => q.hotel_id === h.id);
    const lista = os.filter((o) => o.hotel_id === h.id);
    const pend = pendentesAgora.filter((p) => p.hotel_id === h.id);
    const r = resumir(lista, now);
    const estrelas = qs.filter((q) => q.estrelas).map((q) => q.estrelas);
    return {
      hotel_id: h.id, nome: h.nome, cidade: h.cidade,
      quartos: qs.length,
      liberados: qs.filter((q) => q.status_comercial === 'liberado').length,
      bloqueados: qs.filter((q) => q.status_comercial === 'bloqueado').length,
      estrelas_media: media(estrelas),
      baixa_avaliacao: qs.filter((q) => q.estrelas && q.estrelas <= 2).length,
      inspecoes_vencidas: qs.filter((q) => q.proxima_inspecao_em && q.proxima_inspecao_em < now).length,
      cronicos: qs.reduce((s, q) => s + q.cronicos, 0),
      pendentes_agora: pend.length,
      emergenciais_abertas: pend.filter((p) => p.prioridade === 'emergencial' && !STATUS_ENTREGUES.includes(p.status)).length,
      atrasadas_agora: pend.filter((p) => !STATUS_ENTREGUES.includes(p.status) && p.prazo_previsto && p.prazo_previsto < now).length,
      alertas_recorrencia: recorr.alertas.filter((a) => a.hotel_id === h.id).length,
      custo_por_quarto: qs.length ? r.custo_total / qs.length : null,
      orcamento_mes: orcamentoDoMes(db, [h.id], agora),
      nota_hospedes: mediaPorHotel(db, h.id, {}, agora),
      ...r,
    };
  });

  // Problemas estruturais comuns: o mesmo tipo de problema recorrente em mais de uma unidade.
  const comuns = new Map();
  for (const a of recorr.alertas) {
    const k = a.equipamento_tipo || CATEGORIAS[a.categoria];
    if (!comuns.has(k)) comuns.set(k, { problema: k, hoteis: new Set(), quartos: 0, ocorrencias: 0, custo: 0 });
    const c = comuns.get(k);
    c.hoteis.add(a.hotel_nome); c.quartos++; c.ocorrencias += a.ocorrencias; c.custo += a.custo;
  }
  const problemasComuns = [...comuns.values()]
    .map((c) => ({ ...c, hoteis: [...c.hoteis], n_hoteis: c.hoteis.size }))
    .filter((c) => c.n_hoteis >= 2)
    .sort((a, b) => b.n_hoteis - a.n_hoteis || b.ocorrencias - a.ocorrencias);

  const baixaAvaliacao = quartos.filter((q) => q.estrelas && q.estrelas <= 2)
    .map((q) => ({ id: q.id, numero: q.numero, hotel_nome: q.hotel_nome, estrelas: q.estrelas, status_comercial: q.status_comercial, cronicos: q.cronicos, os_abertas: q.os_abertas }))
    .sort((a, b) => a.estrelas - b.estrelas);

  return {
    periodo: { de, ate },
    unidades,
    totais: resumir(os, now),
    equipes: agruparResumo(os.filter((o) => o.responsavel_id), (o) => o.responsavel_id, (k, l) => `${l[0].responsavel_nome} (${l[0].hotel_nome})`, now),
    problemasComuns,
    baixaAvaliacao,
    hospedesCriticos: quartosCriticos(db, usuario, { hotel_id: filtros.hotel_id }, agora),
  };
}

// Respostas diretas às perguntas da seção 21, para o painel inicial.
// Início do mês corrente no horário de Brasília (UTC-3), em ISO UTC.
export function inicioDoMes(agora) {
  const [ano, mes] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' })
    .format(agora ? new Date(agora) : new Date()).split('-');
  return new Date(Date.UTC(Number(ano), Number(mes) - 1, 1, 3)).toISOString();
}

// Custo de manutenção do mês contra o orçamento mensal previsto, por hotel.
export function orcamentoDoMes(db, hotelIds, agora) {
  if (!hotelIds.length) return { custo: 0, previsto: null };
  const ph = hotelIds.map(() => '?').join(',');
  const custo = todos(db, `SELECT COALESCE(SUM(c.valor), 0) AS v FROM os_custos c JOIN ordens_servico o ON o.id = c.os_id
    WHERE c.criado_em >= ? AND o.hotel_id IN (${ph})`, inicioDoMes(agora), ...hotelIds)[0].v;
  const previstos = todos(db, `SELECT orcamento_mensal AS v FROM hoteis WHERE id IN (${ph}) AND orcamento_mensal IS NOT NULL`, ...hotelIds);
  return { custo, previsto: previstos.length ? previstos.reduce((t, r) => t + r.v, 0) : null };
}

export function resumoInicial(db, usuario, agora) {
  const now = agoraIso(agora);
  const f = filtroHotel(usuario, 'q.hotel_id');
  const quartos = todos(db, `SELECT q.status_comercial, q.estrelas, q.proxima_inspecao_em FROM quartos q WHERE 1 = 1 ${f.sql}`, ...f.params);
  const fo = filtroHotel(usuario, 'hotel_id');
  const abertas = todos(db, `SELECT prioridade, status, prazo_previsto FROM ordens_servico WHERE status NOT IN ('encerrada', 'recusada', 'cancelada') ${fo.sql}`, ...fo.params);
  const fc = filtroHotel(usuario, 'c.hotel_id');
  const cronicos = todos(db, `SELECT COUNT(*) AS n FROM problemas_cronicos c WHERE c.status = 'ativo' ${fc.sql}`, ...fc.params)[0].n;
  const custo30 = todos(db, `SELECT COALESCE(SUM(c.valor), 0) AS v FROM os_custos c JOIN ordens_servico o ON o.id = c.os_id
    WHERE c.criado_em >= ? ${fo.sql.replace('hotel_id', 'o.hotel_id')}`, somarDias(now, -30), ...fo.params)[0].v;
  return {
    quartos: quartos.length,
    liberados: quartos.filter((q) => q.status_comercial === 'liberado').length,
    bloqueados: quartos.filter((q) => q.status_comercial === 'bloqueado').length,
    estrelas_media: media(quartos.filter((q) => q.estrelas).map((q) => q.estrelas)),
    inspecoes_vencidas: quartos.filter((q) => q.proxima_inspecao_em && q.proxima_inspecao_em < now).length,
    os_abertas: abertas.length,
    emergenciais: abertas.filter((o) => o.prioridade === 'emergencial' && !STATUS_ENTREGUES.includes(o.status)).length,
    atrasadas: abertas.filter((o) => !STATUS_ENTREGUES.includes(o.status) && o.prazo_previsto && o.prazo_previsto < now).length,
    aguardando_validacao: abertas.filter((o) => o.status === 'concluida').length,
    aguardando_autorizacao: abertas.filter((o) => o.status === 'aguardando_autorizacao').length,
    cronicos,
    custo_30d: custo30,
    orcamento_mes: orcamentoDoMes(db, todos(db, `SELECT id FROM hoteis WHERE 1 = 1 ${filtroHotel(usuario, 'id').sql}`, ...filtroHotel(usuario, 'id').params).map((h) => h.id), agora),
  };
}
