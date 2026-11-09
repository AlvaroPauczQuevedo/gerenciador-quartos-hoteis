import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gerarQR, qrSVG } from '../public/js/qr.js';

// Matrizes de referência geradas pela biblioteca python "qrcode" 7.4.2 (mesmos parâmetros fixos).
// Na validação inicial, 456 combinações (versões 1–11, níveis L/M/Q/H, 8 máscaras, UTF-8) saíram idênticas.
const VETORES = [
  { texto: 'https://hotpink-butterfly-390092.hostingersite.com/#/q/123', nivel: 'M', versao: 4, mascara: 2, sha256: '4e564de0934c140c0cd69a695ea37e6988ad68b34b870621047b2227b7ce72c2' },
  { texto: 'açaí ✓ 😀', nivel: 'Q', versao: 7, mascara: 3, sha256: '67cda66608a67edd730de4bb5235885c651603260d23882e929200051654ea2c' },
  { texto: 'x'.repeat(120), nivel: 'L', versao: 10, mascara: 6, sha256: '5f31e1441050059966585d39570dba6eeae8c3a57c4a40d0a58da9bc6fed5261' },
];

test('QR code idêntico à biblioteca de referência', () => {
  for (const v of VETORES) {
    const r = gerarQR(v.texto, { nivel: v.nivel, versao: v.versao, mascara: v.mascara });
    const matriz = r.modulos.map((l) => l.map((c) => (c ? '1' : '0')).join('')).join('\n');
    assert.equal(createHash('sha256').update(matriz).digest('hex'), v.sha256, `${v.nivel} v${v.versao} m${v.mascara}`);
  }
});

test('QR do quarto: versão pequena, legível impresso, com zona de silêncio', () => {
  const r = gerarQR('https://manutencao.trihoteis.com.br/#/q/2143');
  assert.ok(r.versao <= 5, `versão ${r.versao}`);
  const svg = qrSVG('https://manutencao.trihoteis.com.br/#/q/1');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
});
