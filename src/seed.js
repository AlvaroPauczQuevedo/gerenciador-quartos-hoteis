// Dados de demonstração: 3 hotéis, perfis de todos os papéis e um histórico de manutenção
// gerado pelo próprio fluxo do sistema (eventos, notificações e histórico consistentes).
import { deflateSync, crc32 } from 'node:zlib';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { abrirBanco, transacao, todos, um, exec, gravarConfig } from './db.js';
import { hashSenha, gerarSenha } from './domain/usuarios.js';
import { somarDias, somarHoras } from './domain/comum.js';
import * as quartos from './domain/quartos.js';
import * as os from './domain/os.js';
import * as fotos from './domain/fotos.js';
import * as inspecoes from './domain/inspecoes.js';
import { verificar } from './domain/agendador.js';
import { importarRede, gravarCredenciaisRede } from './rede.js';

// ---- imagem PNG de exemplo (sem dependências) ----
function png(w, h, pixel) {
  const linhas = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    linhas[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      linhas[o] = r; linhas[o + 1] = g; linhas[o + 2] = b;
    }
  }
  const bloco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
    return Buffer.concat([len, t, dados, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]);
}

// "Antes": parede com manchas; "depois": superfície uniforme.
const imgAntes = (semente) => `data:image/png;base64,${png(320, 200, (x, y) => {
  const mancha = Math.hypot(x - 90 - semente * 13, y - 80) < 38 || Math.hypot(x - 230, y - 130 + semente * 5) < 26;
  return mancha ? [120, 95, 70] : [205 - (y >> 4), 190 - (x >> 5), 170];
}).toString('base64')}`;
const imgDepois = () => `data:image/png;base64,${png(320, 200, (x, y) => [232 - (y >> 5), 236 - (y >> 5), 238]).toString('base64')}`;

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

