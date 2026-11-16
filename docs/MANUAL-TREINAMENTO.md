# Manual de Acessos e Treinamento — Manutenção Tri Hotéis

O sistema registra cada problema de manutenção como uma **ordem de serviço (OS)** e acompanha esse problema até a solução ser validada por quem pediu. Cada pessoa entra com o próprio usuário e vê apenas o que o seu perfil permite.

Endereço: https://hotpink-butterfly-390092.hostingersite.com

---

## 1. Primeiros passos (todos os perfis)

1. **Entrar:** use o **nome de usuário** e a senha recebidos do gerente (não há e-mail). Toque no ícone de olho para conferir a senha enquanto digita.
2. **Trocar a senha:** no primeiro acesso, o sistema obriga a criar uma senha própria. Depois, ela pode ser trocada a qualquer momento em **Alterar senha**, no rodapé do menu.
3. **Instalar no celular:**
   - **Android/Chrome:** toque em **📲 Instalar** no topo da tela.
   - **iPhone:** abra no **Safari** → botão Compartilhar → **Adicionar à Tela de Início**.
4. **Ativar as notificações:** em **Notificações**, toque em **Ativar notificações no aparelho**. O sino 🔔 mostra o que chegou: demandas novas, aprovações, conclusões, prazos.
5. **QR code da porta:** apontar a câmera para a etiqueta abre direto a ficha daquele quarto.
6. **Esqueceu a senha?** Peça ao gerente do hotel, que gera uma nova senha provisória.

---

## 2. Níveis de acesso

| Perfil | Quem é | Hotéis que vê | Papel principal |
| --- | --- | --- | --- |
| Administrador geral | TI / coordenação da rede | Todos | Configura a rede, hotéis, usuários, importações e backups |
| Diretoria | Diretores da rede | Todos | Acompanha indicadores e autoriza orçamentos |
| Gerente de hotel | Gerente da unidade | O próprio hotel | Dono da operação do hotel: recebe as demandas e distribui aos técnicos; equipe, quartos, checklist, validação |
| Governanta / inspeção | Governança | O próprio hotel | Inspeciona quartos e abre solicitações |
| Profissional de manutenção | Técnico | O próprio hotel | Executa os serviços |

Não existe chefe de manutenção: o gerente recebe cada solicitação e a distribui direto para um técnico.

O gerente cria e gerencia os usuários do próprio hotel (governanta, técnicos e outros gerentes). Usuários de administração e diretoria só o administrador cria.

---

## 3. Módulos × perfis

Legenda: ✅ acesso completo · 👁 consulta · ◐ acesso parcial (ver observação) · — sem acesso

| Módulo | Admin | Diretoria | Gerente | Governanta | Técnico |
| --- | --- | --- | --- | --- | --- |
| Início (painel) | ✅ | ✅ | ✅ | ✅ | ✅ "Meus serviços" |
| Nova solicitação (abrir OS) | ✅ | — | ✅ | ✅ | — |
| Demandas / Painel da manutenção | ✅ | ✅ | ✅ | ✅ | ✅ |
| Quartos (ficha, fotos, histórico) | ✅ | ◐ ¹ | ✅ | ◐ ² | 👁 |
| Etiquetas QR code | ✅ | — | ✅ | ✅ | — |
| Inspeções | ✅ | — | ✅ | ✅ | — |
| Preventiva | ✅ | — | ✅ | — | — |
| Estoque | ✅ | — | ✅ | — | ◐ só retirada |
| Avaliações de hóspedes | ✅ | 👁 | ✅ | ◐ registra | 👁 |
| Indicadores e Excel | ✅ | ✅ | ✅ | — | — |
| Recorrência | ✅ | ✅ | ✅ | — | — |
| Visão da rede | ✅ | ✅ | — | — | — |
| Cadastros / Equipe | ✅ rede toda | — | ✅ "Equipe e cadastros" | — | — |
| Checklist de inspeção | ✅ | — | ✅ do seu hotel | — | — |
| Importar quartos (HITS) | ✅ | — | — | — | — |
| Obrigações legais e contratos | ✅ | 👁 | ✅ | — | — |
| Relato pelo QR, sem login (ligar/desligar) | ✅ | — | ✅ | — | — |
| Registro de ações (auditoria) e aba Acessos | ✅ | ✅ | ✅ do seu hotel | — | — |
| Backups | ✅ | — | — | — | — |
| Notificações | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trabalhar sem internet (OS guardadas e envios pendentes) | — | — | — | — | ✅ |
| Minha conta (duas etapas e aparelhos) | ✅ | ✅ | ✅ | ✅ | ✅ |

