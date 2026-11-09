// Notificações push no celular (Web Push), sem dependências externas.
//   - Criptografia do conteúdo: RFC 8291 (aes128gcm) — o serviço de push não lê a mensagem.
//   - Identificação do servidor: RFC 8292 (VAPID, JWT ES256).
// As notificações internas continuam sendo a fonte da verdade; o push é um aviso adicional,
// filtrado por perfil (REGRAS) e pelo horário de silêncio (exceto emergências).
import {
  createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, createCipheriv, randomBytes, sign,
} from 'node:crypto';
import { todos, um, exec, lerConfig, gravarConfig } from '../db.js';
import { NOTIFICACAO_TIPOS } from './constantes.js';
import { agoraIso, exigir, texto } from './comum.js';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const deB64u = (s) => Buffer.from(String(s), 'base64url');

// ---------- quem recebe push de quê (as notificações internas continuam para todos) ----------
export const REGRAS = {
  tecnico: ['designacao', 'correcao', 'prazo_proximo', 'atrasada', 'reaberta'],
  manutencao_chefe: ['nova_demanda', 'atrasada', 'materiais', 'reaberta', 'correcao', 'aprovada', 'recusada'],
  gerente: ['concluida', 'quarto_bloqueado', 'devolvida', 'recusada', 'recorrencia'],
  governanta: ['inspecao_vencida', 'devolvida', 'concluida', 'recusada'],
  aprovador_financeiro: ['orcamento'],
  diretoria: ['orcamento', 'recorrencia'],
  admin: ['recorrencia'],
};

// Horário de silêncio no fuso dos hotéis (SC, RS e SP compartilham o horário de Brasília).
export const SILENCIO = { inicio: 22, fim: 7, fuso: 'America/Sao_Paulo' };
export function emSilencio(agora = new Date()) {
  const hora = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: SILENCIO.fuso }).format(agora));
  return hora >= SILENCIO.inicio || hora < SILENCIO.fim;
}

// Emergências sempre chegam (inclusive na madrugada) e "nova demanda emergencial" vai a todos os destinatários.
export function devePushar(papel, tipo, { emergencial = false, agora } = {}) {
  const permitido = (REGRAS[papel] || []).includes(tipo) || (emergencial && tipo === 'nova_demanda');
  if (!permitido) return false;
  return emergencial || !emSilencio(agora ? new Date(agora) : new Date());
}

// ---------- chaves VAPID (geradas uma vez e guardadas no banco, na pasta de dados) ----------
export function chavesVapid(db) {
  const salvo = lerConfig(db, 'vapid');
  if (salvo) return JSON.parse(salvo);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const chaves = { publica: b64u(Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)])), privada: jwk };
  gravarConfig(db, 'vapid', JSON.stringify(chaves));
  return chaves;
}

export function jwtVapid(endpoint, chaves, assunto, agora = Date.now()) {
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(agora / 1000) + 12 * 3600, sub: assunto }));
  const assinatura = sign('sha256', Buffer.from(`${cab}.${corpo}`), {
    key: createPrivateKey({ key: chaves.privada, format: 'jwk' }), dsaEncoding: 'ieee-p1363',
  });
  return `${cab}.${corpo}.${b64u(assinatura)}`;
}