export function popular(db, ctx, agoraRef = new Date().toISOString()) {
  const r = rng(42);
  const escolher = (arr) => arr[Math.floor(r() * arr.length)];
  const senha = hashSenha('demo123');

  transacao(db, () => {
    const hoteisDef = [
      { slug: 'atlantico', nome: 'Hotel Atlântico', cidade: 'Rio de Janeiro/RJ' },
      { slug: 'serra', nome: 'Hotel Serra Verde', cidade: 'Gramado/RS' },
      { slug: 'centro', nome: 'Hotel Centro Executivo', cidade: 'São Paulo/SP' },
    ];
    const addUser = (nome, login, papel, hotelId = null) =>
      Number(exec(db, 'INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id) VALUES (?, ?, ?, ?, ?)', nome, login, senha, papel, hotelId).lastInsertRowid);

    addUser('Ana Administradora', 'admin', 'admin');
    addUser('Helena Diretora', 'diretoria', 'diretoria');
    addUser('Fábio Financeiro', 'financeiro', 'aprovador_financeiro');

    const nomes = {
      atlantico: ['Carla Mendes', 'Rosa Lima', 'Jorge Batista', 'Paulo Reis', 'Marcos Silva'],
      serra: ['Bruno Kessler', 'Ivone Schmitt', 'Otávio Becker', 'Lucas Weber', 'Rafael Klein'],
      centro: ['Daniela Prado', 'Sônia Ramos', 'Eduardo Nunes', 'Tiago Alves', 'Gustavo Rocha'],
    };
    const H = {};
    for (const h of hoteisDef) {
      const id = Number(exec(db, 'INSERT INTO hoteis (nome, cidade) VALUES (?, ?)', h.nome, h.cidade).lastInsertRowid);
      const [g, gov, chefe, t1, t2] = nomes[h.slug];
      H[h.slug] = {
        id,
        gerente: addUser(g, `gerente.${h.slug}`, 'gerente', id),
        governanta: addUser(gov, `governanta.${h.slug}`, 'governanta', id),
        chefe: addUser(chefe, `manutencao.${h.slug}`, 'manutencao_chefe', id),
        tec1: addUser(t1, `tecnico1.${h.slug}`, 'tecnico', id),
        tec2: addUser(t2, `tecnico2.${h.slug}`, 'tecnico', id),
        quartos: {},
      };
    }
    const U = (id) => um(db, 'SELECT id, nome, papel, hotel_id FROM usuarios WHERE id = ?', id);
    const admin = U(1);

    // Quartos e equipamentos (cadastro inicial 1 ano atrás).
    const inicio = somarDias(agoraRef, -400);
    for (const [slug, h] of Object.entries(H)) {
      for (const andar of [1, 2, 3]) {
        for (const n of [1, 2, 3, 4]) {
          const numero = `${andar}0${n}`;
          const tipo = n === 4 ? 'Suíte' : andar === 3 ? 'Luxo' : 'Standard';
          const extras = tipo === 'Suíte' ? ['Cofre', 'Banheira de hidromassagem'] : [];
          const id = quartos.criar(db, admin, {
            hotel_id: h.id, numero, andar: String(andar), tipo, estrelas: 3 + Math.floor(r() * 3),
            periodicidade_inspecao_dias: slug === 'centro' ? 15 : 30,
            equipamentos: ['Ar-condicionado', 'Chuveiro', 'Televisão', 'Controle remoto', 'Frigobar', 'Secador de cabelo', ...extras],
          }, inicio);
          H[slug].quartos[numero] = id;
        }
      }
    }
    const equip = (quartoId, tipo) => um(db, 'SELECT id FROM equipamentos WHERE quarto_id = ? AND tipo = ?', quartoId, tipo)?.id ?? null;

    // ---- helpers de fluxo ----
    const abrir = (slug, t, d, abertoPor = 'gerente') => os.criar(db, U(H[slug][abertoPor]), { hotel_id: H[slug].id, ...d }, t);
    const acao = (slug, quem, id, a, dados, t) => os.executarAcao(db, U(typeof quem === 'number' ? quem : H[slug][quem]), id, a, { ...dados }, t);
    const foto = (slug, quem, osId, fase, arquivo, t, legenda) => fotos.salvar(db, U(H[slug][quem]), { os_id: osId, fase, arquivo, legenda }, ctx, t);

    function ciclo(slug, id, t0, o = {}) {
      const tec = o.tecnico || 'tec1';
      let t = somarHoras(t0, o.hReceber ?? 1 + r() * 3);
      if (!o.recebida) acao(slug, 'chefe', id, 'receber', {}, t);
      t = somarHoras(t, 0.5 + r());
      acao(slug, 'chefe', id, 'aceitar', { responsavel_id: H[slug][tec] }, t);
      if (o.orcamento) {
        t = somarHoras(t, 2);
        acao(slug, 'chefe', id, 'enviar_aprovacao', { valor: o.orcamento, descricao: 'Orçamento de peças e serviço', fornecedor: 'Fornecedor Regional Ltda.' }, t);
        t = somarHoras(t, 6 + r() * 20);
        os.executarAcao(db, U(3), id, 'autorizar', { texto: 'Aprovado conforme orçamento.' }, t);
      }
      t = somarHoras(t, o.hIniciar ?? 2 + r() * 10);
      acao(slug, tec, id, 'iniciar', {}, t);
      if (o.materiais) {
        t = somarHoras(t, 1);
        acao(slug, tec, id, 'aguardar_materiais', { materiais: o.materiais }, t);
        t = somarHoras(t, 12 + r() * 24);
        acao(slug, 'chefe', id, 'materiais_disponiveis', {}, t);
      }
      for (const c of o.custos || []) acao(slug, tec, id, 'registrar_custo', c, somarHoras(t, 1));
      t = somarHoras(t, o.hExec ?? 2 + r() * 20);
      foto(slug, tec, id, 'depois', imgDepois(), t, 'Serviço finalizado');
      acao(slug, tec, id, 'concluir', { texto: o.relatorio || 'Serviço executado e testado. Funcionamento normalizado.' }, t);
      if (o.correcao) {
        t = somarHoras(t, 6);
        acao(slug, 'gerente', id, 'solicitar_correcao', { texto: o.correcao }, t);
        t = somarHoras(t, 4);
        acao(slug, tec, id, 'iniciar', {}, t);
        t = somarHoras(t, 3);
        acao(slug, tec, id, 'concluir', { texto: 'Correção executada.' }, t);
      }
      if (o.validar !== false) {
        t = somarHoras(t, 4 + r() * 20);
        acao(slug, 'gerente', id, 'validar', { texto: 'Inspeção final ok.', liberar_quarto: true }, t);
      }
      return t;
    }

    const custo = (valor, descricao = 'Peças e componentes', tipo = 'material') => ({ tipo, descricao, valor });
    const dia = (d, h = 9) => somarHoras(somarDias(agoraRef, -d), h - 12);

    // ---- Cenário da especificação: Quarto 203 (ar-condicionado) com recorrência ----
    const q203 = H.atlantico.quartos['203'];
    const ac203 = equip(q203, 'Ar-condicionado');
    const ocorrencias203 = [
      { d: 290, desc: 'Ar-condicionado não está gelando. Hóspede reclamou do calor durante a noite.', custo: [custo(180, 'Recarga de gás refrigerante'), custo(120, 'Mão de obra técnica', 'mao_de_obra')] },
      { d: 230, desc: 'Ar-condicionado voltou a apresentar baixa refrigeração e ruído no compressor.', custo: [custo(450, 'Capacitor e relé do compressor'), custo(150, 'Mão de obra técnica', 'mao_de_obra')] },
      { d: 165, desc: 'Terceira falha no ar-condicionado: desarma após 20 minutos de uso, pingando água.', custo: [custo(380, 'Placa eletrônica recondicionada'), custo(160, 'Mão de obra técnica', 'mao_de_obra')] },
    ];
    for (const [i, o] of ocorrencias203.entries()) {
      const t = dia(o.d);
      const id = abrir('atlantico', t, {
        quarto_id: q203, equipamento_id: ac203, local: 'quarto', categoria: 'ar_condicionado', prioridade: 'alta',
        descricao: o.desc, impacto: 'alto', justificativa: 'Quarto não pode ser comercializado sem climatização.', bloqueio_quarto: true,
      });
      foto('atlantico', 'gerente', id, 'antes', imgAntes(i), t, 'Evaporadora com vazamento');
      ciclo('atlantico', id, t, { custos: o.custo });
    }
    // 4ª ocorrência em aberto (gera alerta de recorrência crítico).
    const os203 = abrir('atlantico', dia(4, 20), {
      quarto_id: q203, equipamento_id: ac203, local: 'quarto', categoria: 'ar_condicionado', prioridade: 'alta',
      descricao: 'Ar-condicionado parou completamente. Quarta ocorrência no ano neste equipamento.', impacto: 'alto',
      justificativa: 'Quarto indisponível para venda.', bloqueio_quarto: true,
    });
    foto('atlantico', 'gerente', os203, 'antes', imgAntes(5), dia(4, 20), 'Aparelho desligado');
    acao('atlantico', 'chefe', os203, 'receber', {}, dia(4, 22));
    acao('atlantico', 'chefe', os203, 'solicitar_orcamento', { texto: 'Avaliar substituição completa do aparelho — orçamento com fornecedor.' }, dia(3, 10));
    acao('atlantico', 'chefe', os203, 'enviar_aprovacao', { valor: 3890, descricao: 'Substituição do aparelho split 12.000 BTUs inverter, instalação inclusa', fornecedor: 'Clima Rio Refrigeração' }, dia(2, 15));

    // Ar-condicionado também recorrente no Centro (problema estrutural comum entre hotéis).
    const q301c = H.centro.quartos['301'];
    for (const d of [200, 120]) {
      const t = dia(d);
      const id = abrir('centro', t, {
        quarto_id: q301c, equipamento_id: equip(q301c, 'Ar-condicionado'), local: 'quarto', categoria: 'ar_condicionado',
        prioridade: 'alta', descricao: 'Ar-condicionado com vazamento de água na parede e baixa refrigeração.', impacto: 'medio',
      });
      ciclo('centro', id, t, { custos: [custo(260, 'Limpeza do dreno e recarga')] });
    }

    // Serra Verde 102: chuveiro volta a falhar logo após a intervenção.
    const q102s = H.serra.quartos['102'];
    let tFim = null;
    for (const [i, d] of [95, 70].entries()) {
      const t = dia(d);
      const id = abrir('serra', t, {
        quarto_id: q102s, equipamento_id: equip(q102s, 'Chuveiro'), local: 'banheiro', categoria: 'hidraulica',
        prioridade: i ? 'emergencial' : 'alta', descricao: i ? 'Chuveiro com cheiro de queimado e disjuntor desarmando. Risco elétrico.' : 'Chuveiro não esquenta a água.',
        impacto: i ? 'critico' : 'alto', bloqueio_quarto: !!i,
      });
      tFim = ciclo('serra', id, t, { custos: [custo(i ? 320 : 140, i ? 'Chuveiro novo e fiação' : 'Resistência')], correcao: i ? null : undefined });
    }
    // Infiltração crônica registrada a partir de inspeção (Serra Verde 201).
    const q201s = H.serra.quartos['201'];
    const ins201 = inspecoes.criar(db, U(H.serra.governanta), { quarto_id: q201s }, dia(40));
    for (const it of todos(db, 'SELECT * FROM inspecao_itens WHERE inspecao_id = ?', ins201)) {
      const resp = it.item === 'Vedação e rejuntes' ? 'atencao' : it.item === 'Estado da pintura' ? 'atencao' : it.item.startsWith('Outros') ? 'na' : 'conforme';
      inspecoes.responder(db, U(H.serra.governanta), it.id, { resposta: resp, observacao: resp === 'atencao' ? 'Mancha de umidade recorrente próxima ao box (desgaste, sem urgência).' : '' });
      if (it.item === 'Vedação e rejuntes') inspecoes.registrarCronico(db, U(H.serra.governanta), { inspecao_item_id: it.id }, dia(40, 10));
    }
    inspecoes.concluir(db, U(H.serra.governanta), ins201, { observacoes: 'Quarto em boas condições gerais; infiltração monitorada.' }, dia(40, 11));

    // ---- Histórico geral (últimos 6 meses) ----
    const catalogo = [
      { categoria: 'eletrica', local: 'quarto', desc: 'Tomada ao lado da cama sem energia.' },
      { categoria: 'hidraulica', local: 'banheiro', desc: 'Descarga com vazamento contínuo na bacia.' },
      { categoria: 'hidraulica', local: 'banheiro', desc: 'Ralo do box com escoamento lento.' },
      { categoria: 'iluminacao', local: 'corredor', desc: 'Lâmpadas queimadas no corredor do andar.', semQuarto: true },
      { categoria: 'pintura', local: 'quarto', desc: 'Pintura descascando na parede da cabeceira.' },
      { categoria: 'fechaduras_portas', local: 'quarto', desc: 'Fechadura eletrônica não reconhece o cartão.' },
      { categoria: 'mobiliario', local: 'quarto', desc: 'Gaveta da cômoda com corrediça quebrada.' },
      { categoria: 'equipamentos', local: 'quarto', desc: 'Televisão não liga.', equipamento: 'Televisão' },
      { categoria: 'equipamentos', local: 'quarto', desc: 'Frigobar não está refrigerando.', equipamento: 'Frigobar' },
      { categoria: 'marcenaria', local: 'recepcao', desc: 'Balcão da recepção com tampo solto.', semQuarto: true },
      { categoria: 'alvenaria', local: 'area_externa', desc: 'Piso da área da piscina com placas soltas.', semQuarto: true },
      { categoria: 'equipamentos', local: 'cozinha', desc: 'Forno combinado da cozinha com falha no termostato.', semQuarto: true },
      { categoria: 'equipamentos', local: 'lavanderia', desc: 'Secadora industrial fazendo barulho excessivo.', semQuarto: true },
      { categoria: 'estrutura_predial', local: 'area_externa', desc: 'Fissura na fachada próxima à janela do 2º andar.', semQuarto: true },
    ];
    const slugs = Object.keys(H);
    for (let i = 0; i < 45; i++) {
      const slug = slugs[i % 3];
      const c = escolher(catalogo);
      const numero = escolher(Object.keys(H[slug].quartos));
      const qid = c.semQuarto ? null : H[slug].quartos[numero];
      const t = dia(180 - i * 3.8, 8 + Math.floor(r() * 10));
      const prioridade = escolher(['alta', 'media', 'media', 'baixa']);
      const id = abrir(slug, t, {
        quarto_id: qid, equipamento_id: qid && c.equipamento ? equip(qid, c.equipamento) : null, local: c.local,
        categoria: c.categoria, prioridade, descricao: c.desc, impacto: escolher(['baixo', 'medio', 'alto']),
      }, r() < 0.25 ? 'governanta' : 'gerente');
      const fim = ciclo(slug, id, t, {
        tecnico: r() < 0.5 ? 'tec1' : 'tec2',
        hExec: prioridade === 'baixa' ? 60 + r() * 120 : 2 + r() * 40,
        custos: [custo(Math.round(40 + r() * 600), 'Material aplicado')].concat(r() < 0.3 ? [custo(Math.round(100 + r() * 300), 'Mão de obra terceirizada', 'terceiro')] : []),
        orcamento: r() < 0.12 ? Math.round(1500 + r() * 3000) : null,
        materiais: r() < 0.2 ? [{ descricao: 'Peça de reposição', quantidade: 1, unidade: 'un' }] : null,
        correcao: r() < 0.1 ? 'O problema persiste parcialmente; refazer o acabamento.' : null,
      });
      if (r() < 0.08) {
        acao(slug, 'gerente', id, 'reabrir', { texto: 'O problema voltou a ocorrer.' }, somarDias(fim, 2));
        ciclo(slug, id, somarDias(fim, 2), { hReceber: 0, recebida: true });
      }
    }

    // ---- Demandas em aberto, uma em cada etapa do fluxo ----
    const A = H.atlantico; const S = H.serra; const C = H.centro;
    abrir('atlantico', dia(0, 8), { quarto_id: A.quartos['104'], local: 'banheiro', categoria: 'hidraulica', prioridade: 'emergencial', descricao: 'Vazamento forte no registro do banheiro, água invadindo o quarto.', impacto: 'critico', justificativa: 'Risco de dano ao piso e ao quarto inferior.', bloqueio_quarto: true });
    abrir('atlantico', dia(1, 15), { quarto_id: A.quartos['302'], local: 'quarto', categoria: 'mobiliario', prioridade: 'baixa', descricao: 'Poltrona com tecido desgastado, sugerir reforma do estofado.', impacto: 'baixo' });
    const av = abrir('serra', dia(1, 9), { quarto_id: S.quartos['203'], local: 'quarto', categoria: 'eletrica', prioridade: 'media', descricao: 'Interruptor da luz principal faiscando ao ligar.', impacto: 'medio' });
    acao('serra', 'chefe', av, 'receber', {}, dia(1, 11));
    const ap = abrir('centro', dia(2, 10), { quarto_id: C.quartos['202'], local: 'quarto', categoria: 'pintura', prioridade: 'media', descricao: 'Retoque de pintura na parede atrás da TV após troca do suporte.', impacto: 'baixo' });
    acao('centro', 'chefe', ap, 'receber', {}, dia(2, 12));
    acao('centro', 'chefe', ap, 'aceitar', { responsavel_id: C.tec2 }, dia(2, 13));
    const ex = abrir('atlantico', dia(1, 7), { quarto_id: A.quartos['201'], local: 'quarto', categoria: 'fechaduras_portas', prioridade: 'alta', descricao: 'Porta do quarto não fecha corretamente — batente desalinhado.', impacto: 'alto', bloqueio_quarto: true });
    acao('atlantico', 'chefe', ex, 'receber', {}, dia(1, 8));
    acao('atlantico', 'chefe', ex, 'aceitar', { responsavel_id: A.tec2 }, dia(1, 8.5));
    acao('atlantico', 'tec2', ex, 'iniciar', {}, dia(1, 10));
    acao('atlantico', 'tec2', ex, 'registrar_dificuldade', { texto: 'Batente com madeira comprometida por cupim; será necessário substituir a guarnição.' }, dia(1, 12));
    const mat = abrir('serra', dia(3, 14), { quarto_id: S.quartos['304'], local: 'banheiro', categoria: 'hidraulica', prioridade: 'alta', descricao: 'Banheira de hidromassagem não liga o motor.', impacto: 'alto', equipamento_id: equip(S.quartos['304'], 'Banheira de hidromassagem') });
    acao('serra', 'chefe', mat, 'receber', {}, dia(3, 15));
    acao('serra', 'chefe', mat, 'aceitar', { responsavel_id: S.tec1 }, dia(3, 15.5));
    acao('serra', 'tec1', mat, 'iniciar', {}, dia(3, 17));
    acao('serra', 'tec1', mat, 'aguardar_materiais', { materiais: [{ descricao: 'Motobomba 1/2 CV para hidromassagem', quantidade: 1, unidade: 'un' }, { descricao: 'Kit de vedação', quantidade: 2, unidade: 'un' }] }, dia(2, 9));
    const orc = abrir('centro', dia(5, 9), { local: 'recepcao', categoria: 'estrutura_predial', prioridade: 'media', descricao: 'Infiltração no teto de gesso da recepção após chuvas.', impacto: 'medio' });
    acao('centro', 'chefe', orc, 'receber', {}, dia(5, 10));
    acao('centro', 'chefe', orc, 'solicitar_orcamento', { texto: 'Necessário orçamento de impermeabilização da laje com empresa especializada.' }, dia(5, 11));
    const val = abrir('centro', dia(3, 8), { quarto_id: C.quartos['103'], local: 'quarto', categoria: 'iluminacao', prioridade: 'media', descricao: 'Luminária de leitura piscando.', impacto: 'baixo' });
    const tv = somarHoras(dia(3, 8), 2);
    acao('centro', 'chefe', val, 'receber', {}, tv);
    acao('centro', 'chefe', val, 'aceitar', { responsavel_id: C.tec1 }, tv);
    acao('centro', 'tec1', val, 'iniciar', {}, somarHoras(tv, 3));
    fotos.salvar(db, U(C.tec1), { os_id: val, fase: 'depois', arquivo: imgDepois(), legenda: 'Luminária substituída' }, ctx, somarHoras(tv, 5));
    acao('centro', 'tec1', val, 'registrar_custo', { tipo: 'material', descricao: 'Luminária LED', valor: 89.9 }, somarHoras(tv, 5));
    acao('centro', 'tec1', val, 'concluir', { texto: 'Luminária substituída por modelo LED.' }, somarHoras(tv, 5));
    const cor = abrir('serra', dia(6, 10), { quarto_id: S.quartos['101'], local: 'quarto', categoria: 'pintura', prioridade: 'baixa', descricao: 'Retocar pintura do rodapé.', impacto: 'baixo' });
    ciclo('serra', cor, dia(6, 10), { validar: false, hExec: 20 });
    acao('serra', 'gerente', cor, 'solicitar_correcao', { texto: 'Tinta com tom diferente do original. Refazer.' }, dia(1, 16));
    const atr = abrir('atlantico', dia(9, 9), { quarto_id: A.quartos['303'], local: 'quarto', categoria: 'eletrica', prioridade: 'media', descricao: 'Tomada do frigobar com mau contato.', impacto: 'medio' });
    acao('atlantico', 'chefe', atr, 'receber', {}, dia(9, 10));
    acao('atlantico', 'chefe', atr, 'aceitar', { responsavel_id: A.tec1 }, dia(9, 11));
    const dev = abrir('centro', dia(2, 16), { local: 'lavanderia', categoria: 'outros', prioridade: 'baixa', descricao: 'Verificar barulho estranho na lavanderia.', impacto: 'baixo' }, 'governanta');
    acao('centro', 'chefe', dev, 'devolver', { texto: 'Por favor, informe qual equipamento e em que horário ocorre o barulho.' }, dia(2, 18));

    // ---- Inspeções concluídas e agenda ----
    const respostasPadrao = (i) => (r() < 0.82 ? 'conforme' : r() < 0.6 ? 'atencao' : i % 5 === 0 ? 'manutencao' : 'na');
    for (const [slug, h] of Object.entries(H)) {
      for (const [numero, qid] of Object.entries(h.quartos)) {
        if (qid === q201s) continue;
        const atraso = r();
        // ~25% dos quartos ficam com inspeção vencida.
        const d = atraso < 0.25 ? (slug === 'centro' ? 20 : 35) + Math.floor(r() * 20) : Math.floor(r() * 12) + 1;
        const ins = inspecoes.criar(db, U(h.governanta), { quarto_id: qid }, dia(d, 10));
        const itens = todos(db, 'SELECT * FROM inspecao_itens WHERE inspecao_id = ?', ins);
        itens.forEach((it, i) => {
          const resposta = numero === '203' && slug === 'atlantico' && it.equipamento_id === ac203 ? 'manutencao' : respostasPadrao(i);
          inspecoes.responder(db, U(h.governanta), it.id, { resposta, observacao: resposta === 'conforme' || resposta === 'na' ? '' : 'Verificar na próxima manutenção preventiva.' });
        });
        inspecoes.concluir(db, U(h.governanta), ins, {}, dia(d, 11));
      }
    }
    // Inspeção em andamento para demonstração.
    inspecoes.criar(db, U(A.governanta), { quarto_id: A.quartos['102'] }, dia(0, 9));
    // Quarto com baixa avaliação.
    exec(db, 'UPDATE quartos SET estrelas = 2 WHERE id IN (?, ?)', q203, S.quartos['304']);

    // Alertas de prazo/atraso no "agora" e notificações antigas marcadas como lidas.
    verificar(db, agoraRef);
    exec(db, 'UPDATE notificacoes SET lida = 1 WHERE criado_em < ?', somarDias(agoraRef, -3));
  });
}