¹ Diretoria: bloqueia/libera quarto para venda, define estrelas e registra problemas crônicos; não edita o cadastro.
² Governanta: inspeciona, programa inspeções, registra fotos padrão e avaliações de hóspedes.

**Alçada de aprovação:** o gerente aprova orçamentos até o limite configurado para o hotel. Acima disso, a aprovação é da diretoria ou do administrador geral.

**Atrasos:** quando uma OS vence o prazo, o gerente é avisado. Se o atraso passar do limite da prioridade (emergencial 2 h, alta 12 h, média 24 h, baixa 48 h), a diretoria e o administrador também são avisados.

---

## 4. Como o sistema funciona — o caminho de uma OS

```
 Solicitante abre a OS (gerente ou governanta)
        │
        ▼
 Nova solicitação ──► Gerente avalia ──────► Aguardando avaliação
                                                │
          ┌─────────────── Devolvida para complementação ◄──┤ (falta informação)
          │  solicitante completa e reenvia                 ├──► Recusada
          └──────────────────────────────────────────────►  │
                                                            ▼
                              Precisa de orçamento? ── sim ──► Aguardando autorização
                                     │ não                        │ autorizado     │ recusado → volta p/ avaliação
                                     ▼                            ▼
                                  Aprovada ◄──────────────────────┘
                                     │  gerente designa o técnico (ou técnico assume)
                                     ▼
                                Em execução ⇄ Aguardando materiais
                                     │  técnico registra conclusão (com fotos)
                                     ▼
                       Concluída — aguardando validação
                          │ aprovado                │ problema
                          ▼                         ▼
                      Encerrada            Devolvida para correção → volta para execução
```

- **Emergência:** OS de prioridade emergencial pode ser iniciada antes da aprovação do orçamento; a aprovação fica registrada depois.
- **Quarto bloqueado:** quando o problema impede a venda, o quarto é bloqueado e liberado de novo ao encerrar a OS.
- **Cancelamento:** o solicitante ou o gerente cancela enquanto a OS ainda não entrou em execução.
- **Histórico:** cada passo fica registrado na própria OS (quem, quando, o quê), com fotos de antes e depois.
- **Origem da OS:** pode ser aberta manualmente, a partir de um item reprovado na inspeção, gerada pela preventiva (plano vencendo) ou a partir de uma reclamação de hóspede.

---

## 5. Treinamento por perfil

### 5.1 Governanta / inspeção

**Rotina diária**
1. **Início:** veja inspeções programadas para hoje e suas solicitações em aberto.
2. **Inspecionar um quarto:** em **Inspeções** → escolha o quarto (ou leia o QR da porta) → **Iniciar inspeção**. Para cada item do checklist, marque **OK** ou **Não OK**; em "Não OK", descreva e tire foto. Cada item reprovado pode virar uma OS na hora (botão de gerar solicitação), ou todas de uma vez ao concluir a inspeção, marcando a opção de gerar as solicitações automaticamente.
3. **Sem internet?** A inspeção continua funcionando; as respostas ficam guardadas no celular e são enviadas quando a conexão voltar.
4. **Abrir uma solicitação avulsa:** **Nova solicitação** → quarto ou área → categoria (elétrica, hidráulica…) → prioridade → descrição clara → foto. Prioridade emergencial só para o que impede o uso do quarto ou traz risco.
5. **Validar o serviço:** quando o técnico concluir uma OS que você abriu, você recebe a notificação. Confira no quarto e use **Aprovar serviço** ou **Solicitar correção** (diga o que ficou errado).
6. **Avaliações de hóspedes:** na ficha do quarto, registre a nota, a origem (Booking, Google, recepção…) e o comentário. Se houver um problema a resolver, marque para gerar a solicitação junto.
7. **Fotos padrão:** na ficha do quarto, registre como o quarto deve estar arrumado, para servir de referência.

**Boas práticas:** uma OS por problema; descrição com "o quê + onde" ("torneira do banheiro pingando"); sempre com foto.

### 5.2 Profissional de manutenção (técnico)

