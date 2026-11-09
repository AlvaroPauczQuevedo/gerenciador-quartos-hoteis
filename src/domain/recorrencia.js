// Índice de recorrência de problemas (seção 17). A análise considera o histórico —
// intervalos entre ocorrências, retornos após intervenção concluída, reaberturas e custos —
// e não apenas a quantidade de chamados.
import { todos } from '../db.js';
import { CATEGORIAS, RECORRENCIA } from './constantes.js';
import { agoraIso, somarDias, filtroHotel } from './comum.js';

const IGNORADOS = "('cancelada', 'recusada')";
const dias = (a, b) => (new Date(b) - new Date(a)) / 86400e3;

// Ocorrências anteriores do mesmo problema no mesmo quarto (mesmo equipamento ou, sem
// equipamento, mesma categoria) dentro da janela de histórico.
export function ocorrenciasRelacionadas(db, { quarto_id, equipamento_id, categoria, excluir_id = 0, agora, antesDe, janelaDias = RECORRENCIA.janelaDias }) {
  const ref = antesDe || agoraIso(agora);
  const desde = somarDias(ref, -janelaDias);
  const filtro = equipamento_id
    ? '(o.equipamento_id = ? OR (o.equipamento_id IS NULL AND o.categoria = ?))'
    : 'o.categoria = ?';
  const params = equipamento_id ? [equipamento_id, categoria] : [categoria];
  return todos(
    db,
    `SELECT o.id, o.protocolo, o.titulo, o.status, o.criado_em, o.concluido_em, o.encerrado_em, o.reaberturas,
       (SELECT COALESCE(SUM(valor), 0) FROM os_custos WHERE os_id = o.id) AS custo
     FROM ordens_servico o
     WHERE o.quarto_id = ? AND ${filtro} AND o.id <> ? AND o.status NOT IN ${IGNORADOS} AND o.origem <> 'preventiva'
       AND o.criado_em >= ? AND o.criado_em <= ?
     ORDER BY o.criado_em`,
    quarto_id, ...params, excluir_id, desde, ref
  );
}

function carregarBase(db, usuario, filtros, agora) {
  const now = agoraIso(agora);
  const desde = somarDias(now, -(Number(filtros.janela_dias) || RECORRENCIA.janelaDias));
  const f = filtroHotel(usuario, 'o.hotel_id', filtros.hotel_id);
  return todos(
    db,
    `SELECT o.id, o.protocolo, o.titulo, o.hotel_id, h.nome AS hotel_nome, o.quarto_id, q.numero AS quarto_numero,
       o.equipamento_id, e.tipo AS equipamento_tipo, e.ativo AS equipamento_ativo, o.categoria, o.status, o.criado_em,
       o.concluido_em, o.encerrado_em, o.reaberturas, o.correcoes,
       (SELECT COALESCE(SUM(valor), 0) FROM os_custos WHERE os_id = o.id) AS custo
     FROM ordens_servico o JOIN hoteis h ON h.id = o.hotel_id
     LEFT JOIN quartos q ON q.id = o.quarto_id LEFT JOIN equipamentos e ON e.id = o.equipamento_id
     WHERE o.status NOT IN ${IGNORADOS} AND o.origem <> 'preventiva' AND o.criado_em >= ? ${f.sql}
     ORDER BY o.criado_em`,
    desde, ...f.params
  );
}

