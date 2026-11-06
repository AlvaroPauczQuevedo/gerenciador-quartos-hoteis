// Registro fotográfico (seção 18): toda foto é vinculada ao quarto e, quando houver,
// à OS e/ou ao item de inspeção — a mesma foto alimenta a OS, a inspeção e a galeria do quarto.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { todos, um, exec } from '../db.js';
import { FASES_FOTO } from './constantes.js';
import { agoraIso, exigir, exigirHotel, texto, buscarQuarto } from './comum.js';

const TIPOS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
export const TAMANHO_MAX = 15 * 1024 * 1024;

function validarArquivo(dataUrl) {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl || '');
  exigir(m, 'Arquivo inválido. Envie uma imagem ou vídeo.');
  exigir(TIPOS[m[1]], 'Formato não suportado. Use JPG, PNG, WEBP, GIF, MP4, WEBM ou MOV.');
  const buf = Buffer.from(m[2], 'base64');
  exigir(buf.length > 0 && buf.length <= TAMANHO_MAX, 'Arquivo vazio ou maior que 15 MB.');
  return { 1: m[1], buf };
}

function gravarArquivo(m, uploadsDir) {
  mkdirSync(uploadsDir, { recursive: true });
  const nome = `${randomUUID()}.${TIPOS[m[1]]}`;
  writeFileSync(join(uploadsDir, nome), m.buf);
  return nome;
}