// ---- Versão piloto: apenas o tri Hotel Executive Osório, sem dados fictícios ----
export const HOTEL_PILOTO = { nome: 'Tri Hotel Executive Osório', cidade: 'Osório/RS' };
const CONTAS_PILOTO = [
  ['Administração Executive Osório', 'admin', 'admin'],
  ['Gerência Executive Osório', 'gerencia', 'gerente'],
  ['Governança Executive Osório', 'governanca', 'governanta'],
  ['Manutenção Executive Osório', 'manutencao', 'manutencao_chefe'],
  ['Técnico de Manutenção', 'tecnico', 'tecnico'],
  ['Financeiro Executive Osório', 'financeiro', 'aprovador_financeiro'],
];

// Apartamentos informados pela gerência: 401–421, 501–521, 601–621, 701–721 e 801–821.
export const ANDARES_PILOTO = [4, 5, 6, 7, 8];
export const APTOS_POR_ANDAR = 21;

// Equipamentos de cada apartamento (base do histórico de falhas e da recorrência).
export const EQUIPAMENTOS_PILOTO = [
  'Ar-condicionado', 'Televisão', 'Controle remoto', 'Secador de cabelo', 'Chuveiro', 'Frigobar',
  'Telefone (ramal)', 'Campainha', 'Fechadura eletrônica', 'Economizador de energia',
];