1. **Meus serviços:** lista o que o gerente designou para você e o que está disponível para assumir.
2. **Receber o serviço:** você é avisado quando o gerente designa uma OS para você. Se ele liberar sem designar, todos os técnicos são avisados e quem puder usa **Assumir demanda**.
3. **Executar:** **Iniciar execução** ao chegar no local. Tire a foto do **antes**.
4. **Durante:** se faltar peça, **Pausar: aguardando materiais**; para usar algo do almoxarifado, **Usar material do estoque**; se houver imprevisto, **Registrar dificuldade**. Custos extras em **Registrar custo**.
5. **Precisa de orçamento?** Use **Informar necessidade de orçamento**; o gerente encaminha para aprovação.
6. **Concluir:** **Registrar conclusão** com descrição do que foi feito e a foto do **depois**. A OS vai para validação do solicitante.
7. **Sem sinal?** Continue trabalhando: o sistema guarda suas OS no aparelho. Sem internet você consulta a OS, assume, inicia, pausa por material, registra dificuldade e custo, usa material do estoque, anexa fotos, comenta e registra a conclusão. Uma faixa amarela avisa que está sem conexão, e as ações ficam em **Envios pendentes**, enviadas sozinhas na ordem em que você fez, quando a internet voltar. Se uma ação for recusada (por exemplo, o gerente já tratou a demanda), ela aparece lá com o motivo para você refazer ou descartar. Dica: abra o app com internet antes de ir para uma área sem sinal, para atualizar as OS guardadas. Antes de **Sair** da conta, confira se não há envios pendentes: ao sair, o que não foi enviado é perdido.
8. **Correção:** se o solicitante devolver, a OS volta para você com o motivo; corrija e conclua de novo.

### 5.3 Gerente de hotel

O gerente coordena a manutenção do hotel: recebe as solicitações e distribui direto para os técnicos. Também faz tudo o que a governanta faz.

**Rotina diária: distribuir e acompanhar**
1. **Início:** comece por **Novas solicitações para aceitar e designar**, **Demandas atrasadas** e **Concluídas aguardando sua validação**.
2. **Aceitar e designar:** abra a OS → **Aceitar e designar técnico** → escolha o técnico e o prazo. O técnico é avisado na hora. Sem técnico escolhido, todos os técnicos do hotel são avisados e o primeiro que puder assume. Quando **você mesmo** abre a solicitação, já pode escolher o técnico em **Designar técnico agora**, e ela nasce aceita.
3. **Se não der para aceitar:** **Devolver para complementação** quando faltar informação; **Recusar solicitação** com justificativa quando não for caso de manutenção.
4. **Organizar:** **Definir prazo**, **Reavaliar prioridade**, **Designar profissional** (trocar o técnico) ou **Distribuir atividade** (várias tarefas para técnicos diferentes na mesma OS).
5. **Orçamento:** **Encaminhar orçamento para aprovação** com valor e descrição. Até o limite do hotel, você mesmo autoriza; acima, vai para a diretoria ou o administrador.
6. **Materiais:** quando o técnico pausa por falta de material, você é avisado. Com o material em mãos, use **Materiais disponíveis — retomar execução**.
7. **Validar:** confira o serviço concluído e use **Aprovar serviço** (com nota de 1 a 5 para o serviço, opcional) ou **Solicitar correção**. Pode também **Reabrir demanda** se o problema voltar. A média das notas aparece em Indicadores.

