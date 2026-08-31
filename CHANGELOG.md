# Changelog

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
