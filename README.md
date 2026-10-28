# Litera

Litera Beta é uma biblioteca digital self-hosted para EPUB e PDF, com múltiplos acervos, jobs de scan, catálogo, metadata resiliente, reader integrado, progresso concorrente por usuário, painel administrativo e um cliente conservador em `/legacy`.

**Versão atual:** `0.8.0` · **Licença:** [GNU General Public License v3.0](LICENSE) (`GPL-3.0-only`) · **Imagem:** `ghcr.io/rafaelhschuh/litera:0.8.0`

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

Abra `http://localhost:3000`, entre com `LITERA_ADMIN_USERNAME` e `LITERA_ADMIN_PASSWORD`, acesse **Administração → Bibliotecas**, cadastre uma biblioteca com o caminho **`/books`** e clique em **Escanear agora**. O scanner nunca altera os livros fonte. O mount permite criar novos EPUBs/PDFs pelo upload administrativo; arquivos existentes nunca são substituídos. Catálogo, capas extraídas e progresso ficam no volume persistente `litera_data`.

O administrador é criado somente quando o banco está vazio. Alterar as variáveis depois do primeiro bootstrap não troca a senha existente. Não há senha padrão armazenada no repositório.

Para acompanhar ou parar:

```bash
docker compose logs -f litera
docker compose down
```

`docker compose down` preserva o volume. Remover o volume apaga catálogo, usuários, sessões, configuração e progresso; faça isso apenas quando desejar uma instalação totalmente nova.

## Produção com Docker Compose

O arquivo [`docker-compose.production.yml`](docker-compose.production.yml) usa a imagem versionada `ghcr.io/rafaelhschuh/litera:0.8.0`, sem build local, `.env` ou substituição de variáveis. Antes do primeiro deploy:

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

A aplicação é publicada na porta `3000`. O volume nomeado `litera_data` preserva banco SQLite, WAL, capas, configurações, usuários e progresso em `/data`. A pasta `./books` é montada em `/books` com escrita para uploads administrativos. Trocar ou recriar o container preserva os livros; o scanner continua sem modificá-los.

As variáveis do processo ficam declaradas diretamente em `environment`: `NODE_ENV`, `PORT`, `LITERA_DATA_DIR`, `LITERA_BOOK_ROOTS`, credenciais do administrador inicial, origem/cookies, configuração opcional da Open Library, limite de tamanho e identificação do build. O administrador só é criado quando o banco está vazio; alterar a senha no Compose depois disso não troca a credencial já persistida.

Para atualizar, faça backup do volume, altere somente a tag versionada em `image:` para a versão desejada e execute:

```bash
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml up -d
```

O GHCR também recebe `main` e `sha-<commit>` a cada push na branch principal. Releases estáveis publicam as tags semânticas completa, minor, major e `latest`; o Compose de produção permanece fixado em `0.8.0` para evitar upgrades implícitos.

As capas extraídas, enviadas manualmente ou geradas a partir da primeira página de um PDF são armazenadas como JPEG progressivo de até 640 × 960 pixels. O catálogo carrega somente esse derivado e nunca abre o PDF para montar a capa no navegador. Um rescan preenche automaticamente capas ausentes de PDFs já catalogados, mesmo quando o arquivo fonte não mudou. Capas persistidas por versões anteriores são convertidas no primeiro acesso, sem alterar o EPUB/PDF fonte.

## Leitura e navegação — 0.8.0

- Sumário EPUB usa os títulos e destinos do nav/NCX original; metadados `head/title` não entram no texto do capítulo.
- Em rolagem por capítulo, setas e swipe lateral trocam de capítulo e abrem seu início. Em páginas pela tela, avançam uma tela e mantêm o texto ao recalcular o layout.
- Fontes locais, tamanho até 200%, alinhamento, margens laterais/superior/inferior e espaçamentos ficam nas preferências da conta e funcionam com o fluxo offline existente.
- Transições de módulos seguem a ordem da barra móvel; cards expandem ao abrir e retornam à lista de origem ao voltar. Cabeçalho/barra permanecem acima das apresentações. Painéis também animam ao fechar.
- EPUB prepara o próximo frame antes de capturar o swipe, sem recriar o texto em outro contexto CSS nem esperar pintura dentro de uma captura suspensa. Navegadores sem a API de transição mantêm a leitura com troca direta; PDF conserva seu fallback.

Pacotes offline salvos antes da correção do conteúdo/sumário precisam ser atualizados para receber essa extração. Os arquivos EPUB fonte não são modificados. Detalhes em [ADR-0015](docs/decisions/ADR-0015-epub-navigation-typography-and-route-motion.md).

## Estabilidade do leitor — 0.7.1

Os dois modos EPUB preservam o caractere visível ao recalcular o layout e ao aplicar destaques. Páginas com figuras usam o elemento visível quando não há texto; callbacks antigos de resize não restauram uma posição anterior. A animação conserva o contexto de dimensões e fontes do iframe. O [registro da investigação](docs/development/reader-0.7.1-investigation.md) detalha as correções e a validação disponível; a reprodução do loop originalmente relatado continua pendente.

