# gerenciador-quartos-hoteis

Plataforma integrada de gestão hoteleira, conservação predial e manutenção operacional para redes com várias unidades.

## Publicação (Hostinger)

O passo a passo está em [DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md). Os comandos usados são:

- `npm run pacote`: gera o zip do app, sem dados.
- `npm run exportar-dados`: gera um zip consistente do banco com as fotos.

Em produção, defina `NODE_ENV=production` e `DATA_DIR` apontando para uma pasta **fora** do app.

## Rede Tri Hotéis

Os 23 hotéis da rede estão em `src/rede.js` (nome, cidade/UF, quantidade de quartos e logo). Para adicionar ao banco os que ainda não existem:

```bash
npm run importar-rede   # idempotente; faz backup do banco antes (data/hotelaria-antes-da-rede-*.db)
```

- Cada unidade nova recebe **um único usuário de gerência** (`gerencia.<unidade>`, por exemplo `gerencia.premium-itapema`). As senhas aleatórias ficam em `data/credenciais-rede.txt`. O gerente cria o restante da equipe em **Equipe e cadastros**.
- Todas usam o mesmo checklist e os mesmos equipamentos do Executive Osório.
- **Numeração provisória:** como só a quantidade foi informada, os quartos são criados como 1, 2, 3… e marcados como provisórios. A gerência informa as faixas reais por andar em **Cadastros → Numeração real dos quartos**, o que substitui os provisórios. Também é possível editar ou excluir um quarto na página dele.
- Executive Santa Maria e Smart Santa Maria não tinham quantidade na planilha e começam sem quartos. Antônio Prado (125) está marcado para conferência.
- Logos: `public/img/hoteis/<unidade>/`. O menu mostra a logo do hotel do usuário; a tela de login e os acessos da rede mostram a logo Tri Hotéis.

## Versão piloto — Tri Hotel Executive Osório

```bash
npm run seed       # cria (ou recria, apagando data/) o banco do piloto
npm start          # http://localhost:3000
```

- Há um único hotel, **tri Hotel Executive Osório** (Osório/RS), sem dados fictícios.
- São criados 6 acessos, um por perfil, cada um com **senha aleatória**. As senhas ficam no arquivo `data/credenciais-piloto.txt`, que fica fora do git. Distribua os acessos, peça a cada pessoa para usar **"Alterar senha"** no primeiro login e depois apague o arquivo.

  | Perfil | Usuário |
  |---|---|
  | Administrador geral da rede (vê todos os hotéis, inclusive os futuros) | `admin` |
  | Gerente (equipe, quartos e checklist do hotel) | `gerencia` |
  | Governança (inspeções) | `governanca` |
  | Responsável pela manutenção | `manutencao` |
  | Técnico de manutenção | `tecnico` |
  | Aprovador financeiro | `financeiro` |

- **Apartamentos já cadastrados:** 401–421, 501–521, 601–621, 701–721 e 801–821 (105 no total). Cada um tem 10 equipamentos: ar-condicionado, TV, controle, secador, chuveiro, frigobar, telefone, campainha, fechadura eletrônica e economizador de energia. A primeira inspeção vence em 7 dias.
- **Checklist da gerência** (31 itens), em dois grupos:
  - **Básico para funcionamento e venda** (17 itens, como TV, chuveiro, vazamento, pilha da porta, contactora, frigobar e cama). Uma falha gera OS de prioridade **alta** e **bloqueia o quarto para venda**.
  - **Crônicos — dependem de ocupação/budget** (14 itens, como pinturas, espelhos, gesso, mobiliário, portas, limpeza do ar e piso). Uma pendência vira **problema crônico**, sem bloquear o quarto; se for preciso, dá para abrir uma OS de baixa prioridade.

  Ao concluir uma inspeção com a opção automática marcada, o sistema faz isso sozinho. O administrador ajusta o checklist em **Cadastros → Checklist de inspeção** (adiciona itens, ativa/desativa) e cadastra outros quartos em **Cadastrar quartos em lote**.
- **Fotos padrão do quarto:** na página de cada quarto, gerência e governança cadastram fotos de referência de como o apartamento deve estar montado. A mesma foto pode ser aplicada ao quarto, ao andar inteiro ou a todos os quartos (o arquivo é enviado uma vez só). As fotos aparecem na inspeção, para comparar, e nas OS do quarto.
- **Login por nome de usuário** (não por e-mail): letras minúsculas, números, ponto, hífen ou sublinhado, de 3 a 30 caracteres (ex.: `joao.silva`). O sistema não usa e-mail. Bancos de versões anteriores são convertidos automaticamente na inicialização (o usuário passa a ser a parte do antigo e-mail antes do @), mantendo as senhas e o histórico.
- **Usuários:** o gerente, em **Equipe e cadastros**, cria, desativa e redefine a senha da equipe do hotel (gerentes, governança, manutenção, técnicos e financeiro). Ele não pode criar nem alterar acessos da rede (administrador geral e diretoria), que só o administrador gerencia. Excluir um usuário remove o acesso; se ele já participou de demandas ou inspeções, o nome continua no histórico (rastreabilidade). Quem é responsável por demandas em aberto só pode ser excluído depois que elas forem redesignadas.
- Com apenas um hotel, a interface esconde os seletores de unidade e a "Visão da rede".
- O login bloqueia o IP por 15 minutos após 10 tentativas erradas.
- Se o banco estiver vazio, o `npm start` também cria o piloto e as credenciais automaticamente.

