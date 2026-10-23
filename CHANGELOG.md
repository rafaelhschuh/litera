# Changelog

## Unreleased

- Novo subprojeto Android Kotlin com host WebView do Litera completo, reaproveitando interface, leitores e offline existentes.
- Integração de barras/tema, insets/teclado, navegação Voltar, pausa e ícone adaptativo, com perfis WebView separados por origem e bridge restrita de apresentação.
- Workflow adicional para APK debug e validação Android, sem alterar a versão 0.5.5 ou publicação web/container.
- Contratos Android, ADR e documentação conectados à raiz. O preview nativo rejeitado não foi integrado; o novo PR WebView aguarda teste e autorização do usuário, sem merge.

## 0.6.1 — 2026-10-23

- Scans usam SHA-256 integral para reconciliar movimentos, sem assumir que um inode reutilizado pertence ao livro anterior; hard links e substituições atômicas não colidem no catálogo.
- Capas automáticas usam nomes derivados da própria imagem e revisão na URL, são atualizadas quando o arquivo muda e reparadas em um scan agendado no upgrade. Capas e metadados manuais são preservados.
- Arquivos com erro são reavaliados nos rescans, sem voltar indevidamente a disponíveis. Jobs mostram conclusão com erros e o diagnóstico por arquivo; falhas de leitura isoladas não interrompem todo o scan.
- EPUB oferece rolagem por capítulo ou páginas ajustadas à tela, indicador de capítulo/página, preferência sincronizada e offline, e restauração por posição textual ao redimensionar ou trocar de modo.
- Navegação de capítulos posiciona o novo conteúdo no início, sem deslocar o contêiner do leitor; a rolagem fica em uma coluna e o leitor ocupa toda a largura útil.
- Destaques persistem a seleção exata, incluindo repetições no mesmo parágrafo, seleção invertida e nós de texto aninhados. Âncoras antigas ambíguas não são aplicadas arbitrariamente à primeira ocorrência.

## 0.6.0 — 2026-10-23

- Indicador animado desde o HTML inicial e durante login, com preparação antecipada da Home, capas e detalhes de livros próximos da área visível, sem baixar livros completos; cache e concorrência limitados por conta.

- Catálogo preserva telas recentes, filtros, busca e rolagem ao navegar e retornar do leitor; dados são revalidados sem apagar o conteúdo visível, com proteção contra respostas fora de ordem e isolamento por conta.
- Transições curtas de telas, menus e diálogos, carregamento contextual, aparecimento suave de capas e carregamento antecipado de código ao indicar intenção de navegar. Movimento reduzido é aplicado desde a inicialização.
- Admin pode enviar vários EPUBs/PDFs na página de uma biblioteca, com progresso real, validação, cancelamento e acompanhamento da catalogação automática.
- Upload em streaming, limite de tamanho, validação de conteúdo, nomes sem traversal e publicação atômica sem substituir arquivos. Scans em andamento recebem um sucessor para incluir novos uploads.
- Compose monta livros com escrita para uploads; scanner continua sem alterar fontes. Sem migrations nem mudanças no cliente legacy.

## 0.5.5 — 2026-10-20

- Sincronização automática de leitura passa a ser silenciosa, sem avisos de envio, contagem de pendências ou confirmação; erros e conflitos continuam acionáveis.
- EPUB, PDF original e texto adaptado compartilham controles padronizados, configurações com primitives existentes e estilos centralizados.
- Painéis usam o diálogo compartilhado, com navegação por teclado, contenção e restauração de foco; Tab revela os controles ocultos e a busca permanece disponível no celular.
- Cor da barra de status do PWA no Chrome acompanha o tema do aplicativo e da leitura, incluindo troca entre PDF original/adaptado e retorno ao catálogo. Validação física no Android permanece no checklist.
- Testes de regressão cobrem sincronização silenciosa, conflito real de progresso, temas, controles em telas estreitas e acessibilidade dos painéis.

## 0.5.2 — 2026-09-11

- Leitor deixa de exibir a notificação persistente de alterações pendentes enquanto está offline; erros locais e conflitos de progresso continuam visíveis.

## 0.5.1 — 2026-09-07

- Leitor deixa de exibir avisos persistentes de estado offline e sincronização concluída; alterações pendentes, conflitos e erros locais continuam visíveis.
- PDFs passam automaticamente ao modo de texto adaptado quando o motor visual não é suportado pelo Safari do dispositivo, preservando a abertura e a navegação no iPhone.

## 0.5.0 — 2026-09-04

