// Gerador de QR Code (ISO/IEC 18004) em JavaScript puro, sem dependências.
// Modo byte (UTF-8), nível de correção configurável (padrão M ≈ 15% de dano recuperável),
// escolha automática da menor versão e da melhor máscara. Baseado no algoritmo de referência de Nayuki.
const ECL = { L: { ord: 0, bits: 1 }, M: { ord: 1, bits: 0 }, Q: { ord: 2, bits: 3 }, H: { ord: 3, bits: 2 } };

const ECC_POR_BLOCO = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCOS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const bit = (x, i) => ((x >>> i) & 1) !== 0;

function modulosBrutos(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const codewordsDados = (ver, ecl) => Math.floor(modulosBrutos(ver) / 8) - ECC_POR_BLOCO[ecl.ord][ver] * NUM_BLOCOS[ecl.ord][ver];

function multiplicar(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisorRS(grau) {
  const r = new Array(grau).fill(0);
  r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplicar(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = multiplicar(raiz, 0x02);
  }
  return r;
}
function restoRS(dados, divisor) {
  const r = divisor.map(() => 0);
  for (const b of dados) {
    const fator = b ^ r.shift();
    r.push(0);
    divisor.forEach((coef, i) => { r[i] ^= multiplicar(coef, fator); });
  }
  return r;
}

function posicoesAlinhamento(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const passo = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = ver * 4 + 17 - 7; r.length < n; pos -= passo) r.splice(1, 0, pos);
  return r;
}

export function gerarQR(texto, { nivel = 'M', versao = null, mascara = null } = {}) {
  const ecl = ECL[nivel];
  const bytes = Array.from(new TextEncoder().encode(texto));
  // Versão: a menor que comporte os dados (ou a fixada, nos testes).
  let ver = versao;
  const bitsNecessarios = (v) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
  if (!ver) {
    for (ver = 1; ver <= 40 && bitsNecessarios(ver) > codewordsDados(ver, ecl) * 8; ver++);
    if (ver > 40) throw new Error('Texto longo demais para um QR Code.');
  }
  const capacidade = codewordsDados(ver, ecl) * 8;
  // Fluxo de bits: modo byte (0100) + contagem + dados + terminador + preenchimento.
  const bits = [];
  const anexar = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
  anexar(0x4, 4);
  anexar(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) anexar(b, 8);
  anexar(0, Math.min(4, capacidade - bits.length));
  anexar(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xEC; bits.length < capacidade; pad ^= 0xEC ^ 0x11) anexar(pad, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Correção de erros (Reed-Solomon) em blocos, intercalados.
  const nBlocos = NUM_BLOCOS[ecl.ord][ver];
  const eccLen = ECC_POR_BLOCO[ecl.ord][ver];
  const brutos = Math.floor(modulosBrutos(ver) / 8);
  const nCurtos = nBlocos - (brutos % nBlocos);
  const lenCurto = Math.floor(brutos / nBlocos);
  const div = divisorRS(eccLen);
  const blocos = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const dat = dados.slice(k, k + lenCurto - eccLen + (i < nCurtos ? 0 : 1));
    k += dat.length;
    const ecc = restoRS(dat, div);
    if (i < nCurtos) dat.push(0);
    blocos.push(dat.concat(ecc));
  }
  const final = [];
  for (let i = 0; i < blocos[0].length; i++) {
    blocos.forEach((b, j) => { if (i !== lenCurto - eccLen || j >= nCurtos) final.push(b[i]); });
  }

  // Matriz e padrões fixos.
  const tam = ver * 4 + 17;
  const m = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fixo = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fixar = (x, y, escuro) => { m[y][x] = escuro; fixo[y][x] = true; };
  for (let i = 0; i < tam; i++) { fixar(6, i, i % 2 === 0); fixar(i, 6, i % 2 === 0); }
  const localizador = (x, y) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx; const yy = y + dy;
      if (xx >= 0 && xx < tam && yy >= 0 && yy < tam) fixar(xx, yy, d !== 2 && d !== 4);
    }
  };
  localizador(3, 3); localizador(tam - 4, 3); localizador(3, tam - 4);
  const alin = posicoesAlinhamento(ver);
  alin.forEach((px, i) => alin.forEach((py, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === alin.length - 1) || (i === alin.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) fixar(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const formato = (masc) => {
    const d = (ecl.bits << 3) | masc;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) fixar(8, i, bit(b, i));
    fixar(8, 7, bit(b, 6)); fixar(8, 8, bit(b, 7)); fixar(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) fixar(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) fixar(tam - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) fixar(8, tam - 15 + i, bit(b, i));
    fixar(8, tam - 8, true);
  };
  formato(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = tam - 11 + (i % 3); const c = Math.floor(i / 3);
      fixar(a, c, bit(b, i)); fixar(c, a, bit(b, i));
    }
  }
  // Dados em zigue-zague.
  let i = 0;
  for (let dir = tam - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let v = 0; v < tam; v++) for (let j = 0; j < 2; j++) {
      const x = dir - j;
      const subindo = ((dir + 1) & 2) === 0;
      const y = subindo ? tam - 1 - v : v;
      if (!fixo[y][x] && i < final.length * 8) { m[y][x] = bit(final[i >>> 3], 7 - (i & 7)); i++; }
    }
  }
  // Máscaras.
  const inverter = (masc, x, y) => [
    (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
    (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x * y) % 2 + (x * y) % 3 === 0,
    ((x * y) % 2 + (x * y) % 3) % 2 === 0, ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ][masc];
  const aplicar = (masc) => { for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) if (!fixo[y][x] && inverter(masc, x, y)) m[y][x] = !m[y][x]; };
  const penalidade = () => {
    let r = 0;
    const contaPadroes = (h) => {
      const n = h[1];
      const nucleo = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (nucleo && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (nucleo && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const addHist = (run, h) => { if (h[0] === 0) run += tam; h.pop(); h.unshift(run); };
    const termina = (cor, run, h) => { if (cor) { addHist(run, h); run = 0; } run += tam; addHist(run, h); return contaPadroes(h); };
    for (const linha of [true, false]) {
      for (let a = 0; a < tam; a++) {
        let cor = false; let run = 0; const h = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < tam; b++) {
          const c = linha ? m[a][b] : m[b][a];
          if (c === cor) { run++; if (run === 5) r += 3; else if (run > 5) r++; } else { addHist(run, h); if (!cor) r += contaPadroes(h) * 40; cor = c; run = 1; }
        }
        r += termina(cor, run, h) * 40;
      }
    }
    for (let y = 0; y < tam - 1; y++) for (let x = 0; x < tam - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) r += 3;
    }
    let escuros = 0;
    for (const l of m) for (const c of l) if (c) escuros++;
    const total = tam * tam;
    r += (Math.ceil(Math.abs(escuros * 20 - total * 10) / total) - 1) * 10;
    return r;
  };
  let melhor = mascara;
  if (melhor == null) {
    let menor = Infinity;
    for (let k = 0; k < 8; k++) {
      aplicar(k); formato(k);
      const p = penalidade();
      if (p < menor) { menor = p; melhor = k; }
      aplicar(k);
    }
  }
  aplicar(melhor); formato(melhor);
  return { tamanho: tam, versao: ver, mascara: melhor, modulos: m };
}

// SVG com margem de 4 módulos (zona de silêncio exigida pela norma).
export function qrSVG(texto, { margem = 4, nivel = 'M' } = {}) {
  const { tamanho, modulos } = gerarQR(texto, { nivel });
  const t = tamanho + margem * 2;
  let caminho = '';
  modulos.forEach((linha, y) => linha.forEach((c, x) => { if (c) caminho += `M${x + margem},${y + margem}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${t} ${t}" shape-rendering="crispEdges"><rect width="${t}" height="${t}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}
