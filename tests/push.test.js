import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, verify, hkdfSync, createDecipheriv } from 'node:crypto';
import { abrirBanco, um, todos, transacao } from '../src/db.js';
import { popularPiloto } from '../src/seed.js';
import { importarRede } from '../src/rede.js';
import * as push from '../src/domain/push.js';
import { filaPush } from '../src/domain/notificacoes.js';
import * as os from '../src/domain/os.js';
import * as usuarios from '../src/domain/usuarios.js';

const d = (s) => Buffer.from(s, 'base64url');

test('criptografia idêntica ao exemplo oficial da RFC 8291 (Apêndice A)', () => {
  const corpo = push.criptografar(
    'When I grow up, I want to be a watermelon',
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    { privadaServidor: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', sal: 'DGv6ra1nlYgDCS1FRnbzlw' },
  );
  assert.equal(corpo.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('o aparelho consegue decifrar a mensagem (ida e volta com chaves aleatórias)', () => {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  const corpo = push.criptografar(JSON.stringify({ title: 'Olá', body: 'Quarto 512' }), ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
  // Lado do navegador (RFC 8291, seção 3.4)
  const sal = corpo.subarray(0, 16); const idlen = corpo[20]; const asPub = corpo.subarray(21, 21 + idlen); const cifrado = corpo.subarray(21 + idlen);
  const segredo = ua.computeSecret(asPub);
  const ikm = Buffer.from(hkdfSync('sha256', segredo, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12));
  const dec = createDecipheriv('aes-128-gcm', cek, nonce);
  dec.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([dec.update(cifrado.subarray(0, cifrado.length - 16)), dec.final()]);
  assert.equal(claro[claro.length - 1], 2, 'delimitador do último registro');
  assert.deepEqual(JSON.parse(claro.subarray(0, -1)), { title: 'Olá', body: 'Quarto 512' });
});

test('VAPID: chave única persistida e JWT ES256 verificável', () => {
  const db = abrirBanco(':memory:');
  const chaves = push.chavesVapid(db);
  assert.deepEqual(push.chavesVapid(db), chaves, 'mesma chave nas próximas chamadas');
  assert.equal(d(chaves.publica).length, 65);
  const jwt = push.jwtVapid('https://fcm.googleapis.com/fcm/send/abc', chaves, 'https://exemplo.hostingersite.com', Date.UTC(2026, 10, 9));
  const [cab, corpo, assinatura] = jwt.split('.');
  assert.deepEqual(JSON.parse(d(cab)), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(d(corpo));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://exemplo.hostingersite.com');
  const chavePublica = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: chaves.privada.x, y: chaves.privada.y }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${cab}.${corpo}`), { key: chavePublica, dsaEncoding: 'ieee-p1363' }, d(assinatura)));
});

test('regras por perfil e horário de silêncio (emergência sempre passa)', () => {
  const dia = '2026-11-09T15:00:00Z'; // 12h em Brasília
  const noite = '2026-11-10T03:30:00Z'; // 0h30 em Brasília
  assert.equal(push.devePushar('tecnico', 'designacao', { agora: dia }), true);
  assert.equal(push.devePushar('tecnico', 'comentario', { agora: dia }), false);
  assert.equal(push.devePushar('gerente', 'concluida', { agora: dia }), true);
  assert.equal(push.devePushar('gerente', 'nova_demanda', { agora: dia }), false);
  assert.equal(push.devePushar('gerente', 'nova_demanda', { emergencial: true, agora: noite }), true);
  assert.equal(push.devePushar('tecnico', 'designacao', { agora: noite }), false);
  assert.equal(push.devePushar('tecnico', 'designacao', { emergencial: true, agora: noite }), true);
  assert.equal(push.devePushar('aprovador_financeiro', 'orcamento', { agora: dia }), true);
});

test('só aceita endpoints de serviços de push reais', () => {
  assert.doesNotThrow(() => push.validarEndpoint('https://fcm.googleapis.com/fcm/send/xyz'));
  assert.doesNotThrow(() => push.validarEndpoint('https://web.push.apple.com/QAbc'));
  assert.doesNotThrow(() => push.validarEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  for (const ruim of ['http://fcm.googleapis.com/x', 'https://evil.com/fcm.googleapis.com', 'https://googleapis.com.evil.com/x', 'https://127.0.0.1/x', 'lixo']) {
    assert.throws(() => push.validarEndpoint(ruim), /não reconhecido/, ruim);
  }
});

function cenario() {
  const db = abrirBanco(':memory:');
  popularPiloto(db);
  importarRede(db);
  const sel = (login) => um(db, 'SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = ?', login);
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const inscricao = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/aparelho-${n}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, n).toString('base64url') } });
  return { db, sel, inscricao };
}

test('fila de push: envia após o commit e descarta em caso de erro (rollback)', async () => {
  const { db, sel, inscricao } = cenario();
  const ger = sel('gerencia'); const chefe = sel('manutencao');
  push.inscrever(db, chefe, inscricao(1));
  const q = um(db, "SELECT id FROM quartos WHERE numero = '402'");
  const chamadas = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, opcoes) => { chamadas.push({ url, opcoes }); return new Response(null, { status: 201 }); };
  filaPush.ativa = true;
  try {
    filaPush.itens.length = 0;
    assert.throws(() => transacao(db, () => {
      os.criar(db, ger, { quarto_id: q.id, local: 'quarto', categoria: 'eletrica', prioridade: 'media', descricao: 'Tomada sem energia no quarto' });
      throw new Error('falha simulada');
    }));
    filaPush.itens.length = 0; // o servidor descarta a fila quando a operação falha
    transacao(db, () => os.criar(db, ger, { quarto_id: q.id, local: 'quarto', categoria: 'eletrica', prioridade: 'media', descricao: 'Tomada sem energia no quarto' }));
    const enviados = await push.despachar(db, filaPush.itens.splice(0), { agora: '2026-11-09T15:00:00Z' });
    assert.equal(enviados, 1);
    assert.equal(chamadas.length, 1);
    const h = chamadas[0].opcoes.headers;
    assert.equal(h['Content-Encoding'], 'aes128gcm');
    assert.match(h.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  } finally {
    globalThis.fetch = fetchOriginal;
    filaPush.ativa = false;
    filaPush.itens.length = 0;
  }
});

test('aparelho que sumiu (410) é removido; desativar usuário remove os aparelhos', async () => {
  const { db, sel, inscricao } = cenario();
  const tec = usuarios.criarUsuario(db, sel('gerencia'), { nome: 'Técnico', login: 'tec.teste', papel: 'tecnico', senha: 'senhaBoa123' });
  const tecnico = sel('tec.teste');
  push.inscrever(db, tecnico, inscricao(1));
  push.inscrever(db, tecnico, inscricao(2));
  const fetchOriginal = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => new Response(null, { status: n++ === 0 ? 410 : 201 });
  try {
    const r = await push.testar(db, tecnico);
    assert.deepEqual(r, { aparelhos: 2, enviados: 1 });
    assert.equal(push.aparelhosDoUsuario(db, tecnico.id).length, 1);
  } finally { globalThis.fetch = fetchOriginal; }
  usuarios.alternarAtivo(db, sel('gerencia'), tec);
  assert.equal(push.aparelhosDoUsuario(db, tecnico.id).length, 0);
});

test('celular compartilhado: o aparelho passa a ser do último usuário que ativou', () => {
  const { db, sel, inscricao } = cenario();
  const a = sel('gerencia'); const b = sel('governanca');
  push.inscrever(db, a, inscricao(7));
  push.inscrever(db, b, inscricao(7));
  assert.equal(push.aparelhosDoUsuario(db, a.id).length, 0);
  assert.equal(push.aparelhosDoUsuario(db, b.id).length, 1);
  push.cancelar(db, b, inscricao(7).endpoint);
  assert.equal(todos(db, 'SELECT * FROM push_inscricoes').length, 0);
});
