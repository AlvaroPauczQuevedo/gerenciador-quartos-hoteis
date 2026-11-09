// Enumerações e rótulos compartilhados entre backend e frontend (exportados via /api/meta).

export const PAPEIS = {
  admin: 'Administrador geral',
  diretoria: 'Diretoria',
  gerente: 'Gerente de hotel',
  governanta: 'Governanta / inspeção',
  manutencao_chefe: 'Responsável pela manutenção',
  tecnico: 'Profissional de manutenção',
  aprovador_financeiro: 'Aprovador financeiro',
};

// Papéis com visão consolidada de toda a rede (seção 19).
export const PAPEIS_REDE = ['admin', 'diretoria'];

export const CATEGORIAS = {
  eletrica: 'Elétrica',
  hidraulica: 'Hidráulica',
  ar_condicionado: 'Ar-condicionado',
  marcenaria: 'Marcenaria',
  pintura: 'Pintura',
  alvenaria: 'Alvenaria',
  mobiliario: 'Mobiliário',
  equipamentos: 'Equipamentos',
  fechaduras_portas: 'Fechaduras e portas',
  iluminacao: 'Iluminação',
  estrutura_predial: 'Estrutura predial',
  outros: 'Outros',
};

export const LOCAIS = {
  quarto: 'Quarto',
  banheiro: 'Banheiro',
  corredor: 'Corredor',
  recepcao: 'Recepção',
  area_externa: 'Área externa',
  cozinha: 'Cozinha',
  lavanderia: 'Lavanderia',
  restaurante: 'Restaurante',
  area_lazer: 'Área de lazer',
  estacionamento: 'Estacionamento',
  outro: 'Outro',
};

