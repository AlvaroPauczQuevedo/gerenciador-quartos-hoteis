// Importação dos quartos reais a partir da planilha do HITS (colunas Hotel, Apartamento, Categoria).
// Aceita .xlsx (aba com essas colunas, ex.: "Todos os quartos") ou .csv. Sempre há uma prévia antes de aplicar.
//   - quartos provisórios (1, 2, 3…) sem histórico são removidos;
//   - provisórios COM histórico (OS, inspeção, fotos…) são mantidos com o prefixo "PROV-" para revisão;
//   - quartos reais já existentes recebem a categoria/andar da planilha ("0108" e "108" são o mesmo quarto);
//   - números da planilha que ainda não existem são criados (com os equipamentos padrão do hotel);
//   - quartos reais que não estão na planilha NÃO são apagados — só aparecem no relatório.
import { todos, um, exec } from '../db.js';
import { exigir, exigirPapel, texto } from './comum.js';
import { lerXlsx } from './xlsx.js';
import * as quartos from './quartos.js';

const normalizarNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/^tri\s+hotel\s*/, '').replace(/[^a-z0-9&]+/g, ' ').trim();
const chaveNumero = (n) => String(n).trim().replace(/^0+(?=\d)/, '');

export function andarDoNumero(numero) {
  const s = String(numero).trim();
  if (!/^\d{3,}$/.test(s)) return null;
  const andar = parseInt(s.slice(0, -2), 10);
  return andar === 0 ? 'Térreo' : String(andar);
}

function lerCSV(texto_) {
  const linhas = texto_.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
  return linhas.map((l) => Object.fromEntries(l.split(sep).map((v, i) => [String.fromCharCode(65 + i), v.replace(/^"|"$/g, '').trim()])));
}

// Encontra as linhas Hotel / Apartamento / Categoria em qualquer aba da planilha.
export function extrairQuartos(arquivo) {
  const m = /^data:([^;]*);base64,(.+)$/s.exec(arquivo || '');
  exigir(m, 'Envie a planilha (.xlsx ou .csv).');
  const buf = Buffer.from(m[2], 'base64');
  exigir(buf.length < 15 * 1024 * 1024, 'Planilha grande demais (máx. 15 MB).');
  const ehXlsx = buf.readUInt32LE(0) === 0x04034b50;
  const abas = ehXlsx ? lerXlsx(buf) : { CSV: lerCSV(buf.toString('utf8')) };
  for (const linhas of Object.values(abas)) {
    const iCab = linhas.findIndex((l) => Object.values(l).some((v) => /^hotel$/i.test(String(v).trim())) && Object.values(l).some((v) => /^(apartamento|quarto|n[uú]mero)$/i.test(String(v).trim())));
    if (iCab < 0) continue;
    const cab = linhas[iCab];
    const col = (re) => Object.keys(cab).find((k) => re.test(String(cab[k]).trim()));
    const cHotel = col(/^hotel$/i); const cNum = col(/^(apartamento|quarto|n[uú]mero)$/i); const cCat = col(/^(categoria|tipo)$/i);
    const itens = linhas.slice(iCab + 1).map((l) => ({ hotel: texto(l[cHotel]), numero: texto(l[cNum]), tipo: cCat ? texto(l[cCat]) : '' }))
      .filter((q) => q.hotel && q.numero && !/^total/i.test(q.hotel));
    if (itens.length) return itens;
  }
  return exigir(false, 'Não encontrei na planilha as colunas "Hotel" e "Apartamento".');
}

function casarHotel(nomePlanilha, hoteis) {
  const alvo = normalizarNome(nomePlanilha);
  const exato = hoteis.filter((h) => normalizarNome(h.nome) === alvo);
  if (exato.length === 1) return exato[0];
  const contem = hoteis.filter((h) => normalizarNome(h.nome).includes(alvo) || alvo.includes(normalizarNome(h.nome)));
  return contem.length === 1 ? contem[0] : null;
}

export function importar(db, usuario, { arquivo, aplicar = false }, agora) {
  exigirPapel(usuario, 'admin');
  const itens = extrairQuartos(arquivo);
  const hoteis = todos(db, 'SELECT id, nome FROM hoteis ORDER BY nome');
  const porHotel = new Map();
  const naoEncontrados = new Set();
  for (const it of itens) {
    const h = casarHotel(it.hotel, hoteis);
    if (!h) { naoEncontrados.add(it.hotel); continue; }
    if (!porHotel.has(h.id)) porHotel.set(h.id, { hotel: h, planilha: it.hotel, quartos: new Map() });
    porHotel.get(h.id).quartos.set(chaveNumero(it.numero), it);
  }

  const resultado = [];
  for (const { hotel, planilha, quartos: lista } of porHotel.values()) {
    const existentes = todos(db, 'SELECT id, numero, tipo, andar, numeracao_provisoria FROM quartos WHERE hotel_id = ?', hotel.id);
    const r = { hotel_id: hotel.id, hotel: hotel.nome, planilha, na_planilha: lista.size, criados: 0, atualizados: 0, mantidos: 0,
      provisorios_removidos: 0, provisorios_com_historico: [], fora_da_planilha: [] };
    const reais = new Map();
    for (const q of existentes) {
      if (q.numeracao_provisoria) {
        if (quartos.temHistorico(db, q.id)) {
          r.provisorios_com_historico.push(q.numero);
          if (aplicar && !String(q.numero).startsWith('PROV-')) exec(db, 'UPDATE quartos SET numero = ? WHERE id = ?', `PROV-${q.numero}`, q.id);
        } else {
          r.provisorios_removidos++;
          if (aplicar) quartos.apagar(db, q.id);
        }
      } else {
        reais.set(chaveNumero(q.numero), q);
      }
    }
    for (const [chave, it] of lista) {
      const andar = andarDoNumero(it.numero);
      const q = reais.get(chave);
      if (q) {
        const mudou = q.numero !== it.numero || (it.tipo && q.tipo !== it.tipo) || (andar && q.andar !== andar);
        if (mudou) {
          r.atualizados++;
          if (aplicar) exec(db, 'UPDATE quartos SET numero = ?, tipo = COALESCE(?, tipo), andar = COALESCE(?, andar) WHERE id = ?', it.numero, it.tipo || null, andar, q.id);
        } else r.mantidos++;
        reais.delete(chave);
      } else {
        r.criados++;
        if (aplicar) quartos.criar(db, usuario, { hotel_id: hotel.id, numero: it.numero, tipo: it.tipo || null, andar }, agora);
      }
    }
    r.fora_da_planilha = [...reais.values()].map((q) => q.numero);
    resultado.push(r);
  }
  resultado.sort((a, b) => a.hotel.localeCompare(b.hotel));
  return {
    aplicado: aplicar,
    total_planilha: itens.length,
    hoteis: resultado,
    nao_encontrados: [...naoEncontrados],
    hoteis_sem_planilha: hoteis.filter((h) => !porHotel.has(h.id)).map((h) => h.nome),
  };
}
