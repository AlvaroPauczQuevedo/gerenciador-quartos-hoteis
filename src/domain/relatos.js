// Relato de problema pelo QR code do quarto, sem login (camareira, recepção, hóspede).
// Fica desligado por padrão e é ligado por hotel (administrador ou gerente). Como a página é pública,
// há limites: no servidor (por IP) e aqui (por quarto), campo-isca contra robôs, prioridade fixa em
// "média" (emergência o relator avisa por telefone) e uma única foto leve.
import { um, exec } from '../db.js';
import { exigir, exigirPapel, exigirHotel, texto, agoraIso, somarHoras } from './comum.js';
import { CATEGORIAS } from './constantes.js';
import * as os from './os.js';
import * as fotos from './fotos.js';

export const MAX_RELATOS_POR_QUARTO_DIA = 6;
const FOTO_MAX_BASE64 = 6 * 1024 * 1024;

export function dadosPublicos(db, quartoId) {
  const q = um(db, `SELECT q.id, q.numero, h.nome AS hotel, h.relato_publico AS ativo FROM quartos q
    JOIN hoteis h ON h.id = q.hotel_id WHERE q.id = ? AND h.ativo = 1`, Number(quartoId));
  exigir(q, 'Quarto não encontrado.', 404);
  return { quarto_id: q.id, numero: q.numero, hotel: q.hotel, ativo: !!q.ativo, categorias: CATEGORIAS };
}

// Os relatos entram em nome de uma conta técnica por hotel: não consegue entrar no sistema
// (arquivada, sem senha) e não aparece na lista de usuários.
function contaDeRelato(db, hotelId, agora) {
  const login = `relato-qr-${hotelId}`;
  const existente = um(db, 'SELECT id, nome, papel, hotel_id FROM usuarios WHERE login = ?', login);
  if (existente) return existente;
  const id = Number(exec(db, `INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id, ativo, excluido_em, trocar_senha)
    VALUES ('Relato pelo QR code', ?, '!', 'governanta', ?, 0, ?, 0)`, login, hotelId, agoraIso(agora)).lastInsertRowid);
  return { id, nome: 'Relato pelo QR code', papel: 'governanta', hotel_id: hotelId };
}

export function registrar(db, dados, ctx, agora) {
  const q = um(db, `SELECT q.id, q.numero, q.hotel_id, h.relato_publico AS ativo FROM quartos q
    JOIN hoteis h ON h.id = q.hotel_id WHERE q.id = ? AND h.ativo = 1`, Number(dados.quarto_id));
  exigir(q, 'Quarto não encontrado.', 404);
  exigir(q.ativo, 'O relato pelo QR code não está ativo neste hotel. Avise a recepção.', 403);
  if (texto(dados.site)) return { protocolo: 'OS-0000-00000' }; // campo-isca preenchido: é robô; finge sucesso

  const descricao = texto(dados.descricao);
  exigir(descricao.length >= 10, 'Descreva o problema com mais detalhes (mínimo de 10 caracteres).');
  exigir(descricao.length <= 1000, 'Descrição longa demais (máximo de 1000 caracteres).');
  const categoria = CATEGORIAS[dados.categoria] ? dados.categoria : 'outros';
  const nome = texto(dados.nome).slice(0, 60);
  if (dados.foto) {
    exigir(/^data:image\/(jpeg|png|webp);base64,/.test(dados.foto) && dados.foto.length <= FOTO_MAX_BASE64, 'A foto deve ser JPG, PNG ou WEBP de até 4 MB.');
  }
  const recentes = um(db, "SELECT COUNT(*) AS n FROM ordens_servico WHERE quarto_id = ? AND origem = 'qr' AND criado_em > ?",
    q.id, somarHoras(agoraIso(agora), -24)).n;
  exigir(recentes < MAX_RELATOS_POR_QUARTO_DIA, 'Já recebemos vários relatos deste quarto hoje. A equipe foi avisada; se for urgente, ligue para a recepção.', 429);

  const autor = contaDeRelato(db, q.hotel_id, agora);
  const id = os.criar(db, autor, {
    quarto_id: q.id, local: 'quarto', categoria, prioridade: 'media', origem: 'qr',
    justificativa: 'Problema relatado pelo QR code do quarto.',
    descricao: nome ? `${descricao}\n\nRelatado por: ${nome}` : descricao,
  }, agora);
  if (dados.foto) fotos.salvar(db, autor, { os_id: id, fase: 'antes', arquivo: dados.foto }, ctx, agora);
  return { protocolo: os.buscar(db, id).protocolo };
}

export function definirAtivo(db, usuario, hotelId, ativo) {
  exigirPapel(usuario, 'admin', 'gerente');
  exigirHotel(usuario, hotelId);
  const h = um(db, 'SELECT id, nome FROM hoteis WHERE id = ?', Number(hotelId));
  exigir(h, 'Hotel não encontrado.', 404);
  exec(db, 'UPDATE hoteis SET relato_publico = ? WHERE id = ?', ativo ? 1 : 0, h.id);
  return h;
}