## Navegação e leitura — 0.7.0

Em celulares (largura menor que 640 px), a navegação fica em uma barra inferior sólida e arredondada: **Favoritos · Biblioteca · Início · Busca · Outros**. A pílula de seleção desliza entre as opções. **Outros** reúne Autores, Séries, Gêneros, Configurações, Administração para administradores e Sair. A barra respeita a área segura do dispositivo e não aparece no leitor. Tablets mantêm o menu recolhível e desktop mantém a lateral.

O leitor troca páginas com deslizamento lateral, nos dois sentidos, por gesto, botões ou teclado. A preferência de movimento reduzido remove a animação. Capítulos EPUB vizinhos e seus recursos são preparados antecipadamente; páginas do capítulo atual já estão em memória. PDF original prepara canvas e texto das páginas próximas, e o Adaptado prepara texto, figuras e fontes. A preparação é limitada a dois vizinhos por modo, descartada ao sair ou alterar o contexto; falhas usam o carregamento normal. Não cria downloads offline: continua usando a edição salva quando o livro está disponível no dispositivo.

## Correções do catálogo e leitor — 0.6.1

A atualização agenda um scan de reparação por biblioteca existente. Acompanhe em **Admin → Jobs**: capas automáticas são extraídas novamente do arquivo correto; capas e metadados manuais são preservados. O primeiro scan calcula SHA-256 integral e pode levar mais tempo em acervos grandes, sem modificar os livros fonte.

No leitor EPUB, abra **Configurações de leitura → Modo de leitura** para escolher **Rolagem por capítulo** ou **Páginas pela tela**. A preferência sincroniza entre dispositivos e funciona offline; as páginas são locais ao capítulo e mudam conforme tela, fonte e margens. Capítulo/posição de texto continuam sendo a referência salva. Destaques novos guardam a ocorrência exata selecionada, inclusive palavras repetidas e trechos com formatação.

## Upload e navegação — 0.6.0

Em **Administração → Bibliotecas → abrir uma biblioteca → Enviar livros**, selecione um ou mais EPUBs/PDFs e envie. Cada arquivo mostra progresso real de transferência, validação e catalogação. Os novos livros aparecem no catálogo depois do scan automático; falhas de catalogação ficam em **Jobs**. Arquivos vazios, corrompidos, protegidos por senha, formatos não suportados e nomes com pastas são rejeitados. O limite por arquivo é `LITERA_MAX_BOOK_MB` (default 512 MB). Um nome já existente retorna conflito sem substituir o original.

A pasta da biblioteca precisa permitir escrita pelo usuário `node` do container (UID 1000), com suporte a hard links para publicação atômica. Os Compose desta versão montam `/books` com escrita; instalações que preservarem `:ro` continuam lendo normalmente e recebem uma mensagem ao tentar enviar. Ajuste as permissões da pasta no host conforme sua política. O upload cria somente arquivos novos; scans nunca modificam fontes. Faça backup da pasta `books` junto com o volume de dados. Envio exige conexão e administrador, e não está disponível em `/legacy`.

A abertura e o login exibem um indicador animado; após autenticar, o app prepara a Home, capas e detalhes dos primeiros livros com prazo limitado. Outros livros são preparados ao se aproximarem da área visível durante a rolagem ou ao apontar/focar um card. A preparação não baixa EPUBs/PDFs completos nem cria downloads offline.

O catálogo moderno preserva até 12 telas recentes por conta, filtros, busca e posição de rolagem enquanto o aplicativo permanece aberto, inclusive ao retornar do leitor. A atualização acontece mantendo o último conteúdo visível, com erro e retry no contexto. Transições de telas, capas, menus e painéis usam os tokens de movimento e respeitam **Reduzir movimento** e a preferência do sistema. O leitor conserva seus locators e ciclo de descarte; sair da conta descarta as telas privadas retidas. `/legacy` mantém sua navegação conservadora.

## Cliente legacy

Entre como admin e acesse **Administração → Compatibilidade**. Ao ativar o switch, `/legacy` oferece login, home, biblioteca, busca, detalhe, leitura EPUB incremental, PDF por página com zoom e sincronização de progresso pela mesma API. Quando desativado, `/legacy/*` retorna uma página controlada de indisponibilidade. O PDF usa o visualizador nativo do dispositivo para manter o cliente conservador.

## Aplicativo e leitura offline

O cliente moderno funciona como PWA em uma origem segura (**HTTPS**, ou localhost em desenvolvimento). No Chrome, use **Preferências → Aplicativo** ou o menu de instalação. No Safari do iPhone/iPad, use **Compartilhar → Adicionar à Tela de Início**; no Mac, **Adicionar ao Dock**, quando disponível. Instalar o aplicativo não baixa automaticamente sua biblioteca.

Abra a página de um livro, escolha **Salvar para offline** e espere **Disponível offline** antes de desligar a conexão. O download inclui capa, metadados e conteúdo completo de leitura. EPUBs preservam capítulos, imagens, estilos editoriais sanitizados e fontes internas; tema e tamanho podem mudar sem rede. PDFs incluem o original e todas as páginas, imagens e fontes do modo Adaptado. O conteúdo fica dentro do Litera, não na pasta de downloads.