**Obrigações legais**
1. Em **Obrigações legais**, use **Criar lista padrão** (PMOC, caixa d'água, extintores, AVCB, dedetização, elevadores, gerador, caixa de gordura, SPDA). Desative o que o hotel não tem e ajuste a periodicidade com seu engenheiro responsável.
2. Para cada uma, **Registrar realização**: data, empresa, custo e o **comprovante** (foto ou PDF). O próximo vencimento é calculado sozinho (ou use a validade que consta no comprovante).
3. Você recebe aviso 30 e 7 dias antes de vencer; se vencer, a diretoria também é avisada. A tela inicial mostra o resumo.

**Relato pelo QR code (sem login)**
1. Em **Equipe e cadastros**, marque **Permitir relato pelo QR code neste hotel**.
2. Quem escanear o QR da porta sem ter login (camareira, recepção, hóspede) vê um formulário com foto opcional. A solicitação chega para você com prioridade média e origem "QR code"; trate como qualquer OS (aceitar e designar, recusar etc.). Há limites contra abuso; para emergências, a pessoa deve ligar para a recepção.

**Gestão do hotel**
1. **Equipe:** em **Equipe e cadastros**, crie usuários (nome de usuário + senha provisória + perfil), redefina senhas, desative ou exclua quem saiu. Se alguém perdeu o celular da verificação em duas etapas, use **Redefinir 2 etapas**.
2. **Checklist de inspeção:** inclua, desative ou exclua itens. A alteração vale **somente para o seu hotel**.
3. **Quartos:** edite tipo e andar, bloqueie/libere para venda, cadastre e substitua equipamentos, imprima as **etiquetas QR** (botão **▦ QR codes** em Quartos).
4. **Preventiva:** em **Preventiva**, cadastre planos (ex.: limpeza dos filtros do ar a cada 90 dias). Na data, o sistema gera a OS sozinho e avisa você para distribuir.
5. **Estoque:** em **Estoque**, mantenha itens, quantidades mínimas e entradas; o alerta mostra o que está abaixo do mínimo. Os técnicos dão baixa ao usar o material na OS.
6. **Acompanhar:** **Indicadores** (tempo de atendimento, OS abertas/atrasadas, custo do mês × orçamento), **Recorrência** e o **Registro de ações** do hotel (aba **Acessos**: entradas, saídas e tentativas de senha errada das contas do hotel).
7. **Exportar:** botão **⬇ Excel** em Demandas, Quartos e Indicadores.

### 5.4 Diretoria

1. **Visão da rede:** compara os 23 hotéis (OS abertas, atrasadas, custos, quartos bloqueados).
2. **Indicadores e Recorrência:** filtre por hotel ou veja a rede consolidada; exporte para Excel.
3. **Orçamentos:** autoriza os que passam da alçada do gerente (recebe notificação a cada pedido).
4. **Quartos:** pode bloquear/liberar para venda, definir estrelas e registrar problemas crônicos.
5. **Obrigações legais:** acompanha o que está vencido ou vencendo em cada hotel e é avisada quando uma obrigação vence.
6. **Registro de ações:** consulta tudo que foi feito em cadastros, usuários, estoque etc. em toda a rede. Na aba **Acessos**, vê entradas, saídas e tentativas de senha errada.
7. **Proteja sua conta:** ative a verificação em duas etapas em **Minha conta** (aplicativo autenticador + códigos de recuperação).

### 5.5 Administrador geral

1. **Cadastros:** hotéis (logo, limite de aprovação do gerente, orçamento mensal), usuários de qualquer hotel e perfis de rede (diretoria, administração).
2. **Importar quartos da planilha (HITS):** envie a planilha → confira a prévia → **Aplicar**.
3. **Checklist:** pode editar o checklist de qualquer hotel (escolha o hotel no seletor).
4. **Backups:** o sistema faz backup diário automático; em **Backups** é possível gerar um manualmente e baixar.
5. **Orçamentos:** também pode autorizar os que passam da alçada do gerente.
6. **Registro de ações:** auditoria completa da rede. Na aba **Acessos** aparecem quem entrou e saiu, as tentativas de senha errada (com IP e aparelho) e os bloqueios; ficam guardados por 180 dias.
7. **Proteja sua conta:** ative a verificação em duas etapas em **Minha conta**. Guarde os 8 códigos de recuperação. Quem perder o celular tem o segundo fator redefinido por você (**Cadastros → Redefinir 2 etapas**).
8. **Avisos do sistema:** se o backup diário falhar, você é avisado; aponte um monitor externo (ex.: UptimeRobot) para `/healthz`.

---

## 6. Dúvidas frequentes

- **Não aparece um menu que eu esperava.** O menu muda conforme o perfil. Veja a tabela da seção 3 e, se precisar de outro acesso, peça ao gerente.
- **Não recebo notificações.** Ative em **Notificações** e permita no celular. No iPhone, só funciona com o app instalado na Tela de Início.
- **Abri a OS errada.** Use **Cancelar solicitação** enquanto ela ainda não entrou em execução.
- **O QR code abriu um formulário em vez do login.** É o relato de problema sem login, que o gerente liga por hotel. Quem é da equipe usa o link **entrar no sistema** no rodapé e, depois do login, a ficha do quarto abre.
- **Perdi o celular do código de duas etapas.** Use um dos códigos de recuperação; sem eles, peça ao administrador ou ao gerente para redefinir. Em **Minha conta** você também encerra as sessões de aparelhos perdidos.
