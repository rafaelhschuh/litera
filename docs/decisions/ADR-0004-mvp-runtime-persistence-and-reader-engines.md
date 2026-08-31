# ADR-0004 — Runtime único, SQLite e adapters de reader no MVP

## Status

Accepted

## Context

O MVP precisa ser instalável por Docker Compose, persistir catálogo/sessões/progresso, servir dois clientes sobre a mesma API e abrir EPUB/PDF sem criar dois backends. As alternativas principais eram múltiplos processos com banco externo ou um processo TypeScript com banco embarcado; para os readers, implementação própria completa ou engines maduras atrás do boundary do Litera.

## Decision

- Um processo Node.js/TypeScript serve `/api/v1`, o build Vue moderno, o cliente `/legacy` e arquivos autorizados.
- SQLite em WAL fornece migrations ordenadas, integridade referencial e persistência no volume `/data`.
- Senhas usam `scrypt` com salt individual; tokens de sessão aleatórios são armazenados apenas como SHA-256 e enviados em cookie `HttpOnly`, `SameSite=Lax`.
- O scanner usa identidade `device:inode` dentro da library para preservar o arquivo lógico em renames e combina isso com tamanho/mtime para evitar reprocessamento.
- EPUB.js e PDF.js ficam atrás do adapter do ReaderShell. EPUB possui fallback incremental pelo spine parseado com `yauzl`/`fast-xml-parser` e HTML sanitizado em iframe `sandbox`; esse fallback mantém locators semânticos de capítulo quando a engine não cria um frame válido.
- Conteúdo de livros é entregue somente após autenticação, com streaming e suporte a byte ranges. Source books permanecem read-only.
- Open Library implementa o boundary `search → getDetails`, é opt-in, identificada, limitada por timeout e nunca bloqueia ingestão local.

## Consequences

- A instalação inicial não exige operar Postgres/Redis nem coordenar vários containers.
- SQLite é adequado ao perfil doméstico/MVP, mas scans longos e alta concorrência exigirão jobs/processos dedicados no Beta.
- O domínio/API não depende de SQLite, Vue ou storage do browser; uma migração futura continua possível.
- O cliente legacy permanece pequeno e não carrega Vue/PDF.js/EPUB.js.
- O fallback EPUB troca fidelidade avançada por leitura segura e incremental em arquivos sem navegação ou em falhas de inicialização, sem transformar percentage na chave de restauração.