A interface mostra preparação, capítulos/páginas concluídos, bytes recebidos e conferência final. Transferências usam concorrência limitada e até três tentativas por recurso em falhas temporárias; recursos compartilhados do EPUB são salvos uma única vez. A primeira preparação das páginas adaptadas de PDFs antigos ainda pode levar tempo. Cancelar interrompe o download; fechar a aba exige iniciar novamente. Detalhes em [ADR-0016](docs/decisions/ADR-0016-offline-download-pipeline.md).

O shell de produção é preparado independentemente das páginas visitadas. Sem rede, Home, Biblioteca, busca, detalhe e reader usam os livros completos deste dispositivo; rotas profundas suportam reload. Progresso usa locators por formato. Destaques, favoritos e alterações de leitura são persistidos localmente e entram em uma fila por conta, reenviada quando o app recupera acesso ao servidor, inclusive a partir da biblioteca. Conflitos de progresso preservam o servidor e pedem uma escolha explícita, sem usar “maior percentual vence”.

**Preferências → Offline** mostra livros, bytes conhecidos e estimativa do navegador quando disponível. **Remover download** libera o conteúdo sem apagar progresso, destaques ou favoritos. Quando o arquivo muda no acervo, a página oferece **Atualizar download**; a cópia anterior só é substituída após concluir a nova. Cancelar/falhar nunca confirma um pacote parcial.

Logout oculta imediatamente a conta, repete a limpeza local até concluí-la e impede restauração automática mesmo quando feito sem rede; operações ainda não enviadas são descartadas no logout. Sincronize antes de sair se quiser preservá-las no servidor. O navegador pode remover dados por falta de espaço ou limpeza manual; solicitar persistência não garante retenção. Contas não compartilham downloads e a identidade local não contém senha/token, mas armazenamento do browser não é DRM. Revogações remotas só alcançam um dispositivo quando ele volta a se conectar.

Uma sessão expirada exige novo login, sem apagar automaticamente a fila pendente. Autentique a mesma conta para retomar a sincronização; outra conta não recebe acesso a esses dados.

O aplicativo verifica atualizações ao abrir, voltar à janela, reconectar e a cada minuto enquanto visível. Uma versão pronta abre um pop-up com **Atualizar agora** e **Depois**; a oferta aguarda a saída do leitor e a aplicação aguarda downloads em andamento. **Preferências → Atualização do aplicativo** permite verificar/reabrir a oferta. Não há reload automático da leitura.

Conexão e pendências aparecem num indicador expansível, acima da barra móvel. A sincronização funciona sem configuração: envia alterações ao gravar, abrir, voltar e reconectar, com conferência periódica de 30 segundos enquanto visível. Falhas temporárias retomam automaticamente; conflito de posição e sessão expirada exigem ação. A fila sobrevive ao fechamento e retoma ao reabrir; o navegador encerrado não executa sincronização. Detalhes em [ADR-0017](docs/decisions/ADR-0017-app-update-and-sync-feedback.md).

O `/legacy` continua online. Administração exige conexão. Pacotes antigos da 0.4 devem ser salvos novamente para receber o conjunto completo da 0.5. Consulte [`ADR-0009`](docs/decisions/ADR-0009-offline-packages-and-outbox.md) e o [checklist de validação offline](docs/development/offline-validation.md). Testes Playwright Chromium/WebKit não substituem validação física em Safari/PWA.

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

Se o projeto/volume tiver outro nome, confirme com `docker volume ls` e substitua `litera_litera_data`. O backup contém banco, WAL e capas; os livros ficam na pasta montada e devem seguir a política de backup do host, incluindo os arquivos enviados pelo admin.

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
- Renames/moves são reconciliados por fingerprint SHA-256 integral e ausência do caminho anterior; arquivos fonte nunca são modificados.
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

## Android (preview)

O [subprojeto Android](android/README.md) hospeda o aplicativo web completo em WebView, com configuração inicial Kotlin, barras/teclado/insets, Voltar, pausa e ícone adaptativo. Reutiliza os leitores e offline existentes; não mantém uma segunda interface/leitor. Requer Android 9+ e provedor WebView com suporte a múltiplos perfis, verificado em runtime. HTTPS é recomendado; HTTP remoto pode impedir offline completo.

Sessão e downloads do APK são independentes do Chrome/PWA. A versão deriva desta raiz (`0.5.5`). O [workflow adicional](.github/workflows/android.yml) gera APK debug e relatórios sem alterar a publicação Docker/web. Consulte [arquitetura](android/docs/architecture.md), [segurança](android/docs/security.md), [testes](android/docs/testing.md) e [build/assinatura](android/docs/build-and-release.md).

O preview nativo anterior foi rejeitado sem merge. O novo PR WebView fica em draft e aguarda teste do APK e autorização expressa do usuário antes de merge; CI aprovado não substitui essa aprovação.