export function salvar(db, usuario, dados, { uploadsDir }, agora) {
  const fase = texto(dados.fase) || 'antes';
  exigir(FASES_FOTO[fase] && fase !== 'padrao', 'Fase da fotografia inválida.');
  const m = validarArquivo(dados.arquivo);

  let hotelId; let quartoId = null; let osId = null; let inspecaoId = null; let itemId = null;
  if (dados.os_id) {
    const os = um(db, 'SELECT id, hotel_id, quarto_id FROM ordens_servico WHERE id = ?', Number(dados.os_id));
    exigir(os, 'Ordem de serviço não encontrada.', 404);
    ({ hotel_id: hotelId, quarto_id: quartoId, id: osId } = os);
  }
  if (dados.inspecao_item_id) {
    const it = um(db, `SELECT it.id, it.inspecao_id, it.os_id, i.hotel_id, i.quarto_id FROM inspecao_itens it
      JOIN inspecoes i ON i.id = it.inspecao_id WHERE it.id = ?`, Number(dados.inspecao_item_id));
    exigir(it, 'Item de inspeção não encontrado.', 404);
    hotelId = it.hotel_id; quartoId = it.quarto_id; inspecaoId = it.inspecao_id; itemId = it.id;
    osId = osId || it.os_id || null;
  }
  if (!hotelId && dados.quarto_id) {
    const q = buscarQuarto(db, Number(dados.quarto_id));
    hotelId = q.hotel_id; quartoId = q.id;
  }
  exigir(hotelId, 'Informe a OS, o item de inspeção ou o quarto da fotografia.');
  exigirHotel(usuario, hotelId);

  const nome = gravarArquivo(m, uploadsDir);
  const r = exec(
    db,
    `INSERT INTO fotos (hotel_id, quarto_id, os_id, inspecao_id, inspecao_item_id, fase, arquivo, mime, legenda, enviado_por, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    hotelId, quartoId, osId, inspecaoId, itemId, fase, nome, m[1], texto(dados.legenda) || null, usuario.id, agoraIso(agora)
  );
  if (osId) {
    exec(db, 'INSERT INTO os_eventos (os_id, usuario_id, tipo, texto, criado_em) VALUES (?, ?, ?, ?, ?)',
      osId, usuario.id, 'anexo', `${m[1].startsWith('video') ? 'Vídeo' : 'Fotografia'} anexado(a) — ${FASES_FOTO[fase]}${texto(dados.legenda) ? `: ${texto(dados.legenda)}` : ''}`, agoraIso(agora));
  }
  return Number(r.lastInsertRowid);
}

export function buscarArquivo(db, usuario, nome) {
  const f = um(db, 'SELECT * FROM fotos WHERE arquivo = ?', nome);
  exigir(f, 'Arquivo não encontrado.', 404);
  exigirHotel(usuario, f.hotel_id);
  return f;
}

// Galeria individual do quarto em ordem cronológica, com agrupamento antes/durante/depois por OS
// para a comparação visual.
export function galeriaQuarto(db, usuario, quartoId) {
  const q = buscarQuarto(db, quartoId);
  exigirHotel(usuario, q.hotel_id);
  const fotos = todos(
    db,
    `SELECT f.*, u.nome AS enviado_por_nome, o.protocolo, o.titulo AS os_titulo, i.item AS inspecao_item
     FROM fotos f LEFT JOIN usuarios u ON u.id = f.enviado_por LEFT JOIN ordens_servico o ON o.id = f.os_id
     LEFT JOIN inspecao_itens i ON i.id = f.inspecao_item_id
     WHERE f.quarto_id = ? AND f.fase <> 'padrao' ORDER BY f.criado_em, f.id`,
    quartoId
  );
  const porOs = new Map();
  for (const f of fotos.filter((x) => x.os_id)) {
    if (!porOs.has(f.os_id)) porOs.set(f.os_id, { os_id: f.os_id, protocolo: f.protocolo, titulo: f.os_titulo, antes: [], durante: [], depois: [], outras: [] });
    const g = porOs.get(f.os_id);
    const fase = f.fase === 'inspecao' ? 'antes' : f.fase === 'validacao' ? 'depois' : f.fase;
    (g[fase] || g.outras).push(f);
  }
  return { quarto: { id: q.id, numero: q.numero }, padrao: listarPadrao(db, q.id), fotos, comparativos: [...porOs.values()].filter((g) => g.antes.length && g.depois.length), porOs: [...porOs.values()] };
}

// ---- Fotos padrão (referência de como o quarto deve estar) ----
// Um mesmo arquivo pode ser aplicado a vários quartos (o andar inteiro ou o hotel),
// evitando enviar a mesma foto 105 vezes.
const PAPEIS_PADRAO = ['admin', 'gerente', 'governanta'];

export function salvarPadrao(db, usuario, quartoId, { fotos = [], legenda, aplicar = 'quarto' }, { uploadsDir }, agora) {
  exigir(PAPEIS_PADRAO.includes(usuario.papel), 'Seu perfil não pode definir fotos padrão.', 403);
  const q = buscarQuarto(db, quartoId);
  exigirHotel(usuario, q.hotel_id);
  exigir(Array.isArray(fotos) && fotos.length, 'Selecione ao menos uma fotografia.');
  const alvos = aplicar === 'hotel'
    ? todos(db, 'SELECT id FROM quartos WHERE hotel_id = ?', q.hotel_id)
    : aplicar === 'andar' && q.andar
      ? todos(db, 'SELECT id FROM quartos WHERE hotel_id = ? AND andar = ?', q.hotel_id, q.andar)
      : [{ id: q.id }];
  const arquivos = fotos.map((f) => validarArquivo(f.arquivo));
  const st = db.prepare(`INSERT INTO fotos (hotel_id, quarto_id, fase, arquivo, mime, legenda, enviado_por, criado_em)
    VALUES (?, ?, 'padrao', ?, ?, ?, ?, ?)`);
  for (const m of arquivos) {
    const nome = gravarArquivo(m, uploadsDir);
    for (const a of alvos) st.run(q.hotel_id, a.id, nome, m[1], texto(legenda) || null, usuario.id, agoraIso(agora));
  }
  return { fotos: arquivos.length, quartos: alvos.length };
}

export function listarPadrao(db, quartoId) {
  return todos(db, `SELECT f.*, u.nome AS enviado_por_nome FROM fotos f LEFT JOIN usuarios u ON u.id = f.enviado_por
    WHERE f.quarto_id = ? AND f.fase = 'padrao' ORDER BY f.id`, quartoId);
}

// Remove a foto padrão deste quarto ou, com `todos`, de todos os quartos que usam o mesmo arquivo.
export function removerPadrao(db, usuario, fotoId, { todos: emTodos = false } = {}, { uploadsDir }) {
  exigir(PAPEIS_PADRAO.includes(usuario.papel), 'Seu perfil não pode remover fotos padrão.', 403);
  const f = um(db, "SELECT * FROM fotos WHERE id = ? AND fase = 'padrao'", Number(fotoId));
  exigir(f, 'Foto padrão não encontrada.', 404);
  exigirHotel(usuario, f.hotel_id);
  const r = emTodos
    ? exec(db, "DELETE FROM fotos WHERE arquivo = ? AND fase = 'padrao' AND hotel_id = ?", f.arquivo, f.hotel_id)
    : exec(db, 'DELETE FROM fotos WHERE id = ?', f.id);
  if (!um(db, 'SELECT 1 AS x FROM fotos WHERE arquivo = ?', f.arquivo)) rmSync(join(uploadsDir, f.arquivo), { force: true });
  return Number(r.changes);
}