// ---------- criptografia do conteúdo (RFC 8291) ----------
// `fixo` permite reproduzir o exemplo oficial da RFC nos testes.
export function criptografar(conteudo, p256dh, auth, fixo = {}) {
  const uaPublica = deB64u(p256dh);
  const segredoAuth = deB64u(auth);
  exigir(uaPublica.length === 65 && segredoAuth.length === 16, 'Inscrição de push inválida.');
  const ecdh = createECDH('prime256v1');
  if (fixo.privadaServidor) ecdh.setPrivateKey(deB64u(fixo.privadaServidor));
  else ecdh.generateKeys();
  const asPublica = ecdh.getPublicKey();
  const segredo = ecdh.computeSecret(uaPublica);
  const sal = fixo.sal ? deB64u(fixo.sal) : randomBytes(16);
  const ikm = Buffer.from(hkdfSync('sha256', segredo, segredoAuth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cifra = createCipheriv('aes-128-gcm', cek, nonce);
  const cifrado = Buffer.concat([cifra.update(Buffer.concat([Buffer.from(conteudo), Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);
  const cabecalho = Buffer.alloc(21);
  sal.copy(cabecalho, 0);
  cabecalho.writeUInt32BE(4096, 16);
  cabecalho.writeUInt8(asPublica.length, 20);
  return Buffer.concat([cabecalho, asPublica, cifrado]);
}

// ---------- inscrições (um registro por aparelho) ----------
// Só aceitamos endpoints dos serviços de push dos navegadores (evita o servidor ser usado para chamar URLs arbitrárias).
const SERVICOS_PUSH = ['.googleapis.com', '.mozilla.com', '.mozaws.net', '.push.apple.com', '.notify.windows.com'];
export function validarEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { url = null; }
  exigir(url && url.protocol === 'https:' && SERVICOS_PUSH.some((s) => `.${url.hostname}`.endsWith(s)), 'Serviço de notificação não reconhecido.');
}

export function inscrever(db, usuario, dados, { userAgent = '', urlPublica } = {}) {
  const sub = dados?.subscription || dados;
  validarEndpoint(sub?.endpoint);
  exigir(sub.keys?.p256dh && sub.keys?.auth, 'Inscrição de push incompleta.');
  criptografar('teste', sub.keys.p256dh, sub.keys.auth); // valida as chaves do aparelho
  if (urlPublica) gravarConfig(db, 'url_publica', urlPublica);
  // O mesmo aparelho passa a ser do usuário que está logado nele (celular compartilhado).
  exec(db, `INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth, user_agent, criado_em)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET usuario_id = excluded.usuario_id,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, falhas = 0`,
  usuario.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, texto(userAgent).slice(0, 200), agoraIso());
}

export function cancelar(db, usuario, endpoint) {
  exec(db, 'DELETE FROM push_inscricoes WHERE usuario_id = ? AND endpoint = ?', usuario.id, String(endpoint || ''));
}

export const aparelhosDoUsuario = (db, usuarioId) =>
  todos(db, 'SELECT id, user_agent, criado_em, ultimo_envio_em FROM push_inscricoes WHERE usuario_id = ? ORDER BY criado_em', usuarioId);

// ---------- envio ----------
async function enviarPara(db, inscricao, conteudo, { urgencia = 'normal', ttl = 86400 } = {}) {
  const chaves = chavesVapid(db);
  const assunto = process.env.VAPID_SUBJECT || lerConfig(db, 'url_publica') || 'https://trihoteis.com.br';
  const corpo = criptografar(JSON.stringify(conteudo), inscricao.p256dh, inscricao.auth);
  const resp = await fetch(inscricao.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(ttl), Urgency: urgencia, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${jwtVapid(inscricao.endpoint, chaves, assunto)}, k=${chaves.publica}`,
    },
    body: corpo,
    signal: AbortSignal.timeout(10000),
  });
  if (resp.status === 404 || resp.status === 410) {
    exec(db, 'DELETE FROM push_inscricoes WHERE id = ?', inscricao.id); // aparelho desinstalou ou revogou
    return false;
  }
  if (!resp.ok) {
    exec(db, 'UPDATE push_inscricoes SET falhas = falhas + 1 WHERE id = ?', inscricao.id);
    exec(db, 'DELETE FROM push_inscricoes WHERE id = ? AND falhas >= 5', inscricao.id);
    console.warn(`Push recusado (${resp.status}) para ${new URL(inscricao.endpoint).hostname}`);
    return false;
  }
  exec(db, 'UPDATE push_inscricoes SET ultimo_envio_em = ?, falhas = 0 WHERE id = ?', agoraIso(), inscricao.id);
  return true;
}

function conteudoDe(n) {
  return {
    title: NOTIFICACAO_TIPOS[n.tipo] || 'Manutenção Tri Hotéis',
    body: n.mensagem.length > 180 ? `${n.mensagem.slice(0, 177)}…` : n.mensagem,
    url: n.os_id ? `/#/os/${n.os_id}` : n.quarto_id ? `/#/quartos/${n.quarto_id}` : '/#/notificacoes',
    tag: n.os_id ? `os-${n.os_id}` : `${n.tipo}-${n.quarto_id || ''}`,
    emergencial: !!n.emergencial,
  };
}

// Recebe as notificações criadas numa operação (depois do commit) e envia os pushes devidos.
export async function despachar(db, notificacoes, { agora } = {}) {
  let enviados = 0;
  const tarefas = [];
  for (const n of notificacoes) {
    const emergencial = n.os_id ? um(db, 'SELECT prioridade FROM ordens_servico WHERE id = ?', n.os_id)?.prioridade === 'emergencial'
      : /\[EMERGENCIAL\]/.test(n.mensagem);
    for (const usuarioId of n.usuarios) {
      const u = um(db, 'SELECT id, papel FROM usuarios WHERE id = ? AND ativo = 1', usuarioId);
      if (!u || !devePushar(u.papel, n.tipo, { emergencial, agora })) continue;
      for (const insc of todos(db, 'SELECT * FROM push_inscricoes WHERE usuario_id = ?', u.id)) {
        tarefas.push(enviarPara(db, insc, conteudoDe({ ...n, emergencial }), { urgencia: emergencial ? 'high' : 'normal' })
          .then((ok) => { if (ok) enviados++; })
          .catch((e) => console.warn('Falha no push:', e.message)));
      }
    }
  }
  await Promise.all(tarefas);
  return enviados;
}

export async function testar(db, usuario) {
  const aparelhos = todos(db, 'SELECT * FROM push_inscricoes WHERE usuario_id = ?', usuario.id);
  exigir(aparelhos.length, 'Nenhum aparelho com notificações ativadas para o seu usuário.');
  const resultados = await Promise.all(aparelhos.map((a) => enviarPara(db, a, {
    title: 'Notificações ativadas', body: `Tudo certo, ${usuario.nome.split(' ')[0]}! Este aparelho vai receber os avisos da manutenção.`,
    url: '/#/notificacoes', tag: 'teste',
  }, { urgencia: 'high' }).catch(() => false)));
  return { aparelhos: aparelhos.length, enviados: resultados.filter(Boolean).length };
}

