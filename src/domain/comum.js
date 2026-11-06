import { PAPEIS_REDE } from './constantes.js';
import { um } from '../db.js';

export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export const falha = (status, msg) => { throw new ErroHttp(status, msg); };
export const exigir = (cond, msg, status = 400) => { if (!cond) falha(status, msg); };

// Relógio injetável: os testes e o agendador passam `agora` explicitamente.
export const agoraIso = (agora) => (agora ? new Date(agora) : new Date()).toISOString();
export const somarHoras = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3).toISOString();
export const somarDias = (iso, d) => somarHoras(iso, d * 24);
export const horasEntre = (a, b) => (new Date(b) - new Date(a)) / 3600e3;

export function normalizarData(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const d = new Date(valor);
  exigir(!Number.isNaN(d.getTime()), `Data inválida: ${valor}`);
  return d.toISOString();
}

export const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

// ---- Escopo multi-hotel (seção 19) ----
// Diretoria/administração enxergam toda a rede; os demais perfis apenas a sua unidade.
// Usuários de manutenção/aprovação sem hotel vinculado atendem toda a rede.
export const visaoRede = (u) => PAPEIS_REDE.includes(u.papel) || u.hotel_id == null;

export function podeVerHotel(u, hotelId) {
  return visaoRede(u) || Number(u.hotel_id) === Number(hotelId);
}

export function exigirHotel(u, hotelId) {
  exigir(podeVerHotel(u, hotelId), 'Sem permissão para acessar esta unidade.', 403);
}

// Fragmento SQL para filtrar por escopo. Retorna { sql, params }.
export function filtroHotel(u, coluna = 'hotel_id', hotelIdFiltro) {
  if (hotelIdFiltro) {
    exigirHotel(u, hotelIdFiltro);
    return { sql: ` AND ${coluna} = ?`, params: [Number(hotelIdFiltro)] };
  }
  if (visaoRede(u)) return { sql: '', params: [] };
  return { sql: ` AND ${coluna} = ?`, params: [u.hotel_id] };
}

export function exigirPapel(u, ...papeis) {
  exigir(papeis.includes(u.papel), 'Seu perfil não tem permissão para esta ação.', 403);
}

export function buscarQuarto(db, id) {
  const q = um(db, 'SELECT * FROM quartos WHERE id = ?', id);
  exigir(q, 'Quarto não encontrado.', 404);
  return q;
}
