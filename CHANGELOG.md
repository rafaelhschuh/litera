# Changelog

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
