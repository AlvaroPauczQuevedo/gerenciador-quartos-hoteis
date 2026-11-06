# Publicar na Hostinger (plano Business ou Cloud — Node.js Web App)

O sistema roda como **Node.js Web App** do hPanel. Não há dependências para instalar nem etapa de build.

> **Regra de ouro:** a Hostinger **recria a pasta do app a cada deploy**. Por isso o banco (`hotelaria.db`) e as fotos ficam numa pasta **fora do app**, indicada na variável `DATA_DIR`. Se `DATA_DIR` não for configurada, os dados serão apagados na próxima atualização.

## 1. Gerar os pacotes (no seu computador)

1. **Pare o servidor local** (Ctrl+C no terminal do `npm start`), para ninguém alterar o piloto durante a migração.
2. Na pasta do projeto, rode:
   ```bash
   npm run pacote          # deploy/manutencao-app.zip   → o aplicativo
   npm run exportar-dados  # deploy/manutencao-dados.zip → banco + fotos do piloto
   ```
   As credenciais (`data/credenciais-*.txt`) **não** vão no pacote: guarde-as em local seguro.

## 2. Criar a pasta de dados na hospedagem

1. No hPanel, abra **Arquivos → Gerenciador de arquivos**.
2. Na **pasta principal da conta** (a que contém `domains/` e `public_html/`; não entre nelas), crie a pasta **`manutencao-dados`**.
3. Entre em `manutencao-dados`, envie o `manutencao-dados.zip` e use **Extrair**. O arquivo `hotelaria.db` deve ficar diretamente dentro de `manutencao-dados/`. Depois, apague o zip.
4. Anote o **caminho completo** dessa pasta. Ele tem o formato `/home/u123456789/manutencao-dados` (o `u…` é o usuário da sua conta, que aparece no topo do Gerenciador de arquivos e em **Avançado → SSH**).

## 3. Criar o app Node.js

1. hPanel → **Sites → Adicionar site → Node.js Web App**.
2. Escolha **Enviar arquivo** e selecione `deploy/manutencao-app.zip`.
3. Nas configurações de deploy:

   | Campo | Valor |
   |---|---|
   | Framework preset | **Other** (Outro) |
   | Node.js version | **22** (ou 24) |
   | Entry file | `server.js` |
   | Build command | *(deixe vazio)* |
   | Output directory | *(deixe vazio)* |
   | Package manager | npm |

4. Em **Environment variables**, adicione:

   | Nome | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATA_DIR` | o caminho anotado no passo 2 (ex.: `/home/u123456789/manutencao-dados`) |

5. Escolha o **domínio ou subdomínio** do sistema e conclua o deploy.

## 4. Domínio e HTTPS

- Se o domínio está na Hostinger, ele já fica apontado. Caso contrário, aponte o DNS conforme o hPanel indicar.
- Ative o SSL em **Segurança → SSL** para o domínio do app. Com HTTPS ativo, o sistema passa a usar cookies seguros automaticamente.

## 5. Conferir se está tudo certo

1. Abra `https://SEU-DOMINIO/healthz`: deve aparecer `{"ok":true}`.
2. Nos **logs do app** (Runtime logs), procure a linha:
   `Dados (banco e fotos): /home/u…/manutencao-dados`
   - Se aparecer **ATENÇÃO: DATA_DIR … está dentro da pasta do aplicativo**, a variável `DATA_DIR` está errada. Corrija-a e reinicie o app.
   - Se aparecer `Node.js … não é suportado`, selecione Node 22 ou 24.
3. Entre com o usuário `admin` e confira se aparecem os 23 hotéis.

## Atualizar o sistema depois

1. No computador: `npm run pacote`.
2. No hPanel, no app → **Deployments / Reimplantar** → envie o novo `manutencao-app.zip`.

Os dados não são afetados, porque ficam em `manutencao-dados`. As variáveis de ambiente também continuam valendo entre deploys.

## Backup

- O conteúdo da pasta `manutencao-dados` é tudo o que precisa de backup: `hotelaria.db` e a pasta `uploads/`, com as fotos.
- Para uma cópia consistente com o sistema no ar, baixe juntos `hotelaria.db`, `hotelaria.db-wal` e `hotelaria.db-shm`, se existirem. Com acesso SSH, também é possível gerar um zip consistente:
  ```bash
  cd ~/domains/SEU-DOMINIO/…/pasta-do-app   # pasta do app, mostrada no hPanel
  DATA_DIR=~/manutencao-dados node src/empacotar.js dados
  ```

## Recuperar a senha do administrador

Se não conseguir entrar como `admin`, use o Terminal/SSH da hospedagem. Primeiro, entre na pasta do app Node.js (a que contém `package.json` e `src/`) e confirme que `DATA_DIR` aponta para a pasta existente com `hotelaria.db`. Faça um backup dessa pasta antes de continuar. Depois rode:

```bash
DATA_DIR=/home/u123456789/manutencao-dados npm run resetar-admin
```

O comando altera somente o hash da senha de `admin`, invalida as sessões desse usuário e grava uma nova senha em `credenciais-admin-*.txt` dentro de `DATA_DIR`. Se o banco ou o usuário administrador não existirem, ele encerra sem criar banco nem alterar dados. Consulte o arquivo pelo Gerenciador de arquivos, entre com o login `admin` e apague o arquivo de credenciais depois.

## Limites do plano que valem para este sistema

- **Tempo por requisição:** cada requisição pode levar no máximo 120 segundos. Uma foto de até 15 MB fica bem abaixo disso.
- **Processos em segundo plano:** não são garantidos no plano. Por isso o verificador de prazos e de inspeções vencidas roda também a cada acesso ao sistema, além do relógio interno.
- **Se o app não conseguir gravar em `DATA_DIR`:** acontece se a hospedagem restringir pastas fora do app, e o log mostra erro ao abrir o banco. Nesse caso, fale com o suporte da Hostinger ou use um **VPS**, onde não há essa limitação.