function agrupar(lista, chaveFn) {
  const m = new Map();
  for (const x of lista) {
    const k = chaveFn(x);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// Avalia uma sequência cronológica de ocorrências do mesmo problema.
export function avaliarSequencia(ocorrencias) {
  const n = ocorrencias.length;
  const intervalos = [];
  let retornos = 0;
  let curtas = 0;
  for (let i = 1; i < n; i++) {
    const ant = ocorrencias[i - 1];
    const atual = ocorrencias[i];
    const gap = dias(ant.criado_em, atual.criado_em);
    intervalos.push(gap);
    if (gap <= RECORRENCIA.intervaloCurtoDias) curtas++;
    const fim = ant.concluido_em || ant.encerrado_em;
    if (fim && dias(fim, atual.criado_em) <= RECORRENCIA.retornoDias && dias(fim, atual.criado_em) >= 0) retornos++;
  }
  const reaberturas = ocorrencias.reduce((s, o) => s + (o.reaberturas || 0), 0);
  const custo = ocorrencias.reduce((s, o) => s + (o.custo || 0), 0);
  const intervaloMedio = intervalos.length ? intervalos.reduce((a, b) => a + b, 0) / intervalos.length : null;
  // Intervalos que encurtam indicam degradação progressiva.
  const acelerando = intervalos.length >= 2 && intervalos[intervalos.length - 1] < intervalos[0];
  const indice = n + 2 * retornos + curtas + reaberturas + (acelerando ? 1 : 0);
  let nivel = null;
  if (n >= 3 || retornos >= 2 || indice >= 6) nivel = 'critico';
  else if (n >= 2 || reaberturas >= 1) nivel = 'atencao';
  return { ocorrencias: n, retornos, curtas, reaberturas, custo, intervaloMedio, acelerando, indice, nivel };
}

function recomendar(g, av) {
  const periodo = av.intervaloMedio != null ? `, intervalo médio de ${Math.round(av.intervaloMedio)} dias` : '';
  const base = `${av.ocorrencias} ocorrências${periodo}${av.retornos ? `, ${av.retornos} retorno(s) após intervenção` : ''}${av.reaberturas ? `, ${av.reaberturas} reabertura(s)` : ''}`;
  if (g.equipamento_tipo) {
    return av.nivel === 'critico'
      ? `${g.equipamento_tipo} do quarto ${g.quarto_numero}: ${base}. Recomenda-se avaliação técnica aprofundada e análise de substituição do equipamento.`
      : `${g.equipamento_tipo} do quarto ${g.quarto_numero}: ${base}. Monitorar e investigar a causa raiz.`;
  }
  return av.nivel === 'critico'
    ? `${CATEGORIAS[g.categoria]} no quarto ${g.quarto_numero}: ${base}. Recomenda-se avaliação aprofundada da causa raiz (instalação/estrutura) e registro como problema crônico.`
    : `${CATEGORIAS[g.categoria]} no quarto ${g.quarto_numero}: ${base}. Monitorar a evolução.`;
}

export function analise(db, usuario, filtros = {}, agora) {
  const base = carregarBase(db, usuario, filtros, agora);
  const comQuarto = base.filter((o) => o.quarto_id);
  const f = filtroHotel(usuario, 'q.hotel_id', filtros.hotel_id);
  const cronicos = todos(db, `SELECT c.quarto_id, c.categoria, c.equipamento_id FROM problemas_cronicos c JOIN quartos q ON q.id = c.quarto_id WHERE c.status = 'ativo' ${f.sql}`, ...f.params);

  // 1) Alertas por quarto + equipamento (ou categoria, quando não há equipamento).
  const grupos = agrupar(comQuarto, (o) => `${o.quarto_id}|${o.equipamento_id ? `e${o.equipamento_id}` : `c${o.categoria}`}`);
  const alertas = [];
  for (const lista of grupos.values()) {
    const av = avaliarSequencia(lista);
    if (!av.nivel) continue;
    const g = lista[0];
    alertas.push({
      ...av,
      hotel_id: g.hotel_id, hotel_nome: g.hotel_nome, quarto_id: g.quarto_id, quarto_numero: g.quarto_numero,
      equipamento_id: g.equipamento_id, equipamento_tipo: g.equipamento_tipo, equipamento_ativo: g.equipamento_ativo, categoria: g.categoria,
      cronico_registrado: cronicos.some((c) => c.quarto_id === g.quarto_id && (g.equipamento_id ? c.equipamento_id === g.equipamento_id : c.categoria === g.categoria)),
      historico: lista.map((o) => ({ id: o.id, protocolo: o.protocolo, titulo: o.titulo, criado_em: o.criado_em, status: o.status, custo: o.custo })),
      recomendacao: recomendar(g, av),
    });
  }
  alertas.sort((a, b) => (a.nivel === b.nivel ? b.indice - a.indice : a.nivel === 'critico' ? -1 : 1));

  // 2) Quartos com maior número de ocorrências.
  const porQuarto = [...agrupar(comQuarto, (o) => o.quarto_id).values()].map((l) => ({
    quarto_id: l[0].quarto_id, quarto_numero: l[0].quarto_numero, hotel_nome: l[0].hotel_nome, hotel_id: l[0].hotel_id,
    ocorrencias: l.length, custo: l.reduce((s, o) => s + o.custo, 0),
    categorias: [...new Set(l.map((o) => CATEGORIAS[o.categoria]))],
  })).sort((a, b) => b.ocorrencias - a.ocorrencias || b.custo - a.custo);

  // 3) Equipamentos com maior índice de falhas (falhas ÷ unidades instaladas do tipo).
  const fe = filtroHotel(usuario, 'q.hotel_id', filtros.hotel_id);
  const instalados = Object.fromEntries(todos(db, `SELECT e.tipo, COUNT(*) AS n FROM equipamentos e JOIN quartos q ON q.id = e.quarto_id WHERE e.ativo = 1 ${fe.sql} GROUP BY e.tipo`, ...fe.params).map((r) => [r.tipo, r.n]));
  const equipamentos = [...agrupar(comQuarto.filter((o) => o.equipamento_tipo), (o) => o.equipamento_tipo).entries()].map(([tipo, l]) => ({
    tipo, falhas: l.length, unidades: instalados[tipo] || 0,
    indice: instalados[tipo] ? l.length / instalados[tipo] : l.length,
    quartos_afetados: new Set(l.map((o) => o.quarto_id)).size,
    custo: l.reduce((s, o) => s + o.custo, 0),
  })).sort((a, b) => b.indice - a.indice);

  // 4) Problemas recorrentes por categoria.
  const categorias = [...agrupar(base, (o) => o.categoria).entries()].map(([cat, l]) => ({
    categoria: cat, rotulo: CATEGORIAS[cat], ocorrencias: l.length,
    quartos_afetados: new Set(l.filter((o) => o.quarto_id).map((o) => o.quarto_id)).size,
    quartos_com_recorrencia: new Set(alertas.filter((a) => a.categoria === cat).map((a) => a.quarto_id)).size,
    hoteis: new Set(l.map((o) => o.hotel_id)).size,
    custo: l.reduce((s, o) => s + o.custo, 0),
  })).sort((a, b) => b.quartos_com_recorrencia - a.quartos_com_recorrencia || b.ocorrencias - a.ocorrencias);

  // 5) Manutenções repetidas em curto intervalo e 6) problemas que voltam após intervenção.
  const repeticoes = [];
  const retornos = [];
  for (const lista of grupos.values()) {
    for (let i = 1; i < lista.length; i++) {
      const ant = lista[i - 1];
      const atual = lista[i];
      const gap = dias(ant.criado_em, atual.criado_em);
      const item = {
        quarto_id: atual.quarto_id, quarto_numero: atual.quarto_numero, hotel_nome: atual.hotel_nome,
        alvo: atual.equipamento_tipo || CATEGORIAS[atual.categoria],
        anterior: { id: ant.id, protocolo: ant.protocolo, criado_em: ant.criado_em, concluido_em: ant.concluido_em },
        atual: { id: atual.id, protocolo: atual.protocolo, criado_em: atual.criado_em },
        dias: Math.round(gap),
      };
      if (gap <= RECORRENCIA.intervaloCurtoDias) repeticoes.push(item);
      const fim = ant.concluido_em || ant.encerrado_em;
      if (fim && dias(fim, atual.criado_em) >= 0 && dias(fim, atual.criado_em) <= RECORRENCIA.retornoDias) {
        retornos.push({ ...item, dias_apos_conclusao: Math.round(dias(fim, atual.criado_em)) });
      }
    }
  }
  // Reaberturas também são problemas que voltaram após a intervenção.
  for (const o of comQuarto.filter((x) => x.reaberturas > 0)) {
    retornos.push({
      quarto_id: o.quarto_id, quarto_numero: o.quarto_numero, hotel_nome: o.hotel_nome,
      alvo: o.equipamento_tipo || CATEGORIAS[o.categoria], atual: { id: o.id, protocolo: o.protocolo, criado_em: o.criado_em },
      reaberta: o.reaberturas,
    });
  }

  // 7) Quartos com custos elevados: acima de 1,5× a média de custo por quarto do próprio hotel.
  const custoHotel = agrupar(porQuarto, (q) => q.hotel_id);
  const custosElevados = [];
  for (const lista of custoHotel.values()) {
    const fq = filtroHotel(usuario, 'hotel_id', lista[0].hotel_id);
    const nQuartos = todos(db, `SELECT COUNT(*) AS n FROM quartos WHERE 1 = 1 ${fq.sql}`, ...fq.params)[0].n || 1;
    const media = lista.reduce((s, q) => s + q.custo, 0) / nQuartos;
    for (const q of lista) {
      if (q.custo > 0 && q.custo > media * 1.5) custosElevados.push({ ...q, media_hotel: media, razao: media ? q.custo / media : null });
    }
  }
  custosElevados.sort((a, b) => b.custo - a.custo);

  return {
    parametros: { ...RECORRENCIA, janelaDias: Number(filtros.janela_dias) || RECORRENCIA.janelaDias },
    alertas, quartos: porQuarto.slice(0, 20), equipamentos, categorias,
    repeticoes: repeticoes.sort((a, b) => a.dias - b.dias), retornos, custosElevados,
  };
}