// Checklist definido pela gerência, em dois grupos:
// - Crônicos: dependem de ocupação/budget ou não são emergenciais;
// - Básicos: necessários para o funcionamento do quarto e para a venda (critico = 1).
const CRONICOS = 'Crônicos — dependem de ocupação/budget';
const BASICOS = 'Básico para funcionamento e venda';
export const CHECKLIST_PILOTO = [
  { ambiente: CRONICOS, item: 'Pintura — parede da janela', categoria: 'pintura', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Pintura — parede da cabeceira', categoria: 'pintura', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Pintura — outras paredes', categoria: 'pintura', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Pintura — teto', categoria: 'pintura', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Espelho do banheiro', categoria: 'mobiliario', local: 'banheiro' },
  { ambiente: CRONICOS, item: 'Espelho do quarto', categoria: 'mobiliario', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Gesso', categoria: 'estrutura_predial', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Estado do criado-mudo', categoria: 'mobiliario', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Estado do armário', categoria: 'marcenaria', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Estado da bancada de trabalho', categoria: 'marcenaria', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Estado da porta principal', categoria: 'fechaduras_portas', local: 'quarto' },
  { ambiente: CRONICOS, item: 'Estado da porta do banheiro', categoria: 'fechaduras_portas', local: 'banheiro' },
  { ambiente: CRONICOS, item: 'Ar-condicionado — limpeza', categoria: 'ar_condicionado', local: 'quarto', equipamento: 'Ar-condicionado' },
  { ambiente: CRONICOS, item: 'Piso', categoria: 'alvenaria', local: 'quarto' },
  { ambiente: BASICOS, item: 'TV funcionando', categoria: 'equipamentos', local: 'quarto', equipamento: 'Televisão', critico: 1 },
  { ambiente: BASICOS, item: 'Controles da TV', categoria: 'equipamentos', local: 'quarto', equipamento: 'Controle remoto', critico: 1 },
  { ambiente: BASICOS, item: 'Secador de cabelo', categoria: 'equipamentos', local: 'banheiro', equipamento: 'Secador de cabelo', critico: 1 },
  { ambiente: BASICOS, item: 'Chuveiro', categoria: 'hidraulica', local: 'banheiro', equipamento: 'Chuveiro', critico: 1 },
  { ambiente: BASICOS, item: 'Campainha do apartamento', categoria: 'eletrica', local: 'quarto', equipamento: 'Campainha', critico: 1 },
  { ambiente: BASICOS, item: 'Roldanas do box', categoria: 'outros', local: 'banheiro', critico: 1 },
  { ambiente: BASICOS, item: 'Rejunte', categoria: 'alvenaria', local: 'banheiro', critico: 1 },
  { ambiente: BASICOS, item: 'Vazamento hidráulico', categoria: 'hidraulica', local: 'banheiro', critico: 1 },
  { ambiente: BASICOS, item: 'Pilha da porta (fechadura)', categoria: 'fechaduras_portas', local: 'quarto', equipamento: 'Fechadura eletrônica', critico: 1 },
  { ambiente: BASICOS, item: 'Contactora principal', categoria: 'eletrica', local: 'quarto', critico: 1 },
  { ambiente: BASICOS, item: 'Economizador de energia', categoria: 'eletrica', local: 'quarto', equipamento: 'Economizador de energia', critico: 1 },
  { ambiente: BASICOS, item: 'Frigobar', categoria: 'equipamentos', local: 'quarto', equipamento: 'Frigobar', critico: 1 },
  { ambiente: BASICOS, item: 'Ar-condicionado funcionando', categoria: 'ar_condicionado', local: 'quarto', equipamento: 'Ar-condicionado', critico: 1 },
  { ambiente: BASICOS, item: 'Maçaneta da janela', categoria: 'fechaduras_portas', local: 'quarto', critico: 1 },
  { ambiente: BASICOS, item: 'Cortinas', categoria: 'mobiliario', local: 'quarto', critico: 1 },
  { ambiente: BASICOS, item: 'Telefone (ramal)', categoria: 'equipamentos', local: 'quarto', equipamento: 'Telefone (ramal)', critico: 1 },
  { ambiente: BASICOS, item: 'Cama', categoria: 'mobiliario', local: 'quarto', critico: 1 },
];

// Retorna as credenciais geradas (senhas aleatórias, uma por conta).
export function popularPiloto(db) {
  return transacao(db, () => {
    gravarConfig(db, 'modo', 'piloto');
    const hotelId = Number(exec(db, 'INSERT INTO hoteis (nome, cidade, logo) VALUES (?, ?, ?)', HOTEL_PILOTO.nome, HOTEL_PILOTO.cidade, 'executive-osorio').lastInsertRowid);
    gravarConfig(db, `equipamentos:${hotelId}`, JSON.stringify(EQUIPAMENTOS_PILOTO));
    inspecoes.definirChecklist(db, hotelId, CHECKLIST_PILOTO);
    const credenciais = CONTAS_PILOTO.map(([nome, login, papel]) => {
      const senha = gerarSenha();
      exec(db, 'INSERT INTO usuarios (nome, login, senha_hash, papel, hotel_id) VALUES (?, ?, ?, ?, ?)',
        nome, login, hashSenha(senha), papel, papel === 'admin' ? null : hotelId);
      return { nome, login, papel, senha };
    });
    const admin = um(db, "SELECT id, nome, papel, hotel_id FROM usuarios WHERE papel = 'admin'");
    for (const andar of ANDARES_PILOTO) {
      quartos.criarLote(db, admin, { hotel_id: hotelId, andar: String(andar), inicio: andar * 100 + 1, fim: andar * 100 + APTOS_POR_ANDAR });
    }
    return credenciais;
  });
}

export function gravarCredenciais(dataDir, credenciais) {
  const caminho = join(dataDir, 'credenciais-piloto.txt');
  const linhas = [
    `Credenciais iniciais — ${HOTEL_PILOTO.nome} (versão piloto)`,
    `Geradas em ${new Date().toLocaleString('pt-BR')}. Entregue cada acesso ao responsável e peça para trocar a senha no primeiro login (menu "Alterar senha").`,
    'Apague este arquivo depois de distribuir os acessos.',
    '',
    `${'PERFIL'.padEnd(22)} ${'USUÁRIO'.padEnd(14)} SENHA`,
    ...credenciais.map((c) => `${c.papel.padEnd(22)} ${c.login.padEnd(14)} ${c.senha}`),
    '',
  ];
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(caminho, linhas.join('\n'), { encoding: 'utf8', mode: 0o600 });
  return caminho;
}

// CLI: node src/seed.js --reset [--demo]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = process.env.DATA_DIR || join(raiz, 'data');
  if (process.argv.includes('--reset')) {
    for (const f of ['hotelaria.db', 'hotelaria.db-wal', 'hotelaria.db-shm', 'credenciais-piloto.txt', 'credenciais-rede.txt']) rmSync(join(dataDir, f), { force: true });
    rmSync(join(dataDir, 'uploads'), { recursive: true, force: true });
  }
  const db = abrirBanco(join(dataDir, 'hotelaria.db'));
  if (um(db, 'SELECT id FROM usuarios LIMIT 1')) {
    console.log('O banco já possui dados. Use --reset para recriar.');
  } else if (process.argv.includes('--demo')) {
    gravarConfig(db, 'modo', 'demo');
    popular(db, { uploadsDir: join(dataDir, 'uploads') });
    console.log('Dados de demonstração carregados. Senha de todos os usuários: demo123');
  } else {
    const caminho = gravarCredenciais(dataDir, popularPiloto(db));
    const rede = gravarCredenciaisRede(dataDir, importarRede(db));
    console.log(`Versão piloto criada (${HOTEL_PILOTO.nome} + rede). Credenciais: ${caminho}${rede ? ` e ${rede}` : ''}`);
  }
  db.close();
}
