import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, crc32 } from 'node:zlib';
import { abrirBanco, um, todos } from '../src/db.js';
import { popularPiloto } from '../src/seed.js';
import { importarRede } from '../src/rede.js';
import * as imp from '../src/domain/importacao-quartos.js';
import * as os from '../src/domain/os.js';
import { lerXlsx } from '../src/domain/xlsx.js';

const csv = (linhas) => `data:text/csv;base64,${Buffer.from(`﻿Hotel;Apartamento;Categoria\r\n${linhas.join('\r\n')}`).toString('base64')}`;

// Gera um .xlsx mínimo (zip com os XMLs essenciais), como o Excel faria.
function xlsxMinimo(linhas) {
  const strings = [...new Set(linhas.flat())];
  const celula = (v, c, r) => `<c r="${c}${r}" t="s"><v>${strings.indexOf(v)}</v></c>`;
  const arquivos = {
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Resumo" sheetId="1" r:id="rId1"/><sheet name="Todos os quartos" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Resumo</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': `<worksheet><sheetData>${linhas.map((l, i) => `<row r="${i + 1}">${l.map((v, j) => celula(v, 'ABC'[j], i + 1)).join('')}</row>`).join('')}</sheetData></worksheet>`,
  };
  const partes = []; const central = []; let off = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const dados = Buffer.from(conteudo); const comp = deflateRawSync(dados); const n = Buffer.from(nome);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(crc32(dados), 14);
    loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(dados.length, 22); loc.writeUInt16LE(n.length, 26);
    const cab = Buffer.alloc(46); cab.writeUInt32LE(0x02014b50, 0); cab.writeUInt16LE(8, 10); cab.writeUInt32LE(crc32(dados), 16);
    cab.writeUInt32LE(comp.length, 20); cab.writeUInt32LE(dados.length, 24); cab.writeUInt16LE(n.length, 28); cab.writeUInt32LE(off, 42);
    partes.push(loc, n, comp); central.push(cab, n); off += 30 + n.length + comp.length;
  }
  const tc = central.reduce((t, b) => t + b.length, 0);
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(central.length / 2, 8); fim.writeUInt16LE(central.length / 2, 10);
  fim.writeUInt32LE(tc, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, ...central, fim]);
}

function cenario() {
  const db = abrirBanco(':memory:');
  popularPiloto(db);
  importarRede(db);
  const admin = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = 'admin'");
  return { db, admin };
}

test('andar derivado do número, inclusive com zero à esquerda e térreo', () => {
  assert.equal(imp.andarDoNumero('0108'), '1');
  assert.equal(imp.andarDoNumero('1202'), '12');
  assert.equal(imp.andarDoNumero('016'), 'Térreo');
  assert.equal(imp.andarDoNumero('512'), '5');
  assert.equal(imp.andarDoNumero('12'), null);
});

test('prévia não altera nada; aplicar troca provisórios e é idempotente', () => {
  const { db, admin } = cenario();
  const centro = um(db, "SELECT id FROM hoteis WHERE logo = 'centro-chapeco'").id;
  const arquivo = csv(['TRI HOTEL CENTRO CHAPECO;101;LUXO CA', 'TRI HOTEL CENTRO CHAPECO;102;LUXO TW', 'TRI HOTEL CENTRO CHAPECÓ;0201;STANDARD CA']);
  const previa = imp.importar(db, admin, { arquivo });
  assert.equal(previa.aplicado, false);
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM quartos WHERE hotel_id = ?', centro).n, 48, 'prévia não mexe no banco');
  const h = previa.hoteis.find((x) => x.hotel_id === centro);
  assert.deepEqual([h.na_planilha, h.criados, h.provisorios_removidos], [3, 3, 48]);
  imp.importar(db, admin, { arquivo, aplicar: true });
  const quartos = todos(db, 'SELECT numero, andar, tipo, numeracao_provisoria FROM quartos WHERE hotel_id = ? ORDER BY numero', centro);
  assert.deepEqual(quartos.map((q) => [q.numero, q.andar, q.tipo, q.numeracao_provisoria]), [['0201', '2', 'STANDARD CA', 0], ['101', '1', 'LUXO CA', 0], ['102', '1', 'LUXO TW', 0]]);
  assert.equal(um(db, 'SELECT COUNT(*) AS n FROM equipamentos e JOIN quartos q ON q.id = e.quarto_id WHERE q.hotel_id = ?', centro).n, 30);
  const de_novo = imp.importar(db, admin, { arquivo }).hoteis.find((x) => x.hotel_id === centro);
  assert.deepEqual([de_novo.criados, de_novo.atualizados, de_novo.mantidos], [0, 0, 3]);
});

test('provisório com histórico é preservado como PROV-; quarto real fora da planilha não é apagado; "0108" casa com "108"', () => {
  const { db, admin } = cenario();
  const g = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = 'gerencia.smart-caxias'");
  const prov = um(db, "SELECT id FROM quartos WHERE hotel_id = ? AND numero = '7'", g.hotel_id);
  const osId = os.criar(db, g, { quarto_id: prov.id, local: 'quarto', categoria: 'eletrica', prioridade: 'media', descricao: 'Tomada sem energia no quarto 7' });
  imp.importar(db, admin, { arquivo: csv(['TRI HOTEL SMART CAXIAS;0201;LUXO CA']), aplicar: true });
  assert.equal(um(db, 'SELECT numero FROM quartos WHERE id = ?', prov.id).numero, 'PROV-7', 'mantido, renomeado');
  assert.equal(os.buscar(db, osId).quarto_id, prov.id, 'OS continua ligada ao quarto');
  // Agora "108" real (sem zero) existe; a planilha traz "0108": é o mesmo quarto.
  const r = imp.importar(db, admin, { arquivo: csv(['TRI HOTEL SMART CAXIAS;201;LUXO TW']), aplicar: true }).hoteis[0];
  assert.deepEqual([r.criados, r.atualizados], [0, 1]);
  assert.equal(um(db, "SELECT tipo FROM quartos WHERE hotel_id = ? AND numero = '201'", g.hotel_id).tipo, 'LUXO TW');
  const fora = imp.importar(db, admin, { arquivo: csv(['TRI HOTEL SMART CAXIAS;0301;LUXO CA']) }).hoteis[0];
  assert.deepEqual(fora.fora_da_planilha, ['201']);
});

test('lê .xlsx (aba "Todos os quartos"), ignora hotel desconhecido e exige administrador', () => {
  const { db, admin } = cenario();
  const buf = xlsxMinimo([['Hotel', 'Apartamento', 'Categoria'], ['TRI HOTEL XANXERE', '001', 'LUXO CA'], ['TRI HOTEL & FLAT CAXIAS', '101', 'SUPERIOR CA'], ['HOTEL QUE NAO EXISTE', '1', 'X']]);
  assert.equal(lerXlsx(buf)['Todos os quartos'].length, 4);
  const arquivo = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buf.toString('base64')}`;
  const r = imp.importar(db, admin, { arquivo });
  assert.deepEqual(r.nao_encontrados, ['HOTEL QUE NAO EXISTE']);
  assert.deepEqual(r.hoteis.map((h) => h.hotel).sort(), ['Tri Hotel & Flat Caxias', 'Tri Hotel Xanxerê']);
  const ger = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = 'gerencia'");
  assert.throws(() => imp.importar(db, ger, { arquivo }), (e) => e.status === 403);
  assert.throws(() => imp.importar(db, admin, { arquivo: csv([]).replace('Hotel;Apartamento', 'X;Y') }), /colunas/);
});