- PWA instalável com app shell versionado, rotas essenciais em reload/cold start offline e atualização aplicada somente após consentimento, sem apagar conteúdo privado.
- Downloads explícitos e atômicos de EPUB/PDF em IndexedDB, com progresso real, cancelamento, quota, revisão do arquivo, atualização segura e gerenciamento por livro.
- EPUB preserva capítulos, índice, imagens, CSS e fontes; PDF oferece documento original por `ArrayBuffer` e páginas adaptadas, figuras e fontes sem depender de Range offline.
- Home, biblioteca, busca, capas, detalhes e preferências usam catálogo local e apresentam estados online/offline claros; áreas administrativas exigem conexão.
- Progresso, destaques, favoritos e preferências são persistidos imediatamente em uma outbox por usuário, com idempotência, leases, backoff e conflitos por revisão.
- Sessões expiradas ocultam dados sem destruir a fila; logout explícito remove downloads e estado local da conta com retry seguro de limpeza.
- Regressões cobrem Chromium desktop/mobile, cold start e atualização do PWA, além de IndexedDB/outbox em Playwright WebKit. Checklists para iPhone/iPad/macOS e Android permanecem como validação física pós-release.

## 0.4.3 — 2026-09-01

- Descoberta prepara texto, imagens isoladas e fontes necessárias em cache persistente; bibliotecas existentes são preparadas em segundo plano ao iniciar.
- Leitor adaptado abre sem baixar o PDF original; imagens são servidas prontas, sem renderização durante a leitura.
- Caminhos de recorte deixam de virar falsas ilustrações de página inteira.
- Glifos sem Unicode explícito preservam a aparência pela fonte embutida em spans adaptáveis, sem substituir letras por suposição. Copiar ou buscar esses glifos continua limitado pela ausência de Unicode no arquivo.
- Regressões verificam fontes, cache idempotente, invalidação, imagens e abertura direta do leitor adaptado.

## 0.4.2 — 2026-09-01

- Texto adaptado reconstrói palavras, acentos, ligaturas, parágrafos e colunas sem descartar bordas da página. CMaps locais são fornecidos ao extrator.
- Navegação percorre o conteúdo vertical antes de trocar a página física e restaura posição dentro de texto ou ilustração. Falha de carregamento preserva página e progresso anteriores.
- Ilustrações e diagramas recebem recortes próprios no fluxo; páginas textuais deixam de anexar um print integral ao final.
- Limpeza de destaques preserva as âncoras do Vue, evitando conteúdo residual e imagens ausentes após troca de página.
- Regressões cobrem extração, diagramas de linhas finas, leitura até o fim, restauração e erro de carregamento.

## 0.4.1 — 2026-09-01

- PDF em modo adaptado permanece no reflow em páginas complexas em vez de trocar silenciosamente para o documento original.
- Texto extraído continua integralmente disponível; páginas com imagens, vetores, rotação, ordem ambígua ou sem texto extraível recebem uma referência visual da própria página.
- Referência visual é renderizada sob demanda pelo PDF.js, autenticada e sem modificar o PDF fonte ou criar derivados persistentes durante o scan.
- Testes de fidelidade e E2E foram ajustados para exigir conteúdo textual completo e preservação visual no modo adaptado.

## 0.4.0 — 2026-09-01

- Reader EPUB estabilizado no Safari/WebKit: touch, seleção, notas, navegação e restauração de posição.
- Troca de capítulos preserva conteúdo anterior e usa transição independente do iframe.
- PDF adaptado preserva texto das bordas, verifica cobertura e oferece fallback original para páginas inseguras ou com imagens.
- Ajustes de viewport, safe areas, feedback touch e ícones/metadados PWA.
- Testes Chromium/WebKit adicionados aos gates de CI e release.
- Leitura offline permanece fora do escopo desta etapa.

## 0.3.2 — 2026-09-01

- Primeira página de PDFs renderizada no backend e armazenada como capa JPEG otimizada durante o scan.
- Rescan preenche capas ausentes de PDFs inalterados sem sobrescrever capas já existentes.
- Catálogo deixa de abrir PDFs com PDF.js para gerar prévias no navegador, eliminando downloads parciais inesperados de `/content`.

## 0.3.1 — 2026-08-31

- Capas normalizadas para JPEG progressivo de até 640 × 960 pixels durante scan e upload manual.
- Capas persistidas anteriormente migradas sob demanda sem modificar os livros fonte.
- Entrega de capas com MIME explícito, cache privado, revalidação por ETag e resposta 304.

## 0.3.0 — 2026-08-31

- Release inicial pública do Litera 0.3.0.
- Imagem de produção publicada no GHCR com tags semânticas.
- CI, automação de release e Docker Compose de produção documentados.
- Projeto licenciado sob GPL-3.0-only.

## 0.2.0-beta.1 — 2026-08-26

- Múltiplas libraries, reconciliação por inode + fingerprint e jobs persistentes com retry/recovery.
- Open Library configurável no Admin, cache de 7 dias, timeout/retry/rate-limit handling e confidence/provenance.
- Usuários, roles, libraries autorizadas, desativação/revogação de sessões e troca de senha.
- Authors, Series, Genres, Favorites, Settings, filtros, ordenação e paginação.
- Preferências do reader, busca EPUB/PDF, teclado/touch, fullscreen, conflito por revision e conclusão/reabertura.
- Admin operacional para libraries, jobs, users, metadata, system e compatibility.
- Logs estruturados, limites de livro, migrations de upgrade e regressões de segurança/multi-user.
- `/legacy` preservado com revisão de progresso e ajuste de texto. PDF continua explicitamente indisponível.