Requisitos: **Node.js 22.13+**. Não há dependências externas: o projeto usa `node:http` e o SQLite embutido no Node (`node:sqlite`). Variáveis opcionais: `PORT` (padrão 3000) e `DATA_DIR` (padrão `./data`, onde ficam o banco, as fotos e as credenciais).

**Backup:** copie a pasta `data/` com o servidor parado.

### Demonstração com dados fictícios (3 hotéis)

`npm run seed:demo` recria o banco com o histórico de demonstração (usuários como `gerente.atlantico`, `manutencao.atlantico` e `admin`, senha `demo123`). O login passa a exibir atalhos por perfil. Não use esse modo no piloto.

```bash
npm test           # testes do fluxo de negócio
```

## Módulos

| Seção | Onde |
|---|---|
| 15 — Solicitações e ordens de serviço | `src/domain/os.js`, telas *Nova solicitação*, *Painel da manutenção* e detalhe da OS |
| 16 — Inspeções periódicas | `src/domain/inspecoes.js`, telas *Inspeções* (agenda e checklist responsivo) |
| 17 — Índice de recorrência | `src/domain/recorrencia.js`, tela *Recorrência* |
| 18 — Registro fotográfico antes e depois | `src/domain/fotos.js`, galeria no quarto e na OS |
| 19 — Multi-hotel e diretoria | `src/domain/indicadores.js` (`rede`), escopo em `src/domain/comum.js`, tela *Visão da rede* |
| 15.7 — Notificações | `src/domain/notificacoes.js`, `src/domain/agendador.js` (prazos, atrasos e inspeções vencidas a cada 5 min) |
| 15.8 — Indicadores | `src/domain/indicadores.js`, tela *Indicadores* |

### Fluxo da OS

`nova → em_avaliacao → (aprovada | devolvida_complementacao | aguardando_orcamento → aguardando_autorizacao | recusada) → em_execucao ⇄ aguardando_materiais → concluida → (encerrada | em_correcao)`; uma demanda encerrada pode ser reaberta.

- O protocolo é único e segue o formato `OS-AAAA-NNNNN`. O prazo padrão depende da prioridade (emergencial 4 h, alta 24 h, média 72 h, baixa 7 dias), e a manutenção pode redefini-lo.
- A conclusão exige ao menos uma foto da fase "após a conclusão".
- **Emergenciais** podem ir direto para execução, sem passar por avaliação nem aprovação financeira. Nesse caso, o orçamento fica marcado como "regularização posterior", e a validação continua obrigatória.
- Cada hotel pode dispensar a validação do gerente (em *Cadastros*). Sem ela, a OS é encerrada assim que é concluída.
- A rastreabilidade registra quem abriu, recebeu, executou e validou a OS. Toda ação gera um evento na linha do tempo da demanda.

### Integrações (seção 20)

1. Na inspeção, um item reprovado vira OS com um clique, reaproveitando quarto, categoria, equipamento, observação e fotos. Se já houver uma OS aberta para o mesmo problema, o item é vinculado a ela em vez de gerar uma nova.
2. Uma OS aberta já aparece vinculada ao quarto e ao equipamento no painel.
3. Quando a manutenção conclui o serviço, o gerente recebe uma notificação para validá-lo.
4. A validação atualiza automaticamente o histórico do quarto e a data da última manutenção.
5. Uma recorrência gera alerta para gerente e manutenção (e também para a diretoria a partir da 3ª ocorrência). O aviso já aparece no formulário de abertura.
6. Quartos podem ser bloqueados ou liberados para comercialização. Só gerente, diretoria ou admin podem liberar.
7. Um desgaste sem urgência pode ser registrado como problema crônico a partir da inspeção, da análise de recorrência ou do próprio quarto.
8. A diretoria vê os indicadores consolidados de todas as unidades.

### Premissas adotadas

As seções 1 a 14 não foram fornecidas. Por isso, as entidades-base (hotéis, quartos, equipamentos, usuários e perfis) foram modeladas aqui. As **estrelas** de cada quarto representam a classificação de conservação de 1 a 5: são recalculadas a cada inspeção concluída (percentual de conformidade) e podem ser ajustadas pelo gerente ou pela diretoria.
