# Litera

Litera Beta é uma biblioteca digital self-hosted para EPUB e PDF, com múltiplos acervos, jobs de scan, catálogo, metadata resiliente, reader integrado, progresso concorrente por usuário, painel administrativo e um cliente conservador em `/legacy`.

**Versão atual:** `0.3.0` · **Licença:** [GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`) · **Imagem:** `ghcr.io/rafaelhschuh/litera:0.3.0`

## Ambiente local com Docker Compose

Pré-requisitos: Docker com Compose v2+ e uma pasta local contendo seus arquivos `.epub` e `.pdf`.

```bash
cp .env.example .env
mkdir -p books
```

Edite `.env` e defina obrigatoriamente uma senha inédita com pelo menos 12 caracteres:

```dotenv
LITERA_ADMIN_USERNAME=admin
LITERA_ADMIN_PASSWORD=uma-senha-longa-e-unica
LITERA_BOOKS_PATH=./books
LITERA_PORT=3000
```

Copie livros para a pasta indicada por `LITERA_BOOKS_PATH` e suba a aplicação:

```bash
docker compose up --build -d
docker compose ps
curl --fail http://localhost:3000/health
```

Abra `http://localhost:3000`, entre com `LITERA_ADMIN_USERNAME` e `LITERA_ADMIN_PASSWORD`, acesse **Administração → Bibliotecas**, cadastre uma biblioteca com o caminho **`/books`** e clique em **Escanear agora**. O mount é somente leitura; o scanner nunca altera os livros fonte. Catálogo, capas extraídas e progresso ficam no volume persistente `litera_data`.

O administrador é criado somente quando o banco está vazio. Alterar as variáveis depois do primeiro bootstrap não troca a senha existente. Não há senha padrão armazenada no repositório.

Para acompanhar ou parar:

```bash
docker compose logs -f litera
docker compose down
```

`docker compose down` preserva o volume. Remover o volume apaga catálogo, usuários, sessões, configuração e progresso; faça isso apenas quando desejar uma instalação totalmente nova.

## Produção com Docker Compose

O arquivo [`docker-compose.production.yml`](docker-compose.production.yml) usa a imagem versionada `ghcr.io/rafaelhschuh/litera:0.3.0`, sem build local, `.env` ou substituição de variáveis. Antes do primeiro deploy:

1. crie a pasta `books` ao lado do Compose e copie para ela os arquivos `.epub` e `.pdf`;
2. troque `CHANGE_ME_BEFORE_DEPLOY` por uma senha inédita de pelo menos 12 caracteres;
3. ajuste `LITERA_PUBLIC_ORIGIN` para a URL pública; quando usar HTTPS, defina `LITERA_SECURE_COOKIES` como `true`.

Valide e suba a instalação:

```bash
mkdir -p books
docker compose -f docker-compose.production.yml config
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
curl --fail http://localhost:3000/health
```

A aplicação é publicada na porta `3000`. O volume nomeado `litera_data` preserva banco SQLite, WAL, capas, configurações, usuários e progresso em `/data`. A pasta `./books` é montada em `/books` como somente leitura, portanto trocar ou recriar o container não remove os livros nem permite que o scanner os altere.

As variáveis do processo ficam declaradas diretamente em `environment`: `NODE_ENV`, `PORT`, `LITERA_DATA_DIR`, `LITERA_BOOK_ROOTS`, credenciais do administrador inicial, origem/cookies, configuração opcional da Open Library, limite de tamanho e identificação do build. O administrador só é criado quando o banco está vazio; alterar a senha no Compose depois disso não troca a credencial já persistida.

Para atualizar, faça backup do volume, altere somente a tag versionada em `image:` para a versão desejada e execute:

```bash
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

O GHCR também recebe `main` e `sha-<commit>` a cada push na branch principal. Releases estáveis publicam as tags semânticas completa, minor, major e `latest`; o Compose de produção permanece fixado em `0.3.0` para evitar upgrades implícitos.

## Cliente legacy

Entre como admin e acesse **Administração → Compatibilidade**. Ao ativar o switch, `/legacy` oferece login, home, biblioteca, busca, detalhe, leitura EPUB incremental, PDF por página com zoom e sincronização de progresso pela mesma API. Quando desativado, `/legacy/*` retorna uma página controlada de indisponibilidade. O PDF usa o visualizador nativo do dispositivo para manter o cliente conservador.

## Aplicativo e leitura offline

O cliente moderno pode ser instalado como PWA pela tela **Preferências**. Depois de abrir a página de um livro, use **Salvar para ler offline** para preparar o reader e guardar o conteúdo somente dentro do Litera naquele dispositivo; nenhum `.epub` ou `.pdf` é enviado à pasta de downloads. O cache é separado por conta, pode ser removido na mesma ação e é apagado no logout. Assets e telas já visitados também permanecem disponíveis quando o navegador oferece Service Worker e Cache Storage.

Leitura offline é um aprimoramento do cliente moderno. O `/legacy` continua online para preservar compatibilidade. Mudanças de progresso feitas sem rede entram em uma fila local por conta/livro e são reenviadas quando a conexão volta. Consulte [`ADR-0006`](docs/decisions/ADR-0006-device-scoped-offline-reading.md) para limites de segurança, revogação e armazenamento.

## Metadata opcional

Metadados embarcados são sempre a fonte inicial. O provider Open Library é opcional e vem desativado. Ele pode ser configurado sem restart em **Administração → Metadata**. Para fornecer o default de uma instalação/upgrade por ambiente, configure:

```dotenv
LITERA_OPENLIBRARY_ENABLED=true
LITERA_OPENLIBRARY_CONTACT=voce@example.com
```

O contato identifica a aplicação conforme as [diretrizes oficiais da API](https://openlibrary.org/developers/api). As consultas são de baixo volume, enviam apenas título/autor/identificador, usam cache de 7 dias, timeout e retries limitados, e nunca impedem leitura ou ingestão local. A [política de licenciamento](https://openlibrary.org/developers/licensing) é documentada pela própria Open Library. Para importação em massa, use os dumps oficiais em vez da API.

## Upgrade do MVP para Beta

1. Pare o container e faça backup do volume antes de trocar a imagem:

```bash
docker compose down
docker run --rm -v litera_litera_data:/data -v "$PWD:/backup" alpine tar czf /backup/litera-backup-before-beta.tar.gz -C /data .
```

Se o projeto/volume tiver outro nome, confirme com `docker volume ls` e substitua `litera_litera_data`. O backup contém banco, WAL e capas; os livros permanecem no mount read-only e devem seguir a política de backup do host.

2. Atualize os arquivos/imagem e suba normalmente:

```bash
docker compose up --build -d
docker compose ps
curl --fail http://localhost:3000/health
```

A migration 3 é aditiva e executada automaticamente antes do servidor aceitar requests. Catálogo, libraries, usuários, sessões e progresso do MVP são preservados. Scans que estavam `running` voltam à fila após restart.

Para restaurar em caso de rollback, pare o Compose, restaure o tar para um volume vazio compatível com a versão anterior e só então suba a imagem antiga. Não abra um banco já migrado com uma imagem MVP.

## Operação diária

- Scans iniciados pela UI entram em uma fila persistente. Acompanhe contagens e erros em **Administração → Jobs**.
- Renames/moves são reconciliados por inode e fingerprint amostrado; arquivos fonte nunca são modificados.
- Crie e gerencie contas e libraries liberadas em **Administração → Usuários**. Desativar uma conta revoga sessões imediatamente e preserva progresso.
- Preferências e troca de senha ficam em **Preferências**. Uma troca de senha revoga as outras sessões.
- Progresso usa locator por formato e revision. Em conflito, a posição mais nova no servidor é preservada e o reader informa a ocorrência.

## Desenvolvimento e verificação

Requer Node.js 22+ e npm 10+.

```bash
npm ci
npm run dev
```

O backend usa `http://localhost:3000`. Em outro terminal, suba o Vite em `http://localhost:5173`:

```bash
npm run dev:web
```

Para desenvolvimento local, exporte antes `LITERA_ADMIN_USERNAME`, `LITERA_ADMIN_PASSWORD`, `LITERA_DATA_DIR` e `LITERA_BOOK_ROOTS`. Os comandos de gate são:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke
docker build -t litera:local .
```

Os testes geram EPUB/PDF válidos em diretórios temporários e cobrem login, autorização multi-user/library, scan idempotente, rename/removal, jobs, provider offline, migration MVP→Beta, catálogo/busca, locators EPUB/PDF, conflito de revision, restauração, Continue Reading e `/legacy`.

## Configuração

| Variável | Uso |
|---|---|
| `NODE_ENV` | modo do runtime; em produção: `production` |
| `PORT` | porta HTTP interna; default `3000` |
| `LITERA_ADMIN_USERNAME` | usuário do primeiro administrador |
| `LITERA_ADMIN_PASSWORD` | senha do primeiro administrador, mínimo 12 caracteres |
| `LITERA_DATA_DIR` | SQLite, WAL e capas; no container: `/data` |
| `LITERA_BOOK_ROOTS` | roots canônicas permitidas, separadas por vírgula; no container: `/books` |
| `LITERA_BOOKS_PATH` | caminho do host montado em `/books` pelo Compose |
| `LITERA_SECURE_COOKIES` | `true` quando servido por HTTPS |
| `LITERA_PUBLIC_ORIGIN` | origin público usado na validação de requests mutáveis |
| `LITERA_OPENLIBRARY_ENABLED` | habilita enriquecimento opcional |
| `LITERA_OPENLIBRARY_CONTACT` | contato exigido para identificar chamadas ao provider |
| `LITERA_MAX_BOOK_MB` | limite por arquivo processado pelo scanner; default 512 MB |
| `LITERA_BUILD` | identificador exibido no painel de sistema |

## Limitações conhecidas da Beta

Passos de reprodução, impacto e mitigação estão consolidados em [`docs/development/known-issues.md`](docs/development/known-issues.md).

- PDF no `/legacy` usa o visualizador nativo do dispositivo; a fidelidade varia conforme o WebKit e deve ser confirmada no aparelho físico de referência.
- O device físico iOS 10.x ainda precisa ter modelo/versão exatos registrados; consulte `docs/development/compatibility-matrix.md`. O core legacy evita `fetch`, Promises, modules, CSS Grid/Flex e APIs modernas.
- O worker de scan roda no processo Node, com jobs persistentes e shutdown seguro; não há pool multiprocesso nesta Beta doméstica.
- Busca PDF lê texto página a página sob demanda e pode demorar em documentos muito grandes; ela não bloqueia a abertura/navegação.
- Exclusão definitiva de usuário ainda não está exposta na UI; desativação/revogação é o fluxo seguro suportado. Consulte `docs/security/privacy-and-operations.md`.
- Open Library é destinada a consultas humanas de baixo volume; acervos em massa devem usar os dumps oficiais.

## Documentação autoritativa

- Requisitos: `docs/product/requirements.md`
- Contrato frontend: `docs/frontend/ui-ux-technical-spec.md`
- Arquitetura: `docs/architecture/overview.md`
- Decisões: `docs/decisions/`
- Gate de implementação: `CODEX_PROMPTS.md`

## Licença

Litera é software livre licenciado exclusivamente sob a [GNU General Public License v3.0](LICENSE), identificada por SPDX como `GPL-3.0-only`.
