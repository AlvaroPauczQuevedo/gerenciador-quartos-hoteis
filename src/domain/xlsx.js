// Leitor mínimo de planilhas .xlsx (somente valores), sem dependências: um .xlsx é um zip de XMLs.
import { inflateRawSync } from 'node:zlib';
import { exigir } from './comum.js';

function abrirZip(buf) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  exigir(fim >= 0, 'Arquivo não é uma planilha .xlsx válida.');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = new Map();
  for (let n = 0; n < total; n++) {
    exigir(buf.readUInt32LE(p) === 0x02014b50, 'Planilha corrompida.');
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const lenNome = buf.readUInt16LE(p + 28); const lenExtra = buf.readUInt16LE(p + 30); const lenComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome);
    arquivos.set(nome, () => {
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const dados = buf.subarray(ini, ini + tamanho);
      return (metodo === 8 ? inflateRawSync(dados) : dados).toString('utf8');
    });
    p += 46 + lenNome + lenExtra + lenComent;
  }
  return arquivos;
}

const entidades = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const textos = (xml) => entidades([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

// Retorna { nomeDaAba: [ { A: '...', B: '...' }, ... ] } (uma entrada por linha, na ordem da planilha).
export function lerXlsx(buf) {
  const zip = abrirZip(buf);
  const ler = (nome) => { const f = zip.get(nome); exigir(f, `Planilha incompleta (${nome}).`); return f(); };
  const compartilhadas = zip.has('xl/sharedStrings.xml') ? [...ler('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1])) : [];
  const rels = Object.fromEntries([...ler('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map((m) => [/Id="([^"]+)"/.exec(m[1])?.[1], /Target="([^"]+)"/.exec(m[1])?.[1]]));
  const abas = {};
  for (const m of ler('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const nome = entidades(/name="([^"]*)"/.exec(m[1])?.[1] || '');
    const alvo = rels[/r:id="([^"]+)"/.exec(m[1])?.[1]];
    if (!alvo) continue;
    const caminho = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^xl\//, '')}`;
    const linhas = [];
    for (const r of ler(caminho).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const linha = {};
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        if (!col) continue;
        const tipo = /t="(\w+)"/.exec(c[1])?.[1];
        const corpo = c[2] || '';
        let v;
        if (tipo === 'inlineStr') v = textos(corpo);
        else {
          v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1] ?? '';
          v = tipo === 's' && v !== '' ? compartilhadas[Number(v)] : entidades(v);
        }
        linha[col] = v;
      }
      linhas.push(linha);
    }
    abas[nome] = linhas;
  }
  return abas;
}
