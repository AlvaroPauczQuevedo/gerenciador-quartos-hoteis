// Exportações para Excel (CSV no padrão brasileiro: separador ";", vírgula decimal, UTF-8 com BOM).
import { CATEGORIAS, LOCAIS, PRIORIDADES, STATUS } from './constantes.js';
import { exigir } from './comum.js';
import * as os from './os.js';
import * as quartos from './quartos.js';
import { indicadores } from './indicadores.js';

const BOM = '﻿';
const celula = (v) => {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
  const s = String(v).replace(/\r?\n/g, ' ');
  return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dataBR = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '');
const csv = (cabecalho, linhas) => BOM + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';
const horas = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 3600e3 : null);

function demandas(db, usuario, filtros) {
  const lista = os.listar(db, usuario, { ...filtros, limite: 1000 });
  return csv(
    ['Protocolo', 'Hotel', 'Quarto', 'Local', 'Categoria', 'Título', 'Descrição', 'Prioridade', 'Situação', 'Atrasada', 'Origem',
      'Aberta em', 'Aberta por', 'Responsável', 'Prazo', 'Concluída em', 'Horas até concluir', 'Custo (R$)', 'Recorrente'],
    lista.map((o) => [o.protocolo, o.hotel_nome, o.quarto_numero, LOCAIS[o.local], CATEGORIAS[o.categoria], o.titulo, o.descricao,
      PRIORIDADES[o.prioridade], STATUS[o.status], o.atrasada ? 'Sim' : 'Não', o.origem, dataBR(o.criado_em), o.aberto_por_nome,
      o.responsavel_nome, dataBR(o.prazo_previsto), dataBR(o.concluido_em), horas(o.criado_em, o.concluido_em), o.custo_total, o.recorrente ? 'Sim' : 'Não']),
  );
}

function listaQuartos(db, usuario, filtros) {
  const lista = quartos.listar(db, usuario, filtros);
  return csv(
    ['Hotel', 'Quarto', 'Andar', 'Tipo', 'Estrelas', 'Comercialização', 'OS abertas', 'OS atrasadas', 'Problemas crônicos',
      'Última inspeção', 'Próxima inspeção', 'Inspeção vencida', 'Custo 12 meses (R$)', 'Numeração provisória'],
    lista.map((q) => [q.hotel_nome, q.numero, q.andar, q.tipo, q.estrelas, q.status_comercial === 'bloqueado' ? 'Bloqueado' : 'Liberado',
      q.os_abertas, q.os_atrasadas, q.cronicos, dataBR(q.ultima_inspecao_em), dataBR(q.proxima_inspecao_em),
      q.inspecao_vencida ? 'Sim' : 'Não', q.custo_12m, q.numeracao_provisoria ? 'Sim' : 'Não']),
  );
}

function listaIndicadores(db, usuario, filtros) {
  const d = indicadores(db, usuario, filtros);
  const cab = ['Recorte', 'Nome', 'Demandas', 'Concluídas', 'Pendentes', 'Atrasadas', 'No prazo (%)', 'Tempo médio de atendimento (h)',
    'Tempo médio de conclusão (h)', 'Reabertas', 'Correções', 'Custo total (R$)', 'Custo médio (R$)'];
  const linha = (recorte, l) => [recorte, l.rotulo, l.total, l.concluidas, l.pendentes, l.atrasadas, l.taxa_no_prazo,
    l.tempo_atendimento_h, l.tempo_conclusao_h, l.reabertas, l.correcoes, l.custo_total, l.custo_medio];
  return csv(cab, [
    linha('Geral', { ...d.geral, rotulo: `${dataBR(d.periodo.de)} a ${dataBR(d.periodo.ate)}` }),
    ...d.porHotel.map((l) => linha('Hotel', l)),
    ...d.porProfissional.map((l) => linha('Profissional', l)),
    ...d.porCategoria.map((l) => linha('Categoria', l)),
    ...d.porPrioridade.map((l) => linha('Prioridade', l)),
  ]);
}

const TIPOS = { demandas, quartos: listaQuartos, indicadores: listaIndicadores };

export function exportar(db, usuario, tipo, filtros) {
  exigir(TIPOS[tipo], 'Relatório desconhecido.', 404);
  const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return { nome: `${tipo}-${dia}.csv`, conteudo: TIPOS[tipo](db, usuario, filtros) };
}
