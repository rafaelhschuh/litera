# Changelog

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
