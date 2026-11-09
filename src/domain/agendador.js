// Verificações periódicas: prazos próximos, demandas atrasadas e inspeções vencidas (15.7 e 16).
import { todos, exec } from '../db.js';
import { STATUS_ENTREGUES } from './constantes.js';
import { agoraIso, somarHoras } from './comum.js';
import { gerar as gerarPreventivas } from './preventiva.js';
import { notificar, equipeManutencao, gerentesDoHotel, usuariosDoHotel } from './notificacoes.js';

const ENTREGUES_SQL = STATUS_ENTREGUES.map((s) => `'${s}'`).join(',');
// Antecedência do alerta de "prazo próximo" por prioridade (horas).
const ANTECEDENCIA = { emergencial: 1, alta: 6, media: 24, baixa: 48 };

export function verificar(db, agora) {
  const now = agoraIso(agora);
  let enviados = 0;

  const ativas = todos(db, `SELECT * FROM ordens_servico WHERE status NOT IN (${ENTREGUES_SQL}) AND prazo_previsto IS NOT NULL`);
  for (const os of ativas) {
    const rot = `${os.protocolo} — ${os.titulo}`;
    if (os.prazo_previsto < now) {
      if (!os.alerta_atraso_em) {
        enviados += notificar(db, [os.responsavel_id, os.aberto_por, ...equipeManutencao(db, os.hotel_id), ...gerentesDoHotel(db, os.hotel_id)], {
          tipo: 'atrasada', mensagem: `${rot} está atrasada (prazo: ${new Date(os.prazo_previsto).toLocaleString('pt-BR')}).`, os_id: os.id, quarto_id: os.quarto_id, agora,
        });
        exec(db, 'UPDATE ordens_servico SET alerta_atraso_em = ? WHERE id = ?', now, os.id);
      }
    } else if (!os.alerta_prazo_em && os.prazo_previsto <= somarHoras(now, ANTECEDENCIA[os.prioridade] ?? 24)) {
      enviados += notificar(db, [os.responsavel_id, ...equipeManutencao(db, os.hotel_id)], {
        tipo: 'prazo_proximo', mensagem: `O prazo de ${rot} vence em ${new Date(os.prazo_previsto).toLocaleString('pt-BR')}.`, os_id: os.id, quarto_id: os.quarto_id, agora,
      });
      exec(db, 'UPDATE ordens_servico SET alerta_prazo_em = ? WHERE id = ?', now, os.id);
    }
  }

  // Manutenção preventiva: gera as OS dos planos que venceram.
  enviados += gerarPreventivas(db, agora);

  // Inspeções vencidas: um único aviso por hotel a cada rodada, com a lista de quartos.
  const vencidas = todos(db, 'SELECT * FROM quartos WHERE proxima_inspecao_em < ? AND alerta_inspecao_enviado_em IS NULL ORDER BY hotel_id, CAST(numero AS INTEGER), numero', now);
  const porHotel = new Map();
  for (const q of vencidas) (porHotel.get(q.hotel_id) || porHotel.set(q.hotel_id, []).get(q.hotel_id)).push(q);
  for (const [hotelId, lista] of porHotel) {
    const nums = lista.map((q) => q.numero);
    const mensagem = lista.length === 1
      ? `A inspeção do quarto ${nums[0]} está vencida desde ${new Date(lista[0].proxima_inspecao_em).toLocaleDateString('pt-BR')}.`
      : `${lista.length} quartos com inspeção vencida: ${nums.slice(0, 12).join(', ')}${nums.length > 12 ? '…' : ''}.`;
    enviados += notificar(db, [...usuariosDoHotel(db, hotelId, ['governanta']), ...gerentesDoHotel(db, hotelId)], {
      tipo: 'inspecao_vencida', mensagem, quarto_id: lista.length === 1 ? lista[0].id : null, agora,
    });
    const st = db.prepare('UPDATE quartos SET alerta_inspecao_enviado_em = ? WHERE id = ?');
    for (const q of lista) st.run(now, q.id);
  }
  return enviados;
}