export const PRIORIDADES = {
  emergencial: 'Emergencial',
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

export const PRIORIDADE_DESCRICAO = {
  emergencial: 'Risco à segurança, higiene ou funcionamento essencial. Atendimento prioritário.',
  alta: 'Compromete a comercialização do quarto ou o funcionamento de uma área importante.',
  media: 'Precisa de resolução, mas permite planejamento do atendimento.',
  baixa: 'Melhorias, ajustes e serviços sem impacto imediato na operação.',
};

// Prazo padrão (em horas) quando nem o gerente nem a manutenção definem prazo.
export const SLA_HORAS = { emergencial: 4, alta: 24, media: 72, baixa: 168 };

export const IMPACTOS = {
  nenhum: 'Sem impacto na operação',
  baixo: 'Baixo — incômodo pontual',
  medio: 'Médio — afeta a experiência do hóspede',
  alto: 'Alto — impede uso do quarto/área',
  critico: 'Crítico — risco à segurança ou à operação do hotel',
};

export const STATUS = {
  nova: 'Nova solicitação',
  em_avaliacao: 'Aguardando avaliação',
  devolvida_complementacao: 'Devolvida para complementação',
  aguardando_orcamento: 'Aguardando orçamento',
  aguardando_autorizacao: 'Aguardando autorização',
  aprovada: 'Aprovada',
  em_execucao: 'Em execução',
  aguardando_materiais: 'Aguardando materiais',
  concluida: 'Concluída — aguardando validação',
  em_correcao: 'Devolvida para correção',
  encerrada: 'Encerrada',
  recusada: 'Recusada',
  cancelada: 'Cancelada',
};

export const STATUS_FINAIS = ['encerrada', 'recusada', 'cancelada'];
// Status em que o serviço já foi entregue (não conta como atrasado).
export const STATUS_ENTREGUES = ['concluida', ...STATUS_FINAIS];

export const FASES_FOTO = {
  antes: 'Estado inicial',
  durante: 'Durante a manutenção',
  depois: 'Após a conclusão',
  inspecao: 'Inspeção',
  validacao: 'Inspeção final (validação)',
  padrao: 'Foto padrão (referência)',
};

export const RESPOSTAS_INSPECAO = {
  conforme: 'Conforme',
  atencao: 'Necessita de atenção',
  manutencao: 'Necessita de manutenção',
  na: 'Não aplicável',
};

export const TIPOS_CUSTO = {
  material: 'Material',
  mao_de_obra: 'Mão de obra',
  terceiro: 'Serviço de terceiros',
  outro: 'Outro',
};

// Checklist padrão das inspeções (seção 16). `equipamento` liga o item ao tipo de
// equipamento do quarto, para que a recorrência seja calculada por equipamento.
export const CHECKLIST_PADRAO = [
  { ambiente: 'Quarto', item: 'Estado da pintura', categoria: 'pintura', local: 'quarto' },
  { ambiente: 'Quarto', item: 'Conservação dos móveis', categoria: 'mobiliario', local: 'quarto' },
  { ambiente: 'Quarto', item: 'Estado da cama e colchão', categoria: 'mobiliario', local: 'quarto' },
  { ambiente: 'Quarto', item: 'Funcionamento das tomadas', categoria: 'eletrica', local: 'quarto' },
  { ambiente: 'Quarto', item: 'Funcionamento da iluminação', categoria: 'iluminacao', local: 'quarto' },
  { ambiente: 'Quarto', item: 'Estado das portas e fechaduras', categoria: 'fechaduras_portas', local: 'quarto' },
  { ambiente: 'Quarto', item: 'Funcionamento do ar-condicionado', categoria: 'ar_condicionado', local: 'quarto', equipamento: 'Ar-condicionado' },
  { ambiente: 'Banheiro', item: 'Funcionamento do chuveiro', categoria: 'hidraulica', local: 'banheiro', equipamento: 'Chuveiro' },
  { ambiente: 'Banheiro', item: 'Funcionamento da descarga', categoria: 'hidraulica', local: 'banheiro' },
  { ambiente: 'Banheiro', item: 'Torneiras e registros', categoria: 'hidraulica', local: 'banheiro' },
  { ambiente: 'Banheiro', item: 'Ralos e escoamento', categoria: 'hidraulica', local: 'banheiro' },
  { ambiente: 'Banheiro', item: 'Vedação e rejuntes', categoria: 'alvenaria', local: 'banheiro' },
  { ambiente: 'Banheiro', item: 'Espelho e acessórios', categoria: 'mobiliario', local: 'banheiro' },
  { ambiente: 'Banheiro', item: 'Condições de higiene', categoria: 'outros', local: 'banheiro' },
  { ambiente: 'Equipamentos', item: 'Televisão', categoria: 'equipamentos', local: 'quarto', equipamento: 'Televisão' },
  { ambiente: 'Equipamentos', item: 'Controle remoto', categoria: 'equipamentos', local: 'quarto', equipamento: 'Controle remoto' },
  { ambiente: 'Equipamentos', item: 'Frigobar', categoria: 'equipamentos', local: 'quarto', equipamento: 'Frigobar' },
  { ambiente: 'Equipamentos', item: 'Ar-condicionado', categoria: 'ar_condicionado', local: 'quarto', equipamento: 'Ar-condicionado' },
  { ambiente: 'Equipamentos', item: 'Secador de cabelo', categoria: 'equipamentos', local: 'banheiro', equipamento: 'Secador de cabelo' },
];

export const EQUIPAMENTOS_PADRAO = ['Ar-condicionado', 'Chuveiro', 'Televisão', 'Controle remoto', 'Frigobar', 'Secador de cabelo'];

// Janelas usadas pelo índice de recorrência (seção 17).
export const RECORRENCIA = {
  janelaDias: 365,        // histórico considerado
  intervaloCurtoDias: 45, // manutenções repetidas em curto intervalo
  retornoDias: 60,        // problema que volta após uma intervenção concluída
};

export const NOTIFICACAO_TIPOS = {
  nova_demanda: 'Nova demanda',
  recebida: 'Demanda recebida',
  aprovada: 'Solicitação aprovada',
  recusada: 'Solicitação recusada',
  devolvida: 'Devolvida para complementação',
  designacao: 'Profissional designado',
  prazo_proximo: 'Prazo próximo',
  atrasada: 'Demanda atrasada',
  materiais: 'Necessidade de materiais',
  orcamento: 'Orçamento aguardando aprovação',
  concluida: 'Serviço concluído',
  correcao: 'Correção solicitada',
  reaberta: 'Demanda reaberta',
  comentario: 'Novo comentário',
  prioridade: 'Prioridade reavaliada',
  recorrencia: 'Recorrência detectada',
  inspecao_vencida: 'Inspeção vencida',
  quarto_bloqueado: 'Quarto bloqueado',
  quarto_liberado: 'Quarto liberado',
};

export const ORIGENS_AVALIACAO = {
  booking: 'Booking.com', google: 'Google', tripadvisor: 'TripAdvisor', expedia: 'Expedia',
  pesquisa: 'Pesquisa interna', recepcao: 'Reclamação na recepção', outro: 'Outro',
};

export function meta() {
  return {
    ORIGENS_AVALIACAO,
    PAPEIS, CATEGORIAS, LOCAIS, PRIORIDADES, PRIORIDADE_DESCRICAO, SLA_HORAS, IMPACTOS,
    STATUS, STATUS_FINAIS, FASES_FOTO, RESPOSTAS_INSPECAO, TIPOS_CUSTO, NOTIFICACAO_TIPOS,
    EQUIPAMENTOS_PADRAO,
  };
}
